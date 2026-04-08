import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveContract, savePlan, saveState } from "../../extensions/state/manager.js";
import { type ExecFn, registerRunValidationTool } from "../../extensions/tools/run-validation.js";
import type {
	AssertionResultData,
	MissionPlan,
	MissionState,
	ValidationContract,
	ValidationResult,
} from "../../extensions/types.js";
import {
	createMockContext,
	createMockPi,
	makeFeature,
	makeMilestone,
	makePlan,
	makeState,
	type ToolResult,
} from "../helpers/index.js";

const DONE_FEATURE = makeFeature({ status: "done" });

function localMakeMilestone(overrides: Partial<ReturnType<typeof makeMilestone>> = {}) {
	return makeMilestone({
		features: [DONE_FEATURE],
		status: "active",
		...overrides,
	});
}

function localMakePlan(overrides: Partial<MissionPlan> = {}) {
	return makePlan({
		milestones: [
			localMakeMilestone({
				name: "Foundation",
				description: "Core milestone",
			}),
		],
		validationCommands: ["echo test"],
		...overrides,
	});
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
		plan = localMakePlan(),
		exec = async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }),
		updateWidget = () => {},
	} = options;

	saveState(basePath, state);
	savePlan(basePath, plan);

	const { pi, getRegisteredTool } = createMockPi();
	registerRunValidationTool(pi, {
		basePath,
		projectDir: basePath,
		updateWidget,
		exec,
	});
	const tool = getRegisteredTool("run_validation")!;
	return tool.execute("tool-call-id", params, undefined, undefined, createMockContext()) as Promise<ToolResult>;
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
			const { pi, getRegisteredTool: getTool } = createMockPi();
			registerRunValidationTool(pi, {
				basePath: tmpDir,
				projectDir: tmpDir,
				updateWidget: () => {},
				exec: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
			});
			const tool = getTool("run_validation")!;
			const result = (await tool.execute(
				"id",
				{ milestoneId: "milestone-1" },
				undefined,
				undefined,
				createMockContext(),
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
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
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
			const plan = localMakePlan({
				validationCommands: ["plan-level-command"],
				milestones: [
					localMakeMilestone({
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
			const plan = localMakePlan({
				validationCommands: ["npm run test"],
				milestones: [localMakeMilestone({ validationCommands: undefined })],
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
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
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
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
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
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
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
			const plan = localMakePlan({
				validationCommands: [],
				milestones: [localMakeMilestone({ validationCommands: [] })],
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
			const plan = localMakePlan({
				milestones: [localMakeMilestone({ validationCommands: ["echo test"] })],
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
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
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
			const plan = localMakePlan({
				milestones: [localMakeMilestone({ validationCommands: ["echo test"] })],
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
			const plan = localMakePlan({
				milestones: [localMakeMilestone({ validationCommands: ["echo test"] })],
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
			const plan = localMakePlan({
				milestones: [localMakeMilestone({ validationCommands: ["npm run test"] })],
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
			const plan = localMakePlan({
				milestones: [localMakeMilestone({ validationCommands: ["echo hello"] })],
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
			const plan = localMakePlan({
				milestones: [localMakeMilestone({ validationCommands: ["npm run test"] })],
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
			const plan = localMakePlan({
				milestones: [localMakeMilestone({ validationCommands: ["echo test"] })],
			});
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.summary.length).toBeGreaterThan(0);
			expect(parsed.summary.toLowerCase()).toContain("pass");
		});

		it("summary mentions failing checks when commands fail", async () => {
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
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

		it("includes truncated stderr output for failing commands", async () => {
			const exec: ExecFn = async () => ({
				exitCode: 1,
				stdout: "",
				stderr: "error: cannot find module 'foo'\nTypeError at line 42",
				timedOut: false,
			});
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.summary).toContain("cannot find module");
		});

		it("includes truncated stdout when stderr is empty for failing commands", async () => {
			const exec: ExecFn = async () => ({
				exitCode: 1,
				stdout: "FAIL src/test.ts\n  Expected 1 to be 2",
				stderr: "",
				timedOut: false,
			});
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.summary).toContain("Expected 1 to be 2");
		});

		it("does not include output for passing commands", async () => {
			const exec: ExecFn = async () => ({
				exitCode: 0,
				stdout: "All tests passed",
				stderr: "",
				timedOut: false,
			});
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.summary).not.toContain("All tests passed");
		});

		it("truncates large output with suffix", async () => {
			const longOutput = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
			const exec: ExecFn = async () => ({
				exitCode: 1,
				stdout: "",
				stderr: longOutput,
				timedOut: false,
			});
			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.summary).toContain("truncated");
			expect(parsed.summary).toContain("line 0");
			expect(parsed.summary).not.toContain("line 199");
		});
	});

	describe("VAL-CROSS-011: three commands, first fails, all three execute", () => {
		it("runs all three commands even when first fails", async () => {
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
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
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
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
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
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

	describe("VAL-RUNNER-009: contract assertions run after command validation", () => {
		it("runs commands first, then contract assertions", async () => {
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
						validationCommands: ["echo test"],
						features: [makeFeature({ id: "f1", status: "done" })],
					}),
				],
			});
			const callOrder: string[] = [];
			const exec: ExecFn = async (cmd) => {
				callOrder.push(cmd);
				return { exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
			};

			const contract: ValidationContract = {
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "bun test assertion-test",
						expect: { exitCode: 0 },
						description: "assertion test",
						status: "pending",
					},
				],
			};
			saveContract(tmpDir, contract);

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			expect(callOrder[0]).toBe("echo test");
			expect(callOrder[1]).toBe("bun test assertion-test");
		});

		it("only runs assertions for features in the current milestone", async () => {
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
						validationCommands: ["echo test"],
						features: [makeFeature({ id: "f1", status: "done" })],
					}),
				],
			});
			const execCalls: string[] = [];
			const exec: ExecFn = async (cmd) => {
				execCalls.push(cmd);
				return { exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
			};

			const contract: ValidationContract = {
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "bun test f1-assertion",
						expect: { exitCode: 0 },
						description: "f1 assertion",
						status: "pending",
					},
					{
						id: "a2",
						featureId: "f-other",
						type: "command",
						command: "bun test f-other-assertion",
						expect: { exitCode: 0 },
						description: "other feature assertion",
						status: "pending",
					},
				],
			};
			saveContract(tmpDir, contract);

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			expect(execCalls).toContain("bun test f1-assertion");
			expect(execCalls).not.toContain("bun test f-other-assertion");
		});
	});

	describe("VAL-RUNNER-010: combined results (commands + assertions)", () => {
		it("status pass when both commands and assertions pass", async () => {
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
						validationCommands: ["echo test"],
						features: [makeFeature({ id: "f1", status: "done" })],
					}),
				],
			});
			const exec: ExecFn = async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false });

			saveContract(tmpDir, {
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "echo assertion",
						expect: { exitCode: 0 },
						description: "assertion pass",
						status: "pending",
					},
				],
			});

			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.status).toBe("pass");
			expect(parsed.assertions).toBeDefined();
			expect(parsed.assertions!.length).toBe(1);
			expect(parsed.assertions![0]!.status).toBe("pass");
		});

		it("status fail when commands pass but assertions fail", async () => {
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
						validationCommands: ["echo test"],
						features: [makeFeature({ id: "f1", status: "done" })],
					}),
				],
			});
			let callIndex = 0;
			const exec: ExecFn = async () => {
				callIndex++;
				return {
					exitCode: callIndex > 1 ? 1 : 0,
					stdout: "ok",
					stderr: "",
					timedOut: false,
				};
			};

			saveContract(tmpDir, {
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "failing-assertion",
						expect: { exitCode: 0 },
						description: "will fail",
						status: "pending",
					},
				],
			});

			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.status).toBe("fail");
			expect(parsed.summary.toLowerCase()).toContain("assertion");
		});

		it("status fail when commands fail and assertions pass", async () => {
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
						validationCommands: ["failing-command"],
						features: [makeFeature({ id: "f1", status: "done" })],
					}),
				],
			});
			let callIndex = 0;
			const exec: ExecFn = async () => {
				callIndex++;
				return {
					exitCode: callIndex === 1 ? 1 : 0,
					stdout: "ok",
					stderr: "",
					timedOut: false,
				};
			};

			saveContract(tmpDir, {
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "echo pass",
						expect: { exitCode: 0 },
						description: "passing assertion",
						status: "pending",
					},
				],
			});

			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.status).toBe("fail");
		});

		it("status fail when both commands and assertions fail", async () => {
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
						validationCommands: ["failing-command"],
						features: [makeFeature({ id: "f1", status: "done" })],
					}),
				],
			});
			const exec: ExecFn = async () => ({ exitCode: 1, stdout: "", stderr: "error", timedOut: false });

			saveContract(tmpDir, {
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "also-failing",
						expect: { exitCode: 0 },
						description: "will fail",
						status: "pending",
					},
				],
			});

			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.status).toBe("fail");
			expect(parsed.summary.toLowerCase()).toContain("fail");
		});

		it("summary mentions assertion failures when assertions fail", async () => {
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
						validationCommands: ["echo test"],
						features: [makeFeature({ id: "f1", status: "done" })],
					}),
				],
			});
			let callIndex = 0;
			const exec: ExecFn = async () => {
				callIndex++;
				return {
					exitCode: callIndex > 1 ? 1 : 0,
					stdout: "ok",
					stderr: "",
					timedOut: false,
				};
			};

			saveContract(tmpDir, {
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "fail-cmd",
						expect: { exitCode: 0 },
						description: "will fail",
						status: "pending",
					},
				],
			});

			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;
			expect(parsed.summary.toLowerCase()).toContain("assertion");
		});
	});

	describe("VAL-MIGRATION-003: no contract = commands only (backward compat)", () => {
		it("runs only commands when no contract file exists", async () => {
			const plan = localMakePlan({
				milestones: [localMakeMilestone({ validationCommands: ["echo test"] })],
			});
			const execCalls: string[] = [];
			const exec: ExecFn = async (cmd) => {
				execCalls.push(cmd);
				return { exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
			};

			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const parsed = JSON.parse(result.content[0].text) as ValidationResult;

			expect(execCalls).toHaveLength(1);
			expect(parsed.assertions).toBeUndefined();
			expect(parsed.status).toBe("pass");
		});

		it("no assertion errors when contract file missing", async () => {
			const plan = localMakePlan({
				milestones: [localMakeMilestone({ validationCommands: ["echo test"] })],
			});
			const exec: ExecFn = async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false });

			const result = await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });
			const text = result.content[0].text;
			expect(text).not.toContain("contract");
			expect(text).not.toContain("assertion");
		});
	});

	describe("VAL-EVIDENCE-002: evidence organized in runtime directory", () => {
		it("creates assertions directory alongside command timestamp directory", async () => {
			const plan = localMakePlan({
				milestones: [
					localMakeMilestone({
						validationCommands: ["echo test"],
						features: [makeFeature({ id: "f1", status: "done" })],
					}),
				],
			});
			const exec: ExecFn = async () => ({ exitCode: 0, stdout: "output", stderr: "", timedOut: false });

			saveContract(tmpDir, {
				assertions: [
					{
						id: "a1",
						featureId: "f1",
						type: "command",
						command: "echo assertion-output",
						expect: { exitCode: 0 },
						description: "evidence test",
						status: "pending",
					},
				],
			});

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			const validationDir = join(tmpDir, "runtime", "validation", "milestone-1");
			expect(existsSync(validationDir)).toBe(true);

			const { readdirSync } = await import("node:fs");
			const entries = readdirSync(validationDir);
			const hasTimestampDir = entries.some((e) => {
				try {
					return !e.includes(".");
				} catch {
					return false;
				}
			});
			expect(hasTimestampDir).toBe(true);

			const assertionsDir = join(validationDir, "assertions");
			expect(existsSync(assertionsDir)).toBe(true);

			expect(existsSync(join(assertionsDir, "a1-stdout.log"))).toBe(true);
			expect(existsSync(join(assertionsDir, "a1-stderr.log"))).toBe(true);
			expect(existsSync(join(assertionsDir, "a1-result.json"))).toBe(true);
		});

		it("no assertions directory when no contract exists", async () => {
			const plan = localMakePlan({
				milestones: [localMakeMilestone({ validationCommands: ["echo test"] })],
			});
			const exec: ExecFn = async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false });

			await callTool(tmpDir, { milestoneId: "milestone-1" }, { plan, exec });

			const assertionsDir = join(tmpDir, "runtime", "validation", "milestone-1", "assertions");
			expect(existsSync(assertionsDir)).toBe(false);
		});
	});
});
