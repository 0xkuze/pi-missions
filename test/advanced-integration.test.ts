import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_WORKER_MODEL, resolveModel, resolveValidationCommands } from "../extensions/config.js";
import { buildOrchestratorProtocol } from "../extensions/orchestrator/protocol.js";
import { generateReport } from "../extensions/report.js";
import { loadConfig, loadPlan, loadState, saveConfig, savePlan, saveState } from "../extensions/state/manager.js";
import { readHistory } from "../extensions/state/plan-history.js";
import { registerCompleteMissionTool } from "../extensions/tools/complete.js";
import { registerCreateFixTool } from "../extensions/tools/create-fix.js";
import { registerSpawnWorkerTool } from "../extensions/tools/spawn-worker.js";
import { registerSubmitPlanTool } from "../extensions/tools/submit-plan.js";
import { registerUpdateStateTool } from "../extensions/tools/update-state.js";
import type {
	Feature,
	Milestone,
	MissionConfig,
	MissionPlan,
	MissionState,
	WorkerAttempt,
} from "../extensions/types.js";
import { renderBlockedView } from "../extensions/ui/blocked-view.js";
import { handleDraftReviewKey, renderDraftReview } from "../extensions/ui/draft-review.js";
import {
	handleKeyboardAction,
	renderCurrentFeaturePanel,
	renderMissionOutline,
} from "../extensions/ui/mission-control.js";
import { renderReportView } from "../extensions/ui/report-view.js";
import type { CommandDisplayEntry } from "../extensions/ui/validation-view.js";
import { renderValidationView } from "../extensions/ui/validation-view.js";
import { buildWidgetLines } from "../extensions/ui/widget.js";
import { nowISO } from "../extensions/utils.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeAttempt(n: number, status: WorkerAttempt["status"] = "success", durationMs = 5000): WorkerAttempt {
	return {
		attemptNumber: n,
		startedAt: new Date(Date.now() - durationMs).toISOString(),
		completedAt: nowISO(),
		exitCode: status === "success" ? 0 : 1,
		resultPath: `runtime/f1/${n}/result.json`,
		stdoutPath: `runtime/f1/${n}/stdout.log`,
		stderrPath: `runtime/f1/${n}/stderr.log`,
		status,
		durationMs,
	};
}

function makeFeature(id: string, status: Feature["status"] = "pending", overrides: Partial<Feature> = {}): Feature {
	return {
		id,
		name: `Feature ${id}`,
		description: `Implements ${id}`,
		acceptanceCriteria: ["Works correctly", "Tests pass"],
		relevantFiles: ["src/index.ts"],
		dependencies: [],
		estimatedComplexity: "low",
		status,
		attempts: [],
		...overrides,
	};
}

function makeMilestone(id: string, features: Feature[], status: Milestone["status"] = "pending"): Milestone {
	return {
		id,
		name: `Milestone ${id}`,
		description: `Milestone ${id} description`,
		features,
		status,
	};
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return {
		id: "plan-adv",
		description: "Build a scalable auth system",
		planVersion: 1,
		milestones: [
			makeMilestone("m1", [makeFeature("f1"), makeFeature("f2")]),
			makeMilestone("m2", [makeFeature("f3")]),
		],
		validationCommands: ["bun test", "npx tsc --noEmit"],
		modelAssignment: { worker: "claude-sonnet-4", orchestrator: "claude-opus" },
		createdAt: nowISO(),
		approvedAt: nowISO(),
		...overrides,
	};
}

function makeState(status: MissionState["status"] = "executing", overrides: Partial<MissionState> = {}): MissionState {
	return {
		missionId: "adv-test-mission",
		status,
		progressLog: [],
		startedAt: new Date(Date.now() - 3_600_000).toISOString(),
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
		...overrides,
	};
}

type ToolResult = { content: Array<{ type: string; text: string }> };

function makeMockPi(): {
	pi: ExtensionAPI;
	tools: Map<string, { execute: (...args: unknown[]) => Promise<ToolResult> }>;
} {
	const tools = new Map<string, { execute: (...args: unknown[]) => Promise<ToolResult> }>();
	const pi = {
		registerTool: (tool: { name: string; execute: (...args: unknown[]) => Promise<ToolResult> }) =>
			tools.set(tool.name, tool),
		appendEntry: () => {},
	} as unknown as ExtensionAPI;
	return { pi, tools };
}

async function invokeTool(
	tools: Map<string, { execute: (...args: unknown[]) => Promise<ToolResult> }>,
	name: string,
	params: unknown,
): Promise<ToolResult> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Tool '${name}' not registered`);
	return tool.execute("call-id", params);
}

function makeMockSpawnFn(exitCode: number, output: string): (cmd: string, args: string[], opts: object) => object {
	return (_cmd, _args, _opts) => {
		const stdoutHandlers: Array<(data: Buffer) => void> = [];
		const closeHandlers: Array<(code: number | null, sig: string | null) => void> = [];
		const proc = {
			stdout: {
				on: (ev: string, h: (d: Buffer) => void) => {
					if (ev === "data") stdoutHandlers.push(h);
				},
			},
			stderr: { on: () => {} },
			on: (ev: string, h: (...args: unknown[]) => void) => {
				if (ev === "close") closeHandlers.push(h as (code: number | null, sig: string | null) => void);
			},
		};
		setImmediate(() => {
			if (output) {
				for (const hdl of stdoutHandlers) hdl(Buffer.from(output));
			}
			for (const hdl of closeHandlers) hdl(exitCode, null);
		});
		return proc;
	};
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let basePath: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "pi-missions-advanced-"));
	basePath = join(tmpDir, ".pi", "missions");
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Full lifecycle with report generation
// ---------------------------------------------------------------------------

describe("advanced integration: full lifecycle with report generation", () => {
	const workerOutput = JSON.stringify({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: "Feature complete." }] },
	});

	it("full flow: plan → approve → execute → complete → report.md generated", async () => {
		const { pi, tools } = makeMockPi();
		const updateWidget = () => {};

		registerSubmitPlanTool(pi, { basePath, updateWidget });
		registerUpdateStateTool(pi, { basePath, updateWidget });
		registerCompleteMissionTool(pi, { basePath, updateWidget });
		registerSpawnWorkerTool(pi, {
			basePath,
			projectDir: tmpDir,
			updateWidget,
			_spawnOverride: makeMockSpawnFn(0, workerOutput) as never,
		});

		// 1. Submit plan from planning state
		saveState(basePath, makeState("planning"));
		const planResult = await invokeTool(tools, "submit_plan", {
			description: "Build a scalable auth system",
			milestones: [
				{
					id: "m1",
					name: "Foundation",
					description: "Core auth entities",
					features: [
						{
							id: "f1",
							name: "User model",
							description: "Create user entity",
							acceptanceCriteria: ["User can be created", "User has id"],
							relevantFiles: ["src/models/user.ts"],
							dependencies: [],
							estimatedComplexity: "low" as const,
						},
					],
				},
			],
			validationCommands: ["bun test"],
		});
		expect(planResult.content[0].text).not.toContain("Error");

		const stateAfterPlan = loadState(basePath);
		expect(stateAfterPlan?.status).toBe("draft_review");
		const plan = loadPlan(basePath);
		expect(plan?.description).toBe("Build a scalable auth system");

		// 2. Transition to approved manually (simulating /mission-approve)
		saveState(basePath, { ...stateAfterPlan!, status: "approved" });

		// 3. Execute feature via spawn_worker
		const spawnResult = await invokeTool(tools, "spawn_worker", { featureId: "f1" });
		expect(spawnResult.content[0].text).not.toContain("Error");

		const stateAfterSpawn = loadState(basePath);
		expect(stateAfterSpawn?.status).toBe("executing");
		expect(stateAfterSpawn?.totalFeaturesCompleted).toBe(1);

		const planAfterSpawn = loadPlan(basePath);
		expect(planAfterSpawn?.milestones[0].features[0].status).toBe("done");

		// 4. Complete mission — triggers full report generation
		const completeResult = await invokeTool(tools, "complete_mission", {
			summary: "Auth system implemented with user model and login flow.",
		});
		expect(completeResult.content[0].text).not.toContain("Error");

		const finalState = loadState(basePath);
		expect(finalState?.status).toBe("completed");
		expect(finalState?.completedAt).toBeDefined();

		// 5. Verify report.md exists and has correct content
		const reportPath = join(basePath, "report.md");
		expect(existsSync(reportPath)).toBe(true);
		const report = readFileSync(reportPath, "utf8");
		expect(report).toContain("Mission Report");
		expect(report).toContain("Build a scalable auth system");
		expect(report).toContain("Auth system implemented with user model and login flow.");
		expect(report).toContain("Foundation");
		expect(report).toContain("User model");
		expect(report).toContain("done");
	});

	it("report includes feature metrics and attempt data from worker execution", async () => {
		// Build a state with rich metrics manually for generateReport testing
		const completedFeature = makeFeature("f1", "done", {
			name: "user-model",
			attempts: [makeAttempt(1, "success", 84_000)],
			startedAt: new Date(Date.now() - 90_000).toISOString(),
			completedAt: nowISO(),
		});
		const skippedFeature = makeFeature("f2", "skipped", { name: "optional-feature", attempts: [] });
		const fixFeature = makeFeature("fix-1", "done", {
			name: "fix-auth-token",
			attempts: [makeAttempt(1, "success", 15_000)],
			fixOrigin: {
				sourceKind: "validation-failure",
				sourceFeatureId: "f1",
				sourceMilestoneId: "m1",
			},
		});

		const plan = makePlan({
			description: "Auth system",
			milestones: [makeMilestone("m1", [completedFeature, skippedFeature, fixFeature], "done")],
		});
		const state = makeState("completed", {
			completedAt: nowISO(),
			totalFeaturesCompleted: 2,
			totalFeaturesSkipped: 1,
			totalFixFeaturesCreated: 1,
		});

		const report = generateReport(state, plan, {
			filesChanged: ["src/auth.ts", "src/user.ts", "src/auth.ts"],
			commits: [
				{ sha: "abc1234", message: "mission: user-model" },
				{ sha: "def5678", message: "mission: fix auth-token" },
			],
			featureMetrics: new Map([["f1", { tokensUsed: 5000, estimatedCost: 0.05 }]]),
			remainingNotes: ["Consider adding rate limiting"],
			warnings: ["Out-of-scope change detected in src/utils.ts"],
		});

		// Timeline
		expect(report).toContain("Auth system");
		expect(report).toContain("Started");
		expect(report).toContain("Completed");
		expect(report).toMatch(/1h 24m|1h |[0-9]+m/); // some duration

		// Summary counts match state counters exactly (VAL-RPT-004)
		expect(report).toContain("Completed:** 2");
		expect(report).toContain("Skipped:** 1");
		expect(report).toContain("Fix features created:** 1");

		// Feature details (VAL-RPT-002)
		expect(report).toContain("user-model");
		expect(report).toContain("optional-feature");
		expect(report).toContain("fix-auth-token");
		expect(report).toContain("validation-failure");

		// Feature duration (VAL-RPT-004)
		expect(report).toContain("1m 24s"); // 84000ms

		// Token/cost metrics (VAL-RPT-004)
		expect(report).toContain("5000");
		expect(report).toContain("0.05");

		// Deduplicated files (VAL-RPT-003)
		const authCount = (report.match(/src\/auth\.ts/g) ?? []).length;
		expect(authCount).toBe(1);
		expect(report).toContain("src/user.ts");

		// Git commits (VAL-RPT-003)
		expect(report).toContain("abc1234");
		expect(report).toContain("def5678");

		// Fix features section (VAL-RPT-002)
		expect(report).toContain("Fix Features");

		// Warnings section (VAL-RPT-005)
		expect(report).toContain("Out-of-scope change detected");

		// Notes section (VAL-RPT-005)
		expect(report).toContain("Consider adding rate limiting");
	});

	it("generateReport omits fix features section when zero fix features (VAL-RPT-005)", () => {
		const plan = makePlan();
		const state = makeState("completed", { completedAt: nowISO(), totalFixFeaturesCreated: 0 });
		const report = generateReport(state, plan);
		expect(report).not.toMatch(/^## Fix Features/m);
	});

	it("generateReport handles all-skipped-failed edge case gracefully (VAL-RPT-005)", () => {
		const plan = makePlan({
			milestones: [
				makeMilestone("m1", [
					makeFeature("f1", "skipped", { attempts: [] }),
					makeFeature("f2", "failed", { attempts: [makeAttempt(1, "failure")] }),
				]),
			],
		});
		const state = makeState("completed", {
			completedAt: nowISO(),
			totalFeaturesCompleted: 0,
			totalFeaturesFailed: 1,
			totalFeaturesSkipped: 1,
		});
		const report = generateReport(state, plan);
		expect(typeof report).toBe("string");
		expect(report).toContain("skipped");
		expect(report).toContain("failed");
		expect(report.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Autonomy enforcement: protocol injection per level
// ---------------------------------------------------------------------------

describe("advanced integration: autonomy enforcement in protocol (VAL-CROSS-008)", () => {
	const plan = makePlan();
	const verbose = { promptingMode: "default" as const };

	it("low autonomy instructs pause after every feature", () => {
		const config: MissionConfig = { autonomy: "low", ...verbose };
		const state = makeState("executing");
		const protocol = buildOrchestratorProtocol(state, plan, config);
		expect(protocol).not.toBeNull();
		expect(protocol!.toLowerCase()).toMatch(/low|after each feature|pause.*feature|feature.*pause/i);
	});

	it("medium autonomy instructs pause at milestone boundaries and failures", () => {
		const config: MissionConfig = { autonomy: "medium", ...verbose };
		const state = makeState("executing");
		const protocol = buildOrchestratorProtocol(state, plan, config);
		expect(protocol).not.toBeNull();
		expect(protocol!.toLowerCase()).toMatch(/medium|milestone.*bound|failure/i);
	});

	it("high autonomy instructs run to completion", () => {
		const config: MissionConfig = { autonomy: "high", ...verbose };
		const state = makeState("executing");
		const protocol = buildOrchestratorProtocol(state, plan, config);
		expect(protocol).not.toBeNull();
		expect(protocol!.toLowerCase()).toMatch(/high|completion|without pausing/i);
	});

	it("missing autonomy config defaults to medium behavior", () => {
		const config: MissionConfig = { ...verbose };
		const state = makeState("executing");
		const protocol = buildOrchestratorProtocol(state, plan, config);
		expect(protocol).not.toBeNull();
		expect(protocol!.toLowerCase()).toMatch(/medium|milestone.*bound/i);
	});

	it("three autonomy levels produce distinct protocol content", () => {
		const state = makeState("executing");
		const low = buildOrchestratorProtocol(state, plan, { autonomy: "low", ...verbose })!;
		const med = buildOrchestratorProtocol(state, plan, { autonomy: "medium", ...verbose })!;
		const high = buildOrchestratorProtocol(state, plan, { autonomy: "high", ...verbose })!;
		expect(low).not.toBe(med);
		expect(med).not.toBe(high);
		expect(low).not.toBe(high);
	});

	it("autonomy level applies consistently in planning state as well", () => {
		const state = makeState("planning");
		const low = buildOrchestratorProtocol(state, undefined, { autonomy: "low", ...verbose });
		const med = buildOrchestratorProtocol(state, undefined, { autonomy: "medium", ...verbose });
		const high = buildOrchestratorProtocol(state, undefined, { autonomy: "high", ...verbose });
		// Each produces non-null output
		expect(low).not.toBeNull();
		expect(med).not.toBeNull();
		expect(high).not.toBeNull();
		// Three levels produce distinct protocol content
		expect(low).not.toBe(med);
		expect(med).not.toBe(high);
		// Each contains the AUTONOMY label
		expect(low!.toLowerCase()).toContain("autonomy: low");
		expect(med!.toLowerCase()).toContain("autonomy: medium");
		expect(high!.toLowerCase()).toContain("autonomy: high");
	});
});

// ---------------------------------------------------------------------------
// Model switching: config resolution chain (VAL-CROSS-007)
// ---------------------------------------------------------------------------

describe("advanced integration: model switching and config resolution (VAL-CROSS-007)", () => {
	it("config.models.worker overrides plan.modelAssignment.worker", () => {
		const config: MissionConfig = { models: { worker: "gpt-4o" } };
		const plan = makePlan({ modelAssignment: { worker: "claude-sonnet-4" } });
		const model = resolveModel("worker", config, plan);
		expect(model).toBe("gpt-4o");
	});

	it("plan.modelAssignment used when config.models is empty", () => {
		const config: MissionConfig = {};
		const plan = makePlan({ modelAssignment: { worker: "claude-sonnet-4" } });
		const model = resolveModel("worker", config, plan);
		expect(model).toBe("claude-sonnet-4");
	});

	it("returns default worker model when no config or plan assignment exists", () => {
		const config: MissionConfig = {};
		const plan = makePlan({ modelAssignment: {} });
		const model = resolveModel("worker", config, plan);
		expect(model).toBe(DEFAULT_WORKER_MODEL);
	});

	it("config.models.orchestrator applies for orchestrator role", () => {
		const config: MissionConfig = { models: { orchestrator: "claude-opus" } };
		const plan = makePlan({ modelAssignment: {} });
		const model = resolveModel("orchestrator", config, plan);
		expect(model).toBe("claude-opus");
	});

	it("config saved and loaded from filesystem preserves model assignments", () => {
		const config: MissionConfig = {
			models: { worker: "claude-sonnet-4", orchestrator: "claude-opus" },
			autonomy: "high",
		};
		saveConfig(basePath, config);
		const loaded = loadConfig(basePath);
		expect(loaded.models?.worker).toBe("claude-sonnet-4");
		expect(loaded.models?.orchestrator).toBe("claude-opus");
		expect(loaded.autonomy).toBe("high");
	});

	it("model config defaults are sane when no config file exists", () => {
		const config = loadConfig(basePath);
		expect(config.maxRetries).toBe(3);
		expect(config.autonomy).toBe("medium");
		expect(config.validation?.timeoutMs).toBe(120000);
		expect(config.git?.autoCommit).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Validation command resolution and ordering (VAL-VAL-001, VAL-VAL-002)
// ---------------------------------------------------------------------------

describe("advanced integration: validation command resolution", () => {
	it("config commands override plan commands in resolution chain", () => {
		const config: MissionConfig = { validation: { commands: ["cargo test"], timeoutMs: 60000 } };
		const plan = makePlan({ validationCommands: ["bun test"] });
		const cmds = resolveValidationCommands(config, plan, null, tmpDir);
		expect(cmds).toContain("cargo test");
		expect(cmds).not.toContain("bun test");
	});

	it("plan commands used when config has none", () => {
		const config: MissionConfig = {};
		const plan = makePlan({ validationCommands: ["npx tsc --noEmit", "bun test"] });
		const cmds = resolveValidationCommands(config, plan, null, tmpDir);
		expect(cmds).toContain("npx tsc --noEmit");
		expect(cmds).toContain("bun test");
	});

	it("milestone-specific commands override plan commands", () => {
		const config: MissionConfig = {};
		const plan = makePlan({ validationCommands: ["bun test"] });
		const milestone = makeMilestone("m1", [], "pending");
		(milestone as { validationCommands?: string[] }).validationCommands = ["cargo test"];
		const cmds = resolveValidationCommands(config, plan, milestone, tmpDir);
		expect(cmds).toContain("cargo test");
		expect(cmds).not.toContain("bun test");
	});

	it("commands execute in canonical order: typecheck before test before build", () => {
		const config: MissionConfig = {};
		const plan = makePlan({ validationCommands: ["bun test", "npx tsc --noEmit", "npm run build"] });
		const cmds = resolveValidationCommands(config, plan, null, tmpDir);
		const tscIdx = cmds.findIndex((c) => c.includes("tsc"));
		const testIdx = cmds.findIndex((c) => c.includes("test"));
		const buildIdx = cmds.findIndex((c) => c.includes("build"));
		expect(tscIdx).toBeLessThan(testIdx);
		expect(testIdx).toBeLessThan(buildIdx);
	});
});

// ---------------------------------------------------------------------------
// Fix feature flow with validation failure (VAL-CROSS-004)
// ---------------------------------------------------------------------------

describe("advanced integration: fix feature flow with validation failure (VAL-CROSS-004)", () => {
	it("validation failure → create_fix_feature → plan updated with fix origin", async () => {
		const { pi, tools } = makeMockPi();
		const updateWidget = () => {};
		registerCreateFixTool(pi, { basePath, updateWidget });

		const state = makeState("executing");
		saveState(basePath, state);
		const plan = makePlan({
			milestones: [makeMilestone("m1", [makeFeature("f1", "done")])],
		});
		savePlan(basePath, plan);

		const result = await invokeTool(tools, "create_fix_feature", {
			milestoneId: "m1",
			name: "Fix validation failure",
			description: "Addresses test failures from milestone validation",
			acceptanceCriteria: ["All tests pass"],
			relevantFiles: ["src/index.ts"],
			sourceKind: "validation-failure",
			sourceFeatureId: "f1",
			sourceMilestoneId: "m1",
		});
		expect(result.content[0].text).not.toContain("Error");

		// Plan now has fix feature with correct fixOrigin
		const updatedPlan = loadPlan(basePath);
		expect(updatedPlan?.milestones[0].features.length).toBe(2);
		const fixFeature = updatedPlan?.milestones[0].features.find((f) => f.fixOrigin !== undefined);
		expect(fixFeature).toBeDefined();
		expect(fixFeature?.fixOrigin?.sourceKind).toBe("validation-failure");
		expect(fixFeature?.fixOrigin?.sourceFeatureId).toBe("f1");
		expect(fixFeature?.status).toBe("pending");

		// State counter incremented
		const updatedState = loadState(basePath);
		expect(updatedState?.totalFixFeaturesCreated).toBe(1);

		// Plan history records mutation
		const history = readHistory(basePath);
		expect(history.some((m) => m.kind === "add-fix-feature")).toBe(true);
	});

	it("spawn_worker for fix feature succeeds and increments completed counter", async () => {
		const workerOutputData = JSON.stringify({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "Fix complete." }] },
		});

		const { pi, tools } = makeMockPi();
		registerSpawnWorkerTool(pi, {
			basePath,
			projectDir: tmpDir,
			updateWidget: () => {},
			_spawnOverride: makeMockSpawnFn(0, workerOutputData) as never,
		});

		const fixFeature = makeFeature("fix-1", "pending", {
			name: "Fix validation failure",
			fixOrigin: { sourceKind: "validation-failure", sourceFeatureId: "f1", sourceMilestoneId: "m1" },
		});
		const state = makeState("executing");
		saveState(basePath, state);
		const plan = makePlan({
			milestones: [makeMilestone("m1", [makeFeature("f1", "done"), fixFeature])],
		});
		savePlan(basePath, plan);

		const result = await invokeTool(tools, "spawn_worker", { featureId: "fix-1" });
		expect(result.content[0].text).not.toContain("Error");

		const updatedPlan = loadPlan(basePath);
		const updatedFix = updatedPlan?.milestones[0].features.find((f) => f.id === "fix-1");
		expect(updatedFix?.status).toBe("done");
	});
});

// ---------------------------------------------------------------------------
// All views connected: full system with views (VAL-UI combined)
// ---------------------------------------------------------------------------

describe("advanced integration: all views connected", () => {
	it("widget renders correctly for each lifecycle phase", () => {
		const plan = makePlan();

		// Planning
		const planningState = makeState("planning");
		const planningLines = buildWidgetLines(planningState, undefined);
		expect(planningLines.length).toBeGreaterThan(0);
		expect(planningLines.join("\n")).toMatch(/plan/i);

		// Draft review
		const draftState = makeState("draft_review");
		const draftLines = buildWidgetLines(draftState, plan);
		expect(draftLines.join("\n")).toMatch(/draft|approval/i);

		// Approved
		const approvedState = makeState("approved");
		const approvedLines = buildWidgetLines(approvedState, plan);
		expect(approvedLines.length).toBeGreaterThan(0);

		// Executing
		const executingState = makeState("executing", { currentFeatureId: "f1", currentMilestoneId: "m1" });
		const executingLines = buildWidgetLines(executingState, plan);
		expect(executingLines.join("\n")).toMatch(/run|execut/i);

		// Validating
		const validatingState = makeState("validating");
		const validatingLines = buildWidgetLines(validatingState, plan);
		expect(validatingLines.length).toBeGreaterThan(0);

		// Paused
		const pausedState = makeState("paused", { resumeTargetState: "executing" });
		const pausedLines = buildWidgetLines(pausedState, plan);
		expect(pausedLines.join("\n")).toMatch(/pause/i);

		// Completed
		const completedState = makeState("completed", { completedAt: nowISO(), totalFeaturesCompleted: 3 });
		const completedLines = buildWidgetLines(completedState, plan);
		expect(completedLines.join("\n")).toMatch(/done|complete/i);
	});

	it("draft review view renders plan and A key dispatches approve", () => {
		const plan = makePlan();
		const lines = renderDraftReview(plan, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("Build a scalable auth system");
		expect(text).toContain("Milestone m1"); // milestone name from factory
		expect(text).toContain("Milestone m2");
		expect(text).toContain("bun test");
		expect(text).toContain("claude-sonnet-4");
		expect(handleDraftReviewKey("a").kind).toBe("approve");
		expect(handleDraftReviewKey("A").kind).toBe("approve");
	});

	it("blocked view renders when feature exhausts retries and keys dispatch correctly", () => {
		const blocked = makeFeature("f1", "blocked", {
			name: "auth-endpoint",
			attempts: [makeAttempt(1, "failure"), makeAttempt(2, "failure"), makeAttempt(3, "failure")],
		});
		const lines = renderBlockedView(
			blocked,
			3,
			{
				errorMessage: "Connection refused",
				details: "Service not running",
			},
			80,
			undefined,
			40,
		);
		const text = lines.join("\n");
		expect(text).toContain("auth-endpoint");
		expect(text).toContain("3/3");
		expect(text).toContain("Connection refused");
	});

	it("validation view shows all command statuses including durations", () => {
		const commands: CommandDisplayEntry[] = [
			{ label: "typecheck", status: "passed", durationMs: 1500 },
			{ label: "test", status: "failed", durationMs: 8000 },
			{ label: "build", status: "pending" },
		];
		const lines = renderValidationView("Foundation", commands, true, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("typecheck");
		expect(text).toContain("test");
		expect(text).toContain("build");
		expect(text).toContain("\u2713"); // passed
		expect(text).toContain("\u2717"); // failed
		expect(text).toContain("\u25cb"); // pending
		expect(text.toLowerCase()).toMatch(/fix|failure/); // fix info shown
	});

	it("completion report view renders mission summary with O key action", () => {
		const plan = makePlan();
		const completedState = makeState("completed", {
			completedAt: nowISO(),
			totalFeaturesCompleted: 3,
			totalFeaturesSkipped: 1,
			totalFixFeaturesCreated: 1,
		});
		const lines = renderReportView(completedState, plan, basePath, 80, undefined, 40);
		const text = lines.join("\n");
		expect(text).toContain("Build a scalable auth system");
		expect(text).toContain("Report:");
		expect(text).toContain("O:");
	});

	it("mission control renders all panels correctly with executing state", () => {
		const plan = makePlan();
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
			progressLog: [
				{
					timestamp: new Date(Date.now() - 60_000).toISOString(),
					type: "feature_start",
					detail: "Feature f1 started",
				},
			],
		});

		// All panels render
		const featureLines = renderCurrentFeaturePanel(state, plan);
		const outlineLines = renderMissionOutline(plan);
		expect(featureLines.join("\n")).toContain("Feature f1");
		expect(featureLines.join("\n")).toContain("Milestone m1");
		expect(featureLines.join("\n")).toContain("claude-sonnet-4"); // worker model from plan
		expect(outlineLines.join("\n")).toContain("Milestone m1");
		expect(outlineLines.join("\n")).toContain("Milestone m2");

		// Keyboard actions work correctly
		expect(handleKeyboardAction("p", state).kind).toBe("pause");
		expect(handleKeyboardAction("s", state).kind).toBe("skip"); // currentFeatureId set
		expect(handleKeyboardAction("m", state).kind).toBe("open_model_view");
		expect(handleKeyboardAction("v", state).kind).toBe("open_validation_view");
		expect(handleKeyboardAction("\x1B", state).kind).toBe("close");
	});
});

// ---------------------------------------------------------------------------
// End-to-end plan mutation history integrity
// ---------------------------------------------------------------------------

describe("advanced integration: plan mutation history integrity (VAL-STATE-010, VAL-CROSS-006)", () => {
	it("full lifecycle records mutations in correct order", async () => {
		const { pi, tools } = makeMockPi();
		registerSubmitPlanTool(pi, { basePath, updateWidget: () => {} });
		registerCreateFixTool(pi, { basePath, updateWidget: () => {} });

		// Planning: submit plan
		saveState(basePath, makeState("planning"));
		await invokeTool(tools, "submit_plan", {
			description: "Test plan",
			milestones: [
				{
					id: "m1",
					name: "M1",
					description: "d",
					features: [
						{
							id: "f1",
							name: "F1",
							description: "d",
							acceptanceCriteria: ["a"],
							relevantFiles: [],
							dependencies: [],
							estimatedComplexity: "low" as const,
						},
					],
				},
			],
			validationCommands: [],
		});

		// Executing: create fix feature
		saveState(basePath, makeState("executing"));
		await invokeTool(tools, "create_fix_feature", {
			milestoneId: "m1",
			name: "Fix f1",
			description: "d",
			acceptanceCriteria: ["Fixed"],
			relevantFiles: [],
			sourceKind: "worker-failure",
			sourceFeatureId: "f1",
			sourceMilestoneId: "m1",
		});

		const history = readHistory(basePath);
		expect(history.length).toBeGreaterThanOrEqual(2);
		expect(history[0].kind).toBe("plan-created");
		expect(history.some((m) => m.kind === "add-fix-feature")).toBe(true);

		// planVersion increments
		const firstVersion = history[0].planVersion;
		const lastVersion = history[history.length - 1].planVersion;
		expect(lastVersion).toBeGreaterThan(firstVersion);
	});

	it("re-submission from draft_review increments planVersion and records plan-revised", async () => {
		const { pi, tools } = makeMockPi();
		registerSubmitPlanTool(pi, { basePath, updateWidget: () => {} });

		const featureParams = {
			id: "f1",
			name: "F1",
			description: "d",
			acceptanceCriteria: ["a"],
			relevantFiles: [] as string[],
			dependencies: [] as string[],
			estimatedComplexity: "low" as const,
		};
		const milestoneParams = { id: "m1", name: "M1", description: "d", features: [featureParams] };
		const planParams = {
			description: "Original",
			milestones: [milestoneParams],
			validationCommands: [] as string[],
		};

		// First submission from planning
		saveState(basePath, makeState("planning"));
		await invokeTool(tools, "submit_plan", planParams);
		const plan1 = loadPlan(basePath);
		expect(plan1?.planVersion).toBe(1);

		// Re-submission from draft_review
		await invokeTool(tools, "submit_plan", { ...planParams, description: "Revised" });
		const plan2 = loadPlan(basePath);
		expect(plan2?.planVersion).toBe(2);
		expect(plan2?.description).toBe("Revised");

		const history = readHistory(basePath);
		expect(history.some((m) => m.kind === "plan-revised")).toBe(true);
	});
});
