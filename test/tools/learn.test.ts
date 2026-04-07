import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendLibraryTopic, initLibrary, readLibraryTopic } from "../../extensions/state/library.js";
import { learnFromResult } from "../../extensions/learn.js";
import type { WorkerResult } from "../../extensions/types.js";
import type { TempDir } from "../helpers/index.js";
import { createTempDir } from "../helpers/index.js";

let tmp: TempDir;

function makeBasePath(): string {
	const dir = join(tmp.path, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeFailureResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
	return {
		status: "failure",
		summary: "Worker failed",
		filesChanged: [],
		commandsRun: [],
		error: {
			kind: "validation",
			message: "TypeScript strict null check failed",
			details: "file.ts:42",
		},
		metrics: { durationMs: 1000 },
		...overrides,
	};
}

function makeSuccessResult(handoffOverrides: Record<string, unknown> = {}): WorkerResult {
	return {
		status: "success",
		summary: "Worker completed successfully",
		filesChanged: ["src/main.ts"],
		commandsRun: [],
		handoff: {
			whatWasImplemented: "Added retry logic",
			whatWasLeftUndone: "",
			commandsRun: [],
			testsAdded: [],
			discoveredIssues: [],
			...handoffOverrides,
		},
		metrics: { durationMs: 2000 },
	};
}

beforeEach(() => {
	tmp = createTempDir("pi-missions-learn-");
});

afterEach(() => {
	tmp.cleanup();
});

describe("learnFromResult", () => {
	describe("VAL-LEARN-005: learnFromResult produces correct output", () => {
		it("returns { learned: true, topic: 'pitfalls', entry } for failure result", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeFailureResult();
			const learned = learnFromResult(basePath, result, true);
			expect(learned.learned).toBe(true);
			expect(learned.topic).toBe("pitfalls");
			expect(typeof learned.entry).toBe("string");
			expect(learned.entry!.length).toBeGreaterThan(0);
		});

		it("returns { learned: false } for success result with no discovered issues", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult();
			const learned = learnFromResult(basePath, result, true);
			expect(learned.learned).toBe(false);
		});

		it("returns { learned: true, topic: 'pitfalls', entry } for success with discoveredIssues", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult({
				discoveredIssues: [
					{
						severity: "medium" as const,
						description: "Had to pin dep@2.1.0 due to breaking change in 2.2.0",
					},
				],
			});
			const learned = learnFromResult(basePath, result, true);
			expect(learned.learned).toBe(true);
			expect(learned.topic).toBe("pitfalls");
			expect(learned.entry).toContain("dep@2.1.0");
		});
	});

	describe("VAL-LEARN-001: spawnAndLearn config option enables/disables learning", () => {
		it("does not write to pitfalls when spawnAndLearn is false", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeFailureResult();
			learnFromResult(basePath, result, false);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toBe("# Pitfalls\n");
		});

		it("writes to pitfalls when spawnAndLearn is true", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeFailureResult();
			learnFromResult(basePath, result, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).not.toBe("# Pitfalls\n");
		});
	});

	describe("VAL-LEARN-002: Failure pattern extracted after worker failure", () => {
		it("extracts error kind, message, and details to pitfalls.md", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeFailureResult({
				error: {
					kind: "validation",
					message: "TypeScript strict null check failed",
					details: "file.ts:42",
				},
			});
			learnFromResult(basePath, result, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("TypeScript strict null check failed");
			expect(content).toContain("file.ts:42");
			expect(content).toContain("validation");
		});

		it("extracts error kind and message when no details", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeFailureResult({
				error: {
					kind: "tool",
					message: "Edit tool failed on protected file",
				},
			});
			learnFromResult(basePath, result, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("Edit tool failed on protected file");
			expect(content).toContain("tool");
		});
	});

	describe("VAL-LEARN-003: Success workarounds appended to pitfalls", () => {
		it("appends discoveredIssues with workarounds to pitfalls.md", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult({
				discoveredIssues: [
					{
						severity: "medium" as const,
						description: "Had to pin dep@2.1.0 due to breaking change in 2.2.0",
						suggestedFix: "Pin dep to 2.1.0 in package.json",
					},
				],
			});
			learnFromResult(basePath, result, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("Had to pin dep@2.1.0 due to breaking change in 2.2.0");
			expect(content).toContain("Pin dep to 2.1.0 in package.json");
		});

		it("appends multiple discoveredIssues to pitfalls.md", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult({
				discoveredIssues: [
					{
						severity: "low" as const,
						description: "Minor typo in log output",
					},
					{
						severity: "high" as const,
						description: "Race condition in cache",
						suggestedFix: "Add mutex",
					},
				],
			});
			learnFromResult(basePath, result, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("Minor typo in log output");
			expect(content).toContain("Race condition in cache");
			expect(content).toContain("Add mutex");
		});

		it("appends workaround from notes when no handoff", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result: WorkerResult = {
				status: "success",
				summary: "Done",
				filesChanged: [],
				commandsRun: [],
				notes: ["Had to pin dep@2.1.0 due to breaking change in 2.2.0"],
				metrics: { durationMs: 1000 },
			};
			learnFromResult(basePath, result, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("Had to pin dep@2.1.0 due to breaking change in 2.2.0");
		});
	});

	describe("VAL-LEARN-004: Future workers receive pitfalls in context", () => {
		it("learned pitfalls are readable via readLibraryTopic", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeFailureResult({
				error: {
					kind: "validation",
					message: "Tests failed due to missing mock setup",
				},
			});
			learnFromResult(basePath, result, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("Tests failed due to missing mock setup");
		});
	});

	describe("VAL-CROSS-001: Handoff issues flow to learning system", () => {
		it("discoveredIssues from handoff are appended to pitfalls.md", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult({
				discoveredIssues: [
					{
						severity: "high" as const,
						description: "Flaky test in integration suite",
						suggestedFix: "Add retry logic",
					},
				],
			});
			const learned = learnFromResult(basePath, result, true);
			expect(learned.learned).toBe(true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("Flaky test in integration suite");
			expect(content).toContain("Add retry logic");
		});
	});

	describe("VAL-CROSS-015: Learning system respects spawnAndLearn config toggle", () => {
		it("does not modify pitfalls.md when spawnAndLearn is false", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeFailureResult();
			const beforeContent = readLibraryTopic(basePath, "pitfalls");
			learnFromResult(basePath, result, false);
			const afterContent = readLibraryTopic(basePath, "pitfalls");
			expect(afterContent).toBe(beforeContent);
		});

		it("does not modify pitfalls.md for success with issues when spawnAndLearn is false", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult({
				discoveredIssues: [
					{
						severity: "high" as const,
						description: "Critical issue found",
					},
				],
			});
			const beforeContent = readLibraryTopic(basePath, "pitfalls");
			learnFromResult(basePath, result, false);
			const afterContent = readLibraryTopic(basePath, "pitfalls");
			expect(afterContent).toBe(beforeContent);
		});

		it("resumes learning when toggled back to true", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result1 = makeFailureResult();
			learnFromResult(basePath, result1, false);
			const afterFalse = readLibraryTopic(basePath, "pitfalls");
			expect(afterFalse).toBe("# Pitfalls\n");

			const result2 = makeSuccessResult({
				discoveredIssues: [
					{
						severity: "medium" as const,
						description: "Found workaround for API rate limit",
					},
				],
			});
			learnFromResult(basePath, result2, true);
			const afterTrue = readLibraryTopic(basePath, "pitfalls");
			expect(afterTrue).toContain("Found workaround for API rate limit");
		});
	});

	describe("edge cases", () => {
		it("handles failure with no error field gracefully", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result: WorkerResult = {
				status: "failure",
				summary: "Something went wrong",
				filesChanged: [],
				commandsRun: [],
				metrics: { durationMs: 500 },
			};
			const learned = learnFromResult(basePath, result, true);
			expect(learned.learned).toBe(true);
			expect(learned.topic).toBe("pitfalls");
		});

		it("handles success with handoff but empty discoveredIssues", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult({ discoveredIssues: [] });
			const learned = learnFromResult(basePath, result, true);
			expect(learned.learned).toBe(false);
		});

		it("handles success without handoff and without notes", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result: WorkerResult = {
				status: "success",
				summary: "Done",
				filesChanged: [],
				commandsRun: [],
				metrics: { durationMs: 500 },
			};
			const learned = learnFromResult(basePath, result, true);
			expect(learned.learned).toBe(false);
		});

		it("appends entries cumulatively", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);

			const result1 = makeFailureResult({
				error: { kind: "tool", message: "Edit failed on locked file" },
			});
			learnFromResult(basePath, result1, true);

			const result2 = makeSuccessResult({
				discoveredIssues: [
					{ severity: "medium" as const, description: "Needed workaround for bug in lib" },
				],
			});
			learnFromResult(basePath, result2, true);

			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("Edit failed on locked file");
			expect(content).toContain("Needed workaround for bug in lib");
		});

		it("creates library directory if it does not exist", () => {
			const basePath = makeBasePath();
			const result = makeFailureResult({
				error: { kind: "validation", message: "Test failed" },
			});
			learnFromResult(basePath, result, true);
			expect(existsSync(join(basePath, "library"))).toBe(true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("Test failed");
		});
	});
});
