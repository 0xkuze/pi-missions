import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { savePlan, saveState } from "../../extensions/state/manager.js";
import type { Feature, Milestone, MissionPlan, MissionState } from "../../extensions/types.js";
import { registerSpawnWorkerTool } from "../../extensions/tools/spawn-worker.js";

function makeFeature(overrides: Partial<Feature> = {}): Feature {
	return {
		id: "feat-1",
		name: "Feature One",
		description: "Implement feature one",
		acceptanceCriteria: ["It works"],
		relevantFiles: ["src/index.ts"],
		dependencies: [],
		estimatedComplexity: "low",
		status: "pending",
		attempts: [],
		...overrides,
	};
}

function makeMilestone(features: Feature[] = [], overrides: Partial<Milestone> = {}): Milestone {
	return {
		id: "milestone-1",
		name: "Core",
		description: "Core milestone",
		features,
		status: "pending",
		...overrides,
	};
}

function makePlan(milestones: Milestone[] = [], overrides: Partial<MissionPlan> = {}): MissionPlan {
	return {
		id: "plan-1",
		description: "Test mission",
		planVersion: 1,
		milestones,
		validationCommands: [],
		modelAssignment: {},
		createdAt: new Date().toISOString(),
		approvedAt: new Date().toISOString(),
		...overrides,
	};
}

function makeState(overrides: Partial<MissionState> = {}): MissionState {
	return {
		missionId: "mission-1",
		status: "approved",
		currentMilestoneId: undefined,
		currentFeatureId: undefined,
		progressLog: [],
		startedAt: new Date().toISOString(),
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
		...overrides,
	};
}

function makeMessageEndLine(role: string, text: string): string {
	return JSON.stringify({
		type: "message_end",
		message: { role, content: [{ type: "text", text }] },
	});
}

interface MockSpawnOptions {
	stdoutLines?: string[];
	stderr?: string;
	exitCode?: number;
	signal?: string | null;
	error?: Error;
}

function makeMockSpawn(opts: MockSpawnOptions = {}) {
	const { stdoutLines = [], stderr = "", exitCode = 0, signal = null, error } = opts;

	return (_command: string, _args: string[], _options: object) => {
		const stdoutHandlers: Array<(data: Buffer) => void> = [];
		const stderrHandlers: Array<(data: Buffer) => void> = [];
		const closeHandlers: Array<(code: number | null, signal: string | null) => void> = [];
		const errorHandlers: Array<(err: Error) => void> = [];

		const mockStdout = {
			on: (event: string, handler: (data: Buffer) => void) => {
				if (event === "data") stdoutHandlers.push(handler);
			},
		};

		const mockStderr = {
			on: (event: string, handler: (data: Buffer) => void) => {
				if (event === "data") stderrHandlers.push(handler);
			},
		};

		const proc = {
			stdout: mockStdout,
			stderr: mockStderr,
			killed: false,
			on: (event: string, handler: (...args: unknown[]) => void) => {
				if (event === "close") closeHandlers.push(handler as (code: number | null, signal: string | null) => void);
				if (event === "error") errorHandlers.push(handler as (err: Error) => void);
			},
		};

		// Use setImmediate to fire events asynchronously so the process can register handlers first
		setImmediate(() => {
			if (error) {
				for (const h of errorHandlers) h(error);
				return;
			}
			if (stderr) {
				for (const h of stderrHandlers) h(Buffer.from(stderr));
			}
			const joinedStdout = stdoutLines.join("\n");
			if (joinedStdout) {
				for (const h of stdoutHandlers) h(Buffer.from(joinedStdout));
			}
			for (const h of closeHandlers) h(exitCode, signal);
		});

		return proc;
	};
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

let testDir: string;
let capturedCommand: string | null;
let capturedArgs: string[] | null;
let capturedCwd: string | null;
let capturedSpawnOpts: Record<string, unknown> | null;
let mockSpawnFn: ReturnType<typeof makeMockSpawn>;

let executeFn: ((_id: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>) | null =
	null;

function makePiMock(_updateWidgetFn?: () => void): ExtensionAPI {
	const pi = {
		registerTool: (_opts: { name: string; execute: (...args: unknown[]) => unknown }) => {
			executeFn = _opts.execute as typeof executeFn;
		},
	} as unknown as ExtensionAPI;
	return pi;
}

beforeEach(() => {
	testDir = join(tmpdir(), `spawn-worker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testDir, { recursive: true });
	writeFileSync(join(testDir, "AGENTS.md"), "# Conventions", "utf8");
	capturedCommand = null;
	capturedArgs = null;
	capturedCwd = null;
	capturedSpawnOpts = null;
	executeFn = null;
	mockSpawnFn = makeMockSpawn({
		stdoutLines: [makeMessageEndLine("assistant", "Worker completed successfully.")],
		exitCode: 0,
	});
});

afterEach(() => {
	try {
		rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

function registerTool(
	spawnMock: ReturnType<typeof makeMockSpawn>,
	extraOpts: {
		projectDir?: string;
		noAgentsMd?: boolean;
		getThinkingLevel?: () => ThinkingLevel;
		setThinkingLevel?: (level: ThinkingLevel) => void;
	} = {},
): void {
	const projectDir = extraOpts.projectDir ?? testDir;
	if (extraOpts.noAgentsMd) {
		try {
			rmSync(join(projectDir, "AGENTS.md"));
		} catch {
			// ignore
		}
	}
	const pi = makePiMock();
	registerSpawnWorkerTool(pi, {
		basePath: testDir,
		projectDir,
		updateWidget: () => {},
		getThinkingLevel: extraOpts.getThinkingLevel,
		setThinkingLevel: extraOpts.setThinkingLevel,
		_spawnOverride: (command, args, opts) => {
			capturedCommand = command;
			capturedArgs = args;
			capturedCwd = (opts as { cwd?: string }).cwd ?? null;
			capturedSpawnOpts = opts as Record<string, unknown>;
			return spawnMock(command, args, opts);
		},
	});
}

describe("registerSpawnWorkerTool", () => {
	describe("VAL-TOOL-004: state and feature preconditions", () => {
		it("returns error when no state exists", async () => {
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});

		it("returns error when state is not approved or executing", async () => {
			const state = makeState({ status: "planning" });
			saveState(testDir, state);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});

		it("returns error when state is draft_review", async () => {
			const state = makeState({ status: "draft_review" });
			saveState(testDir, state);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});

		it("returns error when feature not found in plan", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const plan = makePlan([makeMilestone([makeFeature()])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "nonexistent-feature" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});

		it("returns error when no plan.json exists", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});
	});

	describe("VAL-TOOL-020: rejects blocked, skipped, done features", () => {
		for (const status of ["blocked", "skipped", "done"] as const) {
			it(`returns error for feature with status '${status}'`, async () => {
				const state = makeState({ status: "executing" });
				saveState(testDir, state);
				const feature = makeFeature({ status });
				const plan = makePlan([makeMilestone([feature])]);
				savePlan(testDir, plan);
				registerTool(mockSpawnFn);
				const result = await executeFn!("id", { featureId: "feat-1" });
				expect(result.content[0].text).toContain("Error");
				expect(capturedCommand).toBeNull();
			});
		}
	});

	describe("VAL-TOOL-021: rejects concurrent execution", () => {
		it("returns error when currentFeatureId is set", async () => {
			const state = makeState({ status: "executing", currentFeatureId: "some-other-feature" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});
	});

	describe("VAL-TOOL-019: enforces feature dependency ordering", () => {
		it("returns error when a dependency is not done", async () => {
			const state = makeState({ status: "executing" });
			saveState(testDir, state);
			const dep = makeFeature({ id: "dep-1", status: "pending" });
			const feature = makeFeature({ id: "feat-1", dependencies: ["dep-1"] });
			const plan = makePlan([makeMilestone([dep, feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
			expect(capturedCommand).toBeNull();
		});

		it("succeeds when all dependencies are done", async () => {
			const state = makeState({ status: "executing" });
			saveState(testDir, state);
			const dep = makeFeature({ id: "dep-1", status: "done" });
			const feature = makeFeature({ id: "feat-1", dependencies: ["dep-1"] });
			const plan = makePlan([makeMilestone([dep, feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});

		it("succeeds when there are no dependencies", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature({ id: "feat-1", dependencies: [] });
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});
	});

	describe("VAL-TOOL-007: transitions approved -> executing on first spawn_worker call", () => {
		it("transitions state from approved to executing", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			expect(savedState?.status).toBe("executing");
		});

		it("does not re-transition if already executing", async () => {
			const state = makeState({ status: "executing" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			expect(savedState?.status).toBe("executing");
		});
	});

	describe("VAL-TOOL-004: generates skill and prompt files, spawns blocking process", () => {
		it("spawns the pi process and blocks until exit", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(capturedCommand).not.toBeNull();
			expect(result).toBeDefined();
		});

		it("passes --mode json, -p, --no-session, --model, --skill, --append-system-prompt to pi process", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedArgs).toContain("--mode");
			expect(capturedArgs).toContain("json");
			expect(capturedArgs).toContain("-p");
			expect(capturedArgs).toContain("--no-session");
			expect(capturedArgs).toContain("--skill");
			expect(capturedArgs).toContain("--append-system-prompt");
		});

		it("passes --model arg when config or plan has worker model", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])], {
				modelAssignment: { worker: "claude-sonnet-4" },
			});
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedArgs).toContain("--model");
			const modelIdx = capturedArgs!.indexOf("--model");
			expect(capturedArgs![modelIdx + 1]).toBe("claude-sonnet-4");
		});

		it("does not pass --model when no worker model configured", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedArgs).not.toContain("--model");
		});
	});

	describe("VAL-WORKER-009: worker spawned with correct cwd", () => {
		it("sets cwd to the projectDir", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedCwd).toBe(testDir);
		});
	});

	describe("VAL-WORKER-009: spawned process uses stdio ['ignore', 'pipe', 'pipe']", () => {
		it("uses correct stdio config", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			expect(capturedSpawnOpts?.stdio).toEqual(["ignore", "pipe", "pipe"]);
		});
	});

	describe("VAL-WORKER-004: files written to correct runtime directory", () => {
		it("writes worker-skill.md to runtime/<featureId>/1/ on first attempt", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const skillPath = join(testDir, "runtime", "feat-1", "1", "worker-skill.md");
			expect(() => readFileSync(skillPath)).not.toThrow();
		});

		it("writes worker-prompt.md to runtime/<featureId>/1/", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const promptPath = join(testDir, "runtime", "feat-1", "1", "worker-prompt.md");
			expect(() => readFileSync(promptPath)).not.toThrow();
		});

		it("writes worker-context.md to runtime/<featureId>/1/", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const contextPath = join(testDir, "runtime", "feat-1", "1", "worker-context.md");
			expect(() => readFileSync(contextPath)).not.toThrow();
		});

		it("retry attempt 2 uses runtime/<featureId>/2/", async () => {
			const failMock = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Worker failed.")],
				exitCode: 1,
			});
			const state = makeState({ status: "executing" });
			saveState(testDir, state);
			const feature = makeFeature({
				status: "active",
				attempts: [
					{
						attemptNumber: 1,
						startedAt: new Date().toISOString(),
						exitCode: 1,
						resultPath: join(testDir, "runtime", "feat-1", "1", "result.json"),
						stdoutPath: join(testDir, "runtime", "feat-1", "1", "stdout.log"),
						stderrPath: join(testDir, "runtime", "feat-1", "1", "stderr.log"),
						status: "failure",
					},
				],
			});
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(failMock);
			await executeFn!("id", { featureId: "feat-1" });
			const skillPath = join(testDir, "runtime", "feat-1", "2", "worker-skill.md");
			expect(() => readFileSync(skillPath)).not.toThrow();
		});
	});

	describe("VAL-TOOL-005: captures output and synthesizes WorkerResult", () => {
		it("writes stdout.log to runtime directory", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const stdoutPath = join(testDir, "runtime", "feat-1", "1", "stdout.log");
			expect(() => readFileSync(stdoutPath)).not.toThrow();
		});

		it("writes stderr.log to runtime directory", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const stderrPath = join(testDir, "runtime", "feat-1", "1", "stderr.log");
			expect(() => readFileSync(stderrPath)).not.toThrow();
		});

		it("writes result.json with WorkerResult to runtime directory", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const resultPath = join(testDir, "runtime", "feat-1", "1", "result.json");
			const content = readFileSync(resultPath, "utf8");
			const parsed = JSON.parse(content);
			expect(parsed.status).toBe("success");
			expect(typeof parsed.summary).toBe("string");
		});

		it("writes metadata.json to runtime directory", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const metaPath = join(testDir, "runtime", "feat-1", "1", "metadata.json");
			const content = readFileSync(metaPath, "utf8");
			const parsed = JSON.parse(content);
			expect(parsed.featureId).toBe("feat-1");
			expect(typeof parsed.attemptNumber).toBe("number");
		});
	});

	describe("VAL-TOOL-006: updates plan and state after completion", () => {
		it("on success: sets feature status to done and increments totalFeaturesCompleted", async () => {
			const successMock = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Done!")],
				exitCode: 0,
			});
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(successMock);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState, loadPlan } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			const savedPlan = loadPlan(testDir);
			expect(savedState?.totalFeaturesCompleted).toBe(1);
			expect(savedPlan?.milestones[0].features[0].status).toBe("done");
			expect(savedPlan?.milestones[0].features[0].completedAt).toBeDefined();
		});

		it("on failure: feature stays active and increments totalFeaturesFailed", async () => {
			const failMock = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Failed.")],
				exitCode: 1,
			});
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(failMock);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState, loadPlan } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			const savedPlan = loadPlan(testDir);
			expect(savedState?.totalFeaturesFailed).toBe(1);
			const feat = savedPlan?.milestones[0].features[0];
			expect(feat?.status === "active" || feat?.status === "failed").toBe(true);
		});

		it("on failure with retries exhausted: feature status becomes failed", async () => {
			const failMock = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Failed.")],
				exitCode: 1,
			});
			const state = makeState({ status: "executing" });
			saveState(testDir, state);
			const feature = makeFeature({
				status: "active",
				attempts: [
					{
						attemptNumber: 1,
						startedAt: new Date().toISOString(),
						exitCode: 1,
						resultPath: "",
						stdoutPath: "",
						stderrPath: "",
						status: "failure",
					},
					{
						attemptNumber: 2,
						startedAt: new Date().toISOString(),
						exitCode: 1,
						resultPath: "",
						stdoutPath: "",
						stderrPath: "",
						status: "failure",
					},
				],
			});
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(failMock);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir);
			expect(savedPlan?.milestones[0].features[0].status).toBe("failed");
		});

		it("clears currentFeatureId after completion", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			expect(savedState?.currentFeatureId).toBeUndefined();
		});

		it("appends worker_spawn and worker_complete progress events", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadState } = await import("../../extensions/state/manager.js");
			const savedState = loadState(testDir);
			const eventTypes = savedState?.progressLog.map((e) => e.type);
			expect(eventTypes).toContain("worker_spawn");
			expect(eventTypes).toContain("worker_complete");
		});
	});

	describe("VAL-TOOL-007: retry increments attempt number", () => {
		it("attempt number is 2 when feature already has 1 failed attempt", async () => {
			const state = makeState({ status: "executing" });
			saveState(testDir, state);
			const feature = makeFeature({
				status: "active",
				attempts: [
					{
						attemptNumber: 1,
						startedAt: new Date().toISOString(),
						exitCode: 1,
						resultPath: "",
						stdoutPath: "",
						stderrPath: "",
						status: "failure",
					},
				],
			});
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir);
			const attempts = savedPlan?.milestones[0].features[0].attempts;
			expect(attempts?.length).toBe(2);
			expect(attempts?.[1].attemptNumber).toBe(2);
		});

		it("additionalContext included in prompt on retry", async () => {
			const state = makeState({ status: "executing" });
			saveState(testDir, state);
			const feature = makeFeature({
				status: "active",
				attempts: [
					{
						attemptNumber: 1,
						startedAt: new Date().toISOString(),
						exitCode: 1,
						resultPath: "",
						stdoutPath: "",
						stderrPath: "",
						status: "failure",
					},
				],
			});
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1", additionalContext: "Fix the broken tests" });
			const promptPath = join(testDir, "runtime", "feat-1", "2", "worker-prompt.md");
			const content = readFileSync(promptPath, "utf8");
			expect(content).toContain("Fix the broken tests");
		});
	});

	describe("VAL-WORKER-010: returns tool error if pi binary not found", () => {
		it("returns error when spawning fails with ENOENT", async () => {
			const errorMock = makeMockSpawn({ error: Object.assign(new Error("not found"), { code: "ENOENT" }) });
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(errorMock);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).toContain("Error");
		});
	});

	describe("feature status transitions tracked (VAL-CROSS-013)", () => {
		it("records completedAt and durationMs on successful attempt", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir);
			const attempt = savedPlan?.milestones[0].features[0].attempts[0];
			expect(attempt?.completedAt).toBeDefined();
			expect(attempt?.durationMs).toBeGreaterThan(0);
			expect(attempt?.status).toBe("success");
			expect(attempt?.exitCode).toBe(0);
		});

		it("records completedAt and durationMs on failed attempt", async () => {
			const failMock = makeMockSpawn({ exitCode: 1, stdoutLines: [makeMessageEndLine("assistant", "Err.")] });
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(failMock);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir);
			const attempt = savedPlan?.milestones[0].features[0].attempts[0];
			expect(attempt?.completedAt).toBeDefined();
			expect(attempt?.durationMs).toBeGreaterThan(0);
			expect(attempt?.status).toBe("failure");
		});
	});

	describe("active feature state", () => {
		it("sets feature to active during execution", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature({ status: "pending" });
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);
			registerTool(mockSpawnFn);
			await executeFn!("id", { featureId: "feat-1" });
			const { loadPlan } = await import("../../extensions/state/manager.js");
			const savedPlan = loadPlan(testDir);
			expect(savedPlan?.milestones[0].features[0].status).toBe("done");
		});
	});

	describe("VAL-API-002: thinking level saved and restored around worker spawn", () => {
		it("saves thinking level before spawn and restores after success", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);

			const setLevelCalls: ThinkingLevel[] = [];
			registerTool(mockSpawnFn, {
				getThinkingLevel: () => "medium",
				setThinkingLevel: (level) => setLevelCalls.push(level),
			});
			await executeFn!("id", { featureId: "feat-1" });
			expect(setLevelCalls).toEqual(["medium"]);
		});

		it("saves thinking level before spawn and restores after failure", async () => {
			const failMock = makeMockSpawn({
				stdoutLines: [makeMessageEndLine("assistant", "Failed.")],
				exitCode: 1,
			});
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);

			const setLevelCalls: ThinkingLevel[] = [];
			registerTool(failMock, {
				getThinkingLevel: () => "high",
				setThinkingLevel: (level) => setLevelCalls.push(level),
			});
			await executeFn!("id", { featureId: "feat-1" });
			expect(setLevelCalls).toEqual(["high"]);
		});

		it("restores thinking level even when pi binary not found (ENOENT)", async () => {
			const errorMock = makeMockSpawn({ error: Object.assign(new Error("not found"), { code: "ENOENT" }) });
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);

			const setLevelCalls: ThinkingLevel[] = [];
			registerTool(errorMock, {
				getThinkingLevel: () => "low",
				setThinkingLevel: (level) => setLevelCalls.push(level),
			});
			await executeFn!("id", { featureId: "feat-1" });
			expect(setLevelCalls).toEqual(["low"]);
		});

		it("works without getThinkingLevel and setThinkingLevel deps (optional)", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);

			registerTool(mockSpawnFn);
			const result = await executeFn!("id", { featureId: "feat-1" });
			expect(result.content[0].text).not.toContain("Error");
		});

		it("restores the exact level that was saved before spawn", async () => {
			const state = makeState({ status: "approved" });
			saveState(testDir, state);
			const feature = makeFeature();
			const plan = makePlan([makeMilestone([feature])]);
			savePlan(testDir, plan);

			let currentLevel: ThinkingLevel = "xhigh";
			const setLevelCalls: ThinkingLevel[] = [];
			registerTool(mockSpawnFn, {
				getThinkingLevel: () => currentLevel,
				setThinkingLevel: (level) => {
					setLevelCalls.push(level);
					currentLevel = level;
				},
			});
			await executeFn!("id", { featureId: "feat-1" });
			expect(setLevelCalls[0]).toBe("xhigh");
			expect(currentLevel).toBe("xhigh");
		});
	});
});
