import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { learnFromResult } from "../../extensions/learn.js";
import { appendLibraryTopic, initLibrary, readLibraryTopic } from "../../extensions/state/library.js";
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

		it("returns { learned: true, topic: 'conventions', entry } for success with discoveredIssues", () => {
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
			expect(learned.topic).toBe("conventions");
			expect(learned.entry).toContain("dep@2.1.0");
		});

		it("learns from failed commands in successful worker handoff", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult({
				commandsRun: [
					{ command: "npm test", exitCode: 1, observation: "vitest requires --pool=forks" },
					{ command: "npm test --pool=forks", exitCode: 0, observation: "all tests pass" },
				],
			});
			const learned = learnFromResult(basePath, result, true);
			expect(learned.learned).toBe(true);
			expect(learned.topic).toBe("conventions");
			expect(learned.entry).toContain("npm test");
			expect(learned.entry).toContain("exit 1");
			expect(learned.entry).toContain("vitest requires --pool=forks");
		});

		it("does not learn when success has no issues, notes, or failed commands", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult({
				commandsRun: [{ command: "npm test", exitCode: 0, observation: "all pass" }],
			});
			const learned = learnFromResult(basePath, result, true);
			expect(learned.learned).toBe(false);
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

	describe("VAL-LEARN-003: Success workarounds appended to conventions", () => {
		it("appends discoveredIssues with workarounds to conventions.md", () => {
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
			const content = readLibraryTopic(basePath, "conventions");
			expect(content).toContain("Had to pin dep@2.1.0 due to breaking change in 2.2.0");
			expect(content).toContain("Pin dep to 2.1.0 in package.json");
		});

		it("appends multiple discoveredIssues to conventions.md", () => {
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
			const content = readLibraryTopic(basePath, "conventions");
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
			const content = readLibraryTopic(basePath, "conventions");
			expect(content).toContain("Had to pin dep@2.1.0 due to breaking change in 2.2.0");
		});

		it("does not append success workarounds to pitfalls", () => {
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
			learnFromResult(basePath, result, true);
			const pitfalls = readLibraryTopic(basePath, "pitfalls");
			expect(pitfalls).toBe("# Pitfalls\n");
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
		it("discoveredIssues from handoff are appended to conventions.md", () => {
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
			expect(learned.topic).toBe("conventions");
			const content = readLibraryTopic(basePath, "conventions");
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
			const afterTrue = readLibraryTopic(basePath, "conventions");
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

		it("appends entries cumulatively across topics", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);

			const result1 = makeFailureResult({
				error: { kind: "tool", message: "Edit failed on locked file" },
			});
			learnFromResult(basePath, result1, true);

			const result2 = makeSuccessResult({
				discoveredIssues: [{ severity: "medium" as const, description: "Needed workaround for bug in lib" }],
			});
			learnFromResult(basePath, result2, true);

			const pitfalls = readLibraryTopic(basePath, "pitfalls");
			expect(pitfalls).toContain("Edit failed on locked file");

			const conventions = readLibraryTopic(basePath, "conventions");
			expect(conventions).toContain("Needed workaround for bug in lib");
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

	describe("feature context in failure entries", () => {
		it("includes feature name and description in failure entry", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeFailureResult({
				error: { kind: "validation", message: "TypeScript error" },
			});
			learnFromResult(basePath, result, true, {
				name: "auth-endpoint",
				description: "Create authentication endpoint",
			});
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("auth-endpoint");
			expect(content).toContain("Create authentication endpoint");
			expect(content).toContain("TypeScript error");
		});

		it("works without feature context (backward compatible)", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeFailureResult({
				error: { kind: "tool", message: "Edit failed" },
			});
			learnFromResult(basePath, result, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("Edit failed");
			expect(content).not.toContain("Feature:");
		});

		it("feature context not included in success entries", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult({
				discoveredIssues: [{ severity: "medium" as const, description: "Used workaround for lib bug" }],
			});
			learnFromResult(basePath, result, true, {
				name: "auth-endpoint",
				description: "Create authentication endpoint",
			});
			const conventions = readLibraryTopic(basePath, "conventions");
			expect(conventions).toContain("Used workaround for lib bug");
			expect(conventions).not.toContain("auth-endpoint");
		});
	});

	describe("deduplication", () => {
		it("skips appending duplicate failure entries", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeFailureResult({
				error: { kind: "validation", message: "Same error repeated" },
			});
			learnFromResult(basePath, result, true);
			learnFromResult(basePath, result, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			const occurrences = content!.split("Same error repeated").length - 1;
			expect(occurrences).toBe(1);
		});

		it("skips appending duplicate success workarounds", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result = makeSuccessResult({
				discoveredIssues: [{ severity: "medium" as const, description: "Same workaround again" }],
			});
			learnFromResult(basePath, result, true);
			learnFromResult(basePath, result, true);
			const content = readLibraryTopic(basePath, "conventions");
			const occurrences = content!.split("Same workaround again").length - 1;
			expect(occurrences).toBe(1);
		});

		it("allows different entries for the same topic", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			const result1 = makeFailureResult({
				error: { kind: "tool", message: "First error" },
			});
			const result2 = makeFailureResult({
				error: { kind: "validation", message: "Second error" },
			});
			learnFromResult(basePath, result1, true);
			learnFromResult(basePath, result2, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			expect(content).toContain("First error");
			expect(content).toContain("Second error");
		});

		it("deduplication only checks last 5 entries", () => {
			const basePath = makeBasePath();
			initLibrary(basePath);
			for (let i = 0; i < 6; i++) {
				const r = makeFailureResult({
					error: { kind: "validation", message: `Error ${i}` },
				});
				learnFromResult(basePath, r, true);
			}
			const dupResult = makeFailureResult({
				error: { kind: "validation", message: "Error 0" },
			});
			learnFromResult(basePath, dupResult, true);
			const content = readLibraryTopic(basePath, "pitfalls");
			const occurrences = content!.split("Error 0").length - 1;
			expect(occurrences).toBe(2);
		});
	});
});
