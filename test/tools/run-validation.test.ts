import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { savePlan, saveState } from "../../extensions/state/manager.js";
import { type ExecFn, registerRunValidationTool } from "../../extensions/tools/run-validation.js";
import type { Feature, Milestone, MissionPlan, MissionState, ValidationResult } from "../../extensions/types.js";
import { nowISO } from "../../extensions/utils.js";

type ToolResult = { content: Array<{ type: string; text: string }>; details: unknown };
type ExecutableTool = { execute: (...args: unknown[]) => Promise<ToolResult> };

function makeMockPi(): { pi: ExtensionAPI; getLastRegisteredTool: () => ExecutableTool | null } {
	let registeredTool: ExecutableTool | null = null;
	const pi = {
		registerTool: (tool: ExecutableTool) => {
			registeredTool = tool;
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		getLastRegisteredTool: () => registeredTool,
	};
}

function makeState(overrides: Partial<MissionState> = {}): MissionState {
	return {
		missionId: "test-mission",
		status: "executing",
		progressLog: [],
		startedAt: nowISO(),
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
		...overrides,
	};
}

function makeFeature(overrides: Partial<Feature> = {}): Feature {
	return {
		id: "feature-1",
		name: "test-feature",
		description: "Test feature",
		acceptanceCriteria: ["It works"],
		relevantFiles: [],
		dependencies: [],
		estimatedComplexity: "low",
		status: "done",
		attempts: [],
		...overrides,
	};
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
	return {
		id: "milestone-1",
		name: "Foundation",
		description: "Core milestone",
		features: [makeFeature()],
		status: "active",
		...overrides,
	};
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return {
		id: "plan-1",
		description: "Test mission",
		planVersion: 1,
		milestones: [makeMilestone()],
		validationCommands: ["echo test"],
		modelAssignment: {},
		createdAt: nowISO(),
		...overrides,
	};
}

interface CallToolOptions {
	state?: MissionState;
	plan?: MissionPlan;
	exec?: ExecFn;
	updateWidget?: (state: MissionState, plan?: MissionPlan) => void;
}

async function callTool(
	basePath: string,
	params: { milestoneId: string },
	options: CallToolOptions = {},
): Promise<ToolResult> {
	const {
		state = makeState(),
		plan = makePlan(),
		exec = async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }),
		updateWidget = () => {},
	} = options;

	saveState(basePath, state);
	savePlan(basePath, plan);

	const { pi, getLastRegisteredTool } = makeMockPi();
	registerRunValidationTool(pi, {
		basePath,
		projectDir: basePath,
		updateWidget,
		exec,
	});
	const tool = getLastRegisteredTool()!;
	return tool.execute("tool-call-id", params, undefined, undefined, undefined) as Promise<ToolResult>;
}

describe("registerRunValidationTool", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "run-validation-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("VAL-TOOL-010: preconditions and state transitions", () => {
		it("returns error when no state exists", async () => {
			const { pi, getLastRegisteredTool } = makeMockPi();
			registerRunValidationTool(pi, {
				basePath: tmpDir,
				projectDir: tmpDir,
				updateWidget: () => {},
				exec: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
			});
			const tool = getLastRegisteredTool()!;
			const result = (await tool.execute(
				"id",
				{ milestoneId: "milestone-1" },
				undefined,
				undefined,
				undefined,
			)) as ToolResult;
			expect(result.content[0].text).toContain("Error");
		});

		it("returns error when state is not executing", async () => {
			const result = await callTool(
				tmpDir,
				{ milestoneId: "milestone-1" },
				{
					state: makeState({ status: "planning" }),
				},
			);
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("executing");
		});

		it("returns error when state is validating (not executing)", async () => {
			const result = await callTool(
				tmpDir,
				{ milestoneId: "milestone-1" },
				{
					state: makeState({ status: "validating" }),
				},
			);
			expect(result.content[0].text).toContain("Error");
		});

		it("returns error when milestoneId is unknown", async () => {
			const result = await callTool(tmpDir, { milestoneId: "nonexistent-milestone" });
			expect(result.content[0].text).toContain("Error");
			expect(result.content[0].text).toContain("nonexistent-milestone");
		});

		it("transitions state to validating then back to executing", async () => {
			const { loadState } = await import("../../extensions/state/manager.js");
			const stateChanges: string[] = [];
			const updateWidget = (s: MissionState) => {
				stateChanges.push(s.status);
			};

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { updateWidget });

			const finalState = loadState(tmpDir)!;
			expect(finalState.status).toBe("executing");
			expect(stateChanges).toContain("validating");
			expect(stateChanges[stateChanges.length - 1]).toBe("executing");
		});
	});

	describe("VAL-TOOL-008: command resolution and execution order", () => {
		it("executes commands in canonical order (typecheck -> lint -> test -> build) regardless of input order", async () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						validationCommands: ["npm run build", "npm run lint", "npm run typecheck", "npm run test"],
					}),
				],
			});
			const executionOrder: string[] = [];
			const exec: ExecFn = async (cmd) => {
				executionOrder.push(cmd);
				return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
			};

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			expect(executionOrder[0]).toContain("typecheck");
			expect(executionOrder[1]).toContain("lint");
			expect(executionOrder[2]).toContain("test");
			expect(executionOrder[3]).toContain("build");
		});

		it("resolves milestone-specific validation commands over plan-level commands", async () => {
			const plan = makePlan({
				validationCommands: ["plan-level-command"],
				milestones: [
					makeMilestone({
						validationCommands: ["echo milestone-test"],
					}),
				],
			});
			const executedCommands: string[] = [];
			const exec: ExecFn = async (cmd) => {
				executedCommands.push(cmd);
				return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
			};

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			expect(executedCommands).toContain("echo milestone-test");
			expect(executedCommands).not.toContain("plan-level-command");
		});

		it("uses plan-level commands when milestone has no overrides", async () => {
			const plan = makePlan({
				validationCommands: ["npm run test"],
				milestones: [makeMilestone({ validationCommands: undefined })],
			});
			const executedCommands: string[] = [];
			const exec: ExecFn = async (cmd) => {
				executedCommands.push(cmd);
				return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
			};

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			expect(executedCommands).toContain("npm run test");
		});

		it("runs all commands even when earlier ones fail (no fail-fast)", async () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						validationCommands: ["npm run typecheck", "npm run test", "npm run build"],
					}),
				],
			});
			const executedCommands: string[] = [];
			const exec: ExecFn = async (cmd) => {
				executedCommands.push(cmd);
				// typecheck fails, others pass
				const exitCode = cmd.includes("typecheck") ? 1 : 0;
				return { exitCode, stdout: "", stderr: "", timedOut: false };
			};

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			expect(executedCommands).toHaveLength(3);
		});
	});

	describe("VAL-TOOL-009 / VAL-VAL-004: structured ValidationResult", () => {
		it("returns pass when all commands succeed", async () => {
			const result = await callTool(
				tmpDir,
				{ milestoneId: "milestone-1" },
				{
					exec: async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }),
				},
			);
			const text = result.content[0].text;
			const parsed = JSON.parse(text) as ValidationResult;
			expect(parsed.status).toBe("pass");
			expect(parsed.failingChecks).toHaveLength(0);
		});

		it("returns fail when any command exits non-zero", async () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						validationCommands: ["npm run typecheck", "npm run test"],
					}),
				],
			});
			const exec: ExecFn = async (cmd) => ({
				exitCode: cmd.includes("test") ? 1 : 0,
				stdout: "",
				stderr: cmd.includes("test") ? "test failed" : "",
				timedOut: false,
			});

			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.status).toBe("fail");
			expect(parsed.failingChecks.length).toBeGreaterThan(0);
		});

		it("returns fail when any command times out", async () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						validationCommands: ["npm run test"],
					}),
				],
			});
			const exec: ExecFn = async () => ({
				exitCode: null,
				stdout: "",
				stderr: "",
				timedOut: true,
			});

			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.status).toBe("fail");
			expect(parsed.commands[0]!.timedOut).toBe(true);
		});

		it("returns pass with explanatory summary when command list is empty", async () => {
			const plan = makePlan({
				validationCommands: [],
				milestones: [makeMilestone({ validationCommands: [] })],
			});
			// No package.json in tmpDir, so auto-detect returns empty
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.status).toBe("pass");
			expect(parsed.commands).toHaveLength(0);
			expect(parsed.summary.length).toBeGreaterThan(0);
		});

		it("includes milestoneId in result", async () => {
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.milestoneId).toBe("milestone-1");
		});

		it("includes per-command results with all required fields", async () => {
			const plan = makePlan({
				milestones: [makeMilestone({ validationCommands: ["echo test"] })],
			});
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			const cmd = parsed.commands[0]!;
			expect(cmd.command).toBe("echo test");
			expect(typeof cmd.exitCode).toBe("number");
			expect(typeof cmd.durationMs).toBe("number");
			expect(cmd.durationMs).toBeGreaterThanOrEqual(0);
			expect(typeof cmd.timedOut).toBe("boolean");
			expect(typeof cmd.stdoutPath).toBe("string");
			expect(typeof cmd.stderrPath).toBe("string");
			expect(typeof cmd.label).toBe("string");
		});

		it("failingChecks contains labels of failed commands", async () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						validationCommands: ["npm run typecheck", "npm run test"],
					}),
				],
			});
			const exec: ExecFn = async (cmd) => ({
				exitCode: cmd.includes("test") ? 1 : 0,
				stdout: "",
				stderr: "",
				timedOut: false,
			});
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.failingChecks).toHaveLength(1);
			expect(parsed.failingChecks[0]).toContain("test");
		});
	});

	describe("VAL-VAL-003: timeout enforcement", () => {
		it("passes the configured timeout to runCommand", async () => {
			const plan = makePlan({
				milestones: [makeMilestone({ validationCommands: ["echo test"] })],
			});
			const { writeFileSync: wfs } = await import("node:fs");
			const { join: pathJoin } = await import("node:path");
			const config = { validation: { timeoutMs: 60000 } };
			wfs(pathJoin(tmpDir, "config.json"), JSON.stringify(config), "utf8");

			const receivedTimeouts: number[] = [];
			const exec: ExecFn = async (_cmd, _cwd, timeoutMs) => {
				receivedTimeouts.push(timeoutMs);
				return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
			};

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			expect(receivedTimeouts[0]).toBe(60000);
		});

		it("uses default timeout of 120000ms when not configured", async () => {
			const plan = makePlan({
				milestones: [makeMilestone({ validationCommands: ["echo test"] })],
			});
			const receivedTimeouts: number[] = [];
			const exec: ExecFn = async (_cmd, _cwd, timeoutMs) => {
				receivedTimeouts.push(timeoutMs);
				return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
			};

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			expect(receivedTimeouts[0]).toBe(120000);
		});

		it("marks command as timedOut:true and exitCode:null when timeout occurs", async () => {
			const plan = makePlan({
				milestones: [makeMilestone({ validationCommands: ["npm run test"] })],
			});
			const exec: ExecFn = async () => ({
				exitCode: null,
				stdout: "",
				stderr: "",
				timedOut: true,
			});

			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.commands[0]!.timedOut).toBe(true);
			expect(parsed.commands[0]!.exitCode).toBeNull();
		});
	});

	describe("VAL-VAL-005: state persistence and result file", () => {
		it("writes result.json to validation runtime directory", async () => {
			await callTool(tmpDir, { milestoneId: "milestone-1" });

			const validationDir = join(tmpDir, "runtime", "validation", "milestone-1");
			expect(existsSync(validationDir)).toBe(true);
			// Find the timestamp subdirectory
			const { readdirSync } = await import("node:fs");
			const entries = readdirSync(validationDir);
			expect(entries.length).toBeGreaterThan(0);
			const resultPath = join(validationDir, entries[0]!, "result.json");
			expect(existsSync(resultPath)).toBe(true);
			const result = JSON.parse(readFileSync(resultPath, "utf8")) as ValidationResult;
			expect(result.status).toBeDefined();
			expect(result.milestoneId).toBe("milestone-1");
		});

		it("captures stdout/stderr to per-command files", async () => {
			const plan = makePlan({
				milestones: [makeMilestone({ validationCommands: ["echo hello"] })],
			});
			const exec: ExecFn = async () => ({
				exitCode: 0,
				stdout: "hello output",
				stderr: "some error",
				timedOut: false,
			});

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			const validationDir = join(tmpDir, "runtime", "validation", "milestone-1");
			const { readdirSync } = await import("node:fs");
			const entries = readdirSync(validationDir);
			const timestampDir = join(validationDir, entries[0]!);
			const files = readdirSync(timestampDir);
			const stdoutFiles = files.filter((f) => f.endsWith("-stdout.log"));
			const stderrFiles = files.filter((f) => f.endsWith("-stderr.log"));
			expect(stdoutFiles.length).toBeGreaterThan(0);
			expect(stderrFiles.length).toBeGreaterThan(0);
			expect(readFileSync(join(timestampDir, stdoutFiles[0]!), "utf8")).toContain("hello output");
			expect(readFileSync(join(timestampDir, stderrFiles[0]!), "utf8")).toContain("some error");
		});

		it("appends validation_start and validation_pass/fail progress events", async () => {
			const { loadState } = await import("../../extensions/state/manager.js");
			await callTool(tmpDir, { milestoneId: "milestone-1" });
			const finalState = loadState(tmpDir)!;
			const eventTypes = finalState.progressLog.map((e) => e.type);
			expect(eventTypes).toContain("validation_start");
			const hasPassOrFail = eventTypes.some((t) => t === "validation_pass" || t === "validation_fail");
			expect(hasPassOrFail).toBe(true);
		});

		it("appends validation_fail event when commands fail", async () => {
			const plan = makePlan({
				milestones: [makeMilestone({ validationCommands: ["npm run test"] })],
			});
			const { loadState } = await import("../../extensions/state/manager.js");
			await callTool(
				tmpDir,
				{ milestoneId: "milestone-1" },
				{
					plan,
					exec: async () => ({ exitCode: 1, stdout: "", stderr: "", timedOut: false }),
				},
			);
			const finalState = loadState(tmpDir)!;
			const eventTypes = finalState.progressLog.map((e) => e.type);
			expect(eventTypes).toContain("validation_fail");
		});

		it("state remains executing after validation completes", async () => {
			const { loadState } = await import("../../extensions/state/manager.js");
			await callTool(tmpDir, { milestoneId: "milestone-1" });
			const finalState = loadState(tmpDir)!;
			expect(finalState.status).toBe("executing");
		});
	});

	describe("VAL-VAL-006: human-readable summary", () => {
		it("summary is non-empty and meaningful on pass", async () => {
			const plan = makePlan({
				milestones: [makeMilestone({ validationCommands: ["echo test"] })],
			});
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.summary.length).toBeGreaterThan(0);
			expect(parsed.summary.toLowerCase()).toContain("pass");
		});

		it("summary mentions failing checks when commands fail", async () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						validationCommands: ["npm run typecheck", "npm run test"],
					}),
				],
			});
			const exec: ExecFn = async (cmd) => ({
				exitCode: cmd.includes("test") ? 1 : 0,
				stdout: "",
				stderr: "",
				timedOut: false,
			});
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.summary.toLowerCase()).toContain("fail");
			expect(parsed.summary).toContain("test");
		});

		it("summary is never empty", async () => {
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.summary.trim().length).toBeGreaterThan(0);
		});
	});

	describe("VAL-CROSS-011: three commands, first fails, all three execute", () => {
		it("runs all three commands even when first fails", async () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						validationCommands: ["npm run typecheck", "npm run test", "npm run build"],
					}),
				],
			});
			const executedCommands: string[] = [];
			const exec: ExecFn = async (cmd) => {
				executedCommands.push(cmd);
				return { exitCode: cmd.includes("typecheck") ? 1 : 0, stdout: "", stderr: "", timedOut: false };
			};

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			expect(executedCommands).toHaveLength(3);
		});

		it("result.json stored to runtime/validation/<milestoneId>/<timestamp>/", async () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						validationCommands: ["npm run typecheck", "npm run test", "npm run build"],
					}),
				],
			});
			const exec: ExecFn = async (cmd) => ({
				exitCode: cmd.includes("typecheck") ? 1 : 0,
				stdout: "output",
				stderr: "",
				timedOut: false,
			});

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			const validationDir = join(tmpDir, "runtime", "validation", "milestone-1");
			expect(existsSync(validationDir)).toBe(true);
			const { readdirSync } = await import("node:fs");
			const entries = readdirSync(validationDir);
			expect(entries.length).toBeGreaterThan(0);
			const resultPath = join(validationDir, entries[0]!, "result.json");
			expect(existsSync(resultPath)).toBe(true);
			const resultData = JSON.parse(readFileSync(resultPath, "utf8")) as ValidationResult;
			expect(resultData.status).toBe("fail");
			expect(resultData.commands).toHaveLength(3);
		});

		it("overall status is fail when any command fails", async () => {
			const plan = makePlan({
				milestones: [
					makeMilestone({
						validationCommands: ["npm run typecheck", "npm run test", "npm run build"],
					}),
				],
			});
			const exec: ExecFn = async (cmd) => ({
				exitCode: cmd.includes("typecheck") ? 1 : 0,
				stdout: "",
				stderr: "",
				timedOut: false,
			});
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.status).toBe("fail");
		});
	});

	describe("widget updates in real-time", () => {
		it("calls updateWidget during execution (at least twice: start and end)", async () => {
			const widgetCalls: string[] = [];
			const updateWidget = (s: MissionState) => {
				widgetCalls.push(s.status);
			};

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { updateWidget });

			expect(widgetCalls.length).toBeGreaterThanOrEqual(2);
		});

		it("calls updateWidget after returning to executing state", async () => {
			const widgetCalls: string[] = [];
			const updateWidget = (s: MissionState) => {
				widgetCalls.push(s.status);
			};

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { updateWidget });

			const lastStatus = widgetCalls[widgetCalls.length - 1];
			expect(lastStatus).toBe("executing");
		});
	});
});
