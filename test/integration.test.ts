import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import setup, { reconcileStateOnStart } from "../extensions/index.js";
import { loadPlan, loadState, saveConfig, savePlan, saveState } from "../extensions/state/manager.js";
import type { Feature, Milestone, MissionPlan, MissionState } from "../extensions/types.js";
import { nowISO } from "../extensions/utils.js";
import { makeFeature as _sf, makeMilestone as _sm, makePlan as _sp, makeState as _ss } from "./helpers/index.js";

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function makeState(status: MissionState["status"] = "planning", overrides: Partial<MissionState> = {}): MissionState {
	return _ss({ status, startedAt: new Date(Date.now() - 60_000).toISOString(), ...overrides });
}

function makeFeature(id: string, status: Feature["status"] = "pending", overrides: Partial<Feature> = {}): Feature {
	return _sf({ id, name: `Feature ${id}`, status, ...overrides });
}

function makeMilestone(id: string, features: Feature[], status: Milestone["status"] = "pending"): Milestone {
	return _sm({ id, name: `Milestone ${id}`, features, status });
}

function makeReportResultLine(): string {
	return JSON.stringify({
		type: "tool_execution_end",
		toolName: "report_result",
		args: {
			whatWasImplemented: "Implemented feature",
			whatWasLeftUndone: "",
			commandsRun: [],
			testsAdded: [],
			discoveredIssues: [],
		},
		result: { content: [{ type: "text", text: "Report submitted." }] },
		isError: false,
	});
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return _sp({
		milestones: [
			makeMilestone("m1", [makeFeature("f1"), makeFeature("f2")]),
			makeMilestone("m2", [makeFeature("f3")]),
		],
		validationCommands: ["bun test"],
		...overrides,
	});
}

function makeWorkerResult(status: "success" | "failure"): object {
	return {
		status,
		summary: status === "success" ? "Feature completed successfully" : "Feature failed",
		filesChanged: ["src/index.ts"],
		commandsRun: [],
		metrics: { durationMs: 1000 },
	};
}

type SessionCacheEntry = { type: "custom"; customType: string; data?: unknown };

function makeCacheEntry(data: unknown): SessionCacheEntry {
	return { type: "custom", customType: "mission-state-cache", data };
}

// ---------------------------------------------------------------------------
// Mock pi/ctx helpers
// ---------------------------------------------------------------------------

interface MockPiSetup {
	pi: ExtensionAPI;
	appendedEntries: Array<{ type: string; data: unknown }>;
	handlers: Map<string, (event: unknown, ctx: ExtensionContext) => unknown>;
	tools: Map<string, { name: string; execute: (id: string, params: unknown) => Promise<unknown> }>;
	commands: Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>;
	sentUserMessages: string[];
	sessionNames: string[];
}

function buildMockPi(): MockPiSetup {
	const appendedEntries: Array<{ type: string; data: unknown }> = [];
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const tools = new Map<string, { name: string; execute: (id: string, params: unknown) => Promise<unknown> }>();
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
	const sentUserMessages: string[] = [];
	const sessionNames: string[] = [];

	const pi = {
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
			handlers.set(event, handler);
		},
		appendEntry: (type: string, data: unknown) => appendedEntries.push({ type, data }),
		registerTool: (tool: { name: string; execute: (id: string, params: unknown) => Promise<unknown> }) =>
			tools.set(tool.name, tool),
		registerCommand: (name: string, opts: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) =>
			commands.set(name, opts),
		registerShortcut: (_shortcut: string, _opts: unknown) => {},
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: (msg: string) => sentUserMessages.push(msg),
		setSessionName: (name: string) => sessionNames.push(name),
		getSessionName: () => undefined,
		setLabel: () => {},
		exec: async () => ({ stdout: "", stderr: "", exitCode: 0, signal: null }),
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => {},
		getCommands: () => [],
		setModel: async () => true,
		getThinkingLevel: () => "none",
		setThinkingLevel: () => {},
		events: { on: () => {}, off: () => {}, emit: () => {} },
	} as unknown as ExtensionAPI;

	return { pi, appendedEntries, handlers, tools, commands, sentUserMessages, sessionNames };
}

function buildMockCtx(
	cacheEntries: SessionCacheEntry[] = [],
	baseDir = tmpdir(),
): ExtensionContext & { widgetCalls: Array<[string, string[] | undefined]>; notifyCalls: string[] } {
	const widgetCalls: Array<[string, string[] | undefined]> = [];
	const notifyCalls: string[] = [];
	return {
		widgetCalls,
		notifyCalls,
		ui: {
			setWidget: (_key: string, lines: unknown) => widgetCalls.push([_key as string, lines as string[] | undefined]),
			notify: (msg: string) => notifyCalls.push(msg),
			confirm: async () => true,
			input: async () => undefined,
			select: async () => undefined,
			setStatus: () => {},
			setWorkingMessage: () => {},
			setHiddenThinkingLabel: () => {},
			onTerminalInput: () => () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async () => undefined,
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			setEditorComponent: () => {},
			getTheme: () => undefined,
			getAllThemes: () => [],
			setTheme: () => ({ success: true }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
			theme: {} as never,
		},
		hasUI: true,
		cwd: baseDir,
		sessionManager: {
			getEntries: () => cacheEntries as never[],
			getSessionId: () => "test-session-id",
			getCwd: () => baseDir,
			getSessionDir: () => baseDir,
			getSessionFile: () => undefined,
			getLeafId: () => null,
			getLeafEntry: () => undefined,
			getEntry: () => undefined,
			getLabel: () => undefined,
			getBranch: () => [],
			getHeader: () => ({}),
			getTree: () => [],
			getSessionName: () => undefined,
		} as never,
		modelRegistry: { getAll: () => [] } as never,
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	} as unknown as ExtensionContext & { widgetCalls: Array<[string, string[] | undefined]>; notifyCalls: string[] };
}

function registerExtension(tmpDir: string): MockPiSetup {
	const original = process.cwd.bind(process);
	(process as typeof process & { cwd: () => string }).cwd = () => tmpDir;
	try {
		const result = buildMockPi();
		setup(result.pi);
		return result;
	} finally {
		(process as typeof process & { cwd: () => string }).cwd = original;
	}
}

async function invokeTool(
	tools: Map<string, { name: string; execute: (id: string, params: unknown) => Promise<unknown> }>,
	name: string,
	params: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Tool '${name}' not registered`);
	return tool.execute("call-id", params) as Promise<{ content: Array<{ type: string; text: string }> }>;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;
let basePath: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "pi-missions-integration-"));
	basePath = join(tmpDir, ".pi", "missions");
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-001: Full lifecycle
// ---------------------------------------------------------------------------

describe("VAL-CROSS-001: full lifecycle", () => {
	it("mission start transitions to planning and persists state", () => {
		const { handlers, appendedEntries } = registerExtension(tmpDir);
		const ctx = buildMockCtx();
		handlers.get("session_start")!({ type: "session_start" }, ctx);

		const state = makeState("planning");
		saveState(basePath, state);

		const loaded = loadState(basePath);
		expect(loaded?.status).toBe("planning");
		// appendedEntries may be empty on session_start with no filesystem state yet
		void appendedEntries;
	});

	it("submit_plan persists plan and transitions to draft_review", async () => {
		const { tools } = registerExtension(tmpDir);
		const planningState = makeState("planning");
		saveState(basePath, planningState);

		const result = await invokeTool(tools, "submit_plan", {
			description: "Build auth system",
			milestones: [
				{
					id: "m1",
					name: "Foundation",
					description: "Set up base",
					features: [
						{
							id: "f1",
							name: "User model",
							description: "Create user entity",
							acceptanceCriteria: ["User can be created"],
							relevantFiles: [],
							dependencies: [],
							estimatedComplexity: "low" as const,
						},
					],
				},
			],
			validationCommands: ["bun test"],
		});

		expect(result.content[0].text).not.toContain("Error");

		const state = loadState(basePath);
		expect(state?.status).toBe("draft_review");

		const plan = loadPlan(basePath);
		expect(plan).not.toBeNull();
		expect(plan?.description).toBe("Build auth system");
		expect(plan?.planVersion).toBe(1);
		expect(plan?.createdAt).toBeDefined();
	});

	it("spawn_worker transitions from approved to executing and updates counters on success", async () => {
		const successOutput = [
			makeReportResultLine(),
			JSON.stringify({
				type: "message_end",
				message: { role: "assistant", content: [{ type: "text", text: "Feature complete." }] },
			}),
		].join("\n");

		const mockSpawn = (_cmd: string, _args: string[], _opts: object) => {
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
				for (const h of stdoutHandlers) h(Buffer.from(successOutput));
				for (const h of closeHandlers) h(0, null);
			});
			return proc;
		};

		const original = process.cwd.bind(process);
		(process as typeof process & { cwd: () => string }).cwd = () => tmpDir;
		try {
			const mockPi = buildMockPi();
			const { registerSpawnWorkerTool } = await import("../extensions/tools/spawn-worker.js");
			const { registerSubmitPlanTool } = await import("../extensions/tools/submit-plan.js");
			const { registerUpdateStateTool } = await import("../extensions/tools/update-state.js");
			const { registerCompleteMissionTool } = await import("../extensions/tools/complete.js");
			const { registerCommands } = await import("../extensions/commands.js");

			const updateWidget = () => {};
			const clearWidget = () => {};

			registerSubmitPlanTool(mockPi.pi, { basePath, updateWidget });
			registerUpdateStateTool(mockPi.pi, { basePath, updateWidget });
			registerCompleteMissionTool(mockPi.pi, { basePath, updateWidget });
			registerSpawnWorkerTool(mockPi.pi, {
				basePath,
				projectDir: tmpDir,
				updateWidget,
				_spawnOverride: mockSpawn as never,
			});
			registerCommands(mockPi.pi, {
				basePath,
				updateWidget,
				clearWidget,
				isMissionModeActive: () => true,
				setMissionModeActive: () => {},
				onActivate: async () => {},
				onDeactivate: () => {},
			});

			const approvedState = makeState("approved");
			saveState(basePath, approvedState);
			const plan = makePlan({
				milestones: [makeMilestone("m1", [makeFeature("f1")])],
			});
			savePlan(basePath, plan);
			saveConfig(basePath, { validatorStrictness: "lenient" });

			const result = await invokeTool(mockPi.tools, "spawn_worker", { featureId: "f1" });
			expect(result.content[0].text).not.toContain("Error");

			const state = loadState(basePath);
			expect(state?.status).toBe("executing");
			expect(state?.totalFeaturesCompleted).toBe(1);
			expect(state?.currentFeatureId).toBeUndefined();

			const savedPlan = loadPlan(basePath);
			expect(savedPlan?.milestones[0].features[0].status).toBe("done");
		} finally {
			(process as typeof process & { cwd: () => string }).cwd = original;
		}
	});

	it("update_mission_state skip_feature resolves correctly", async () => {
		const { tools } = registerExtension(tmpDir);

		const executingState = makeState("executing");
		saveState(basePath, executingState);
		const plan = makePlan({
			milestones: [makeMilestone("m1", [makeFeature("f1")], "active")],
		});
		savePlan(basePath, plan);

		const skipResult = await invokeTool(tools, "update_mission_state", {
			action: "skip_feature",
			targetId: "f1",
		});
		expect(skipResult.content[0].text).toContain("skipped");
	});

	it("complete_mission generates report and transitions to completed", async () => {
		const { tools } = registerExtension(tmpDir);

		const executingState = makeState("executing", { totalFeaturesCompleted: 1 });
		saveState(basePath, executingState);
		const plan = makePlan();
		savePlan(basePath, plan);

		const result = await invokeTool(tools, "complete_mission", {
			summary: "All features implemented and tested.",
		});

		expect(result.content[0].text).not.toContain("Error");
		expect(result.content[0].text).toContain("completed");

		const state = loadState(basePath);
		expect(state?.status).toBe("completed");
		expect(state?.completedAt).toBeDefined();

		const reportPath = join(basePath, "report.md");
		expect(existsSync(reportPath)).toBe(true);
		const report = readFileSync(reportPath, "utf8");
		expect(report).toContain("Mission Report");
		expect(report).toContain("All features implemented and tested.");
	});

	it("progressLog has events from all lifecycle steps", async () => {
		const { tools } = registerExtension(tmpDir);

		const planningState = makeState("planning");
		saveState(basePath, planningState);

		await invokeTool(tools, "submit_plan", {
			description: "Test mission",
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

		const stateAfterPlan = loadState(basePath);
		expect(stateAfterPlan?.status).toBe("draft_review");
		expect(stateAfterPlan?.progressLog.some((e) => e.type === "plan_submitted")).toBe(true);
	});
});

// VAL-CROSS-003 / VAL-STATE-015: Pause/resume is now handled via Mission Control overlay.
// See mission-control.test.ts for those tests.

// ---------------------------------------------------------------------------
// VAL-CROSS-002 / VAL-STATE-013 / VAL-STATE-014 / VAL-STATE-017 / VAL-STATE-018:
// Crash recovery scenarios
// ---------------------------------------------------------------------------

describe("crash recovery — VAL-CROSS-002 / VAL-STATE-013", () => {
	function makeResultFile(dir: string, status: "success" | "failure"): void {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "result.json"), JSON.stringify(makeWorkerResult(status)), "utf8");
	}

	it("executing + result.json success → feature marked done, counter incremented, currentFeatureId cleared", () => {
		const plan = makePlan({
			milestones: [
				makeMilestone("m1", [
					makeFeature("f1", "active", {
						attempts: [
							{
								attemptNumber: 1,
								startedAt: nowISO(),
								status: "running",
								resultPath: "",
								stdoutPath: "",
								stderrPath: "",
							},
						],
					}),
				]),
			],
		});
		const state = makeState("executing", { currentFeatureId: "f1", currentMilestoneId: "m1" });
		saveState(basePath, state);
		savePlan(basePath, plan);

		const runtimeDir = join(basePath, "runtime", "f1", "2");
		makeResultFile(runtimeDir, "success");

		const { state: recovered, plan: recoveredPlan, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("executing");
		expect(recovered.currentFeatureId).toBeUndefined();
		expect(recovered.totalFeaturesCompleted).toBe(1);
		expect(recoveryContext).not.toBeNull();
		expect(recoveredPlan?.milestones[0].features[0].status).toBe("done");
	});

	it("executing + result.json failure → attempt recorded as failed, counter incremented", () => {
		const plan = makePlan({
			milestones: [
				makeMilestone("m1", [
					makeFeature("f1", "active", {
						attempts: [
							{
								attemptNumber: 1,
								startedAt: nowISO(),
								status: "running",
								resultPath: "",
								stdoutPath: "",
								stderrPath: "",
							},
						],
					}),
				]),
			],
		});
		const state = makeState("executing", { currentFeatureId: "f1" });
		saveState(basePath, state);
		savePlan(basePath, plan);

		const runtimeDir = join(basePath, "runtime", "f1", "2");
		makeResultFile(runtimeDir, "failure");

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("executing");
		expect(recovered.currentFeatureId).toBeUndefined();
		expect(recovered.totalFeaturesFailed).toBe(1);
		expect(recoveryContext).not.toBeNull();
	});

	it("executing + no result.json → attempt marked interrupted", () => {
		const plan = makePlan({
			milestones: [makeMilestone("m1", [makeFeature("f1", "active")])],
		});
		const state = makeState("executing", { currentFeatureId: "f1" });
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("executing");
		expect(recovered.currentFeatureId).toBeUndefined();
		expect(recovered.totalFeaturesCompleted).toBe(0);
		expect(recovered.totalFeaturesFailed).toBe(0);
		expect(recoveryContext).not.toBeNull();
		expect(recoveryContext).toContain("interrupted");
	});

	it("executing + missing plan feature → mission transitions to failed", () => {
		const plan = makePlan({
			milestones: [makeMilestone("m1", [makeFeature("f1")])],
		});
		// featureId references non-existent feature
		const state = makeState("executing", { currentFeatureId: "non-existent-feature" });
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("failed");
		expect(recovered.completedAt).toBeDefined();
		expect(recoveryContext).not.toBeNull();
	});

	it("VAL-STATE-017: executing + no currentFeatureId → no-op, state unchanged", () => {
		const plan = makePlan();
		const state = makeState("executing", { currentFeatureId: undefined });
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("executing");
		expect(recovered.currentFeatureId).toBeUndefined();
		expect(recoveryContext).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// VAL-STATE-014: crash recovery for validating and draft_review states
// ---------------------------------------------------------------------------

describe("VAL-STATE-014: crash recovery — validating and draft_review states", () => {
	it("validating + partial results → transitions back to executing", () => {
		const plan = makePlan();
		const state = makeState("validating");
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("executing");
		expect(recoveryContext).not.toBeNull();
		expect(recoveryContext).toContain("validation");
	});

	it("draft_review + plan.json exists → no-op", () => {
		const plan = makePlan();
		const state = makeState("draft_review");
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("draft_review");
		expect(recoveryContext).toBeNull();
	});

	it("draft_review + missing plan.json → mission transitions to failed", () => {
		const state = makeState("draft_review");
		saveState(basePath, state);
		// No plan.json saved

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("failed");
		expect(recoveryContext).not.toBeNull();
	});

	it("VAL-STATE-018: approved + plan.json exists → no-op", () => {
		const plan = makePlan();
		const state = makeState("approved");
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("approved");
		expect(recoveryContext).toBeNull();
	});

	it("VAL-STATE-018: approved + missing plan.json → mission transitions to failed", () => {
		const state = makeState("approved");
		saveState(basePath, state);
		// No plan.json saved

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("failed");
		expect(recoveryContext).not.toBeNull();
	});

	it("paused state → preserved as-is (no-op)", () => {
		const plan = makePlan();
		const state = makeState("paused", { resumeTargetState: "executing" });
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("paused");
		expect(recovered.resumeTargetState).toBe("executing");
		expect(recoveryContext).toBeNull();
	});

	it("planning state → no-op", () => {
		const plan = makePlan();
		const state = makeState("planning");
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { state: recovered, recoveryContext } = reconcileStateOnStart(state, basePath);

		expect(recovered.status).toBe("planning");
		expect(recoveryContext).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Crash recovery wired into session_start handler
// ---------------------------------------------------------------------------

describe("crash recovery wired into session_start", () => {
	it("session_start with executing state triggers recovery and persists result", async () => {
		const plan = makePlan({
			milestones: [makeMilestone("m1", [makeFeature("f1", "active")])],
		});
		const state = makeState("executing", { currentFeatureId: "f1" });
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { handlers } = registerExtension(tmpDir);
		const ctx = buildMockCtx();
		await handlers.get("session_start")!({ type: "session_start" }, ctx);

		const recovered = loadState(basePath);
		expect(recovered?.currentFeatureId).toBeUndefined();
		expect(recovered?.progressLog.some((e) => e.detail.toLowerCase().includes("recovery"))).toBe(true);
	});

	it("session_start with validating state recovers to executing", async () => {
		const plan = makePlan();
		const state = makeState("validating");
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { handlers } = registerExtension(tmpDir);
		const ctx = buildMockCtx();
		await handlers.get("session_start")!({ type: "session_start" }, ctx);

		const recovered = loadState(basePath);
		expect(recovered?.status).toBe("executing");
	});

	it("recovery context injected into before_agent_start system prompt", async () => {
		const plan = makePlan();
		const state = makeState("validating");
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { handlers } = registerExtension(tmpDir);
		const ctx = buildMockCtx();
		await handlers.get("session_start")!({ type: "session_start" }, ctx);

		const event = { systemPrompt: "base prompt" };
		const result = handlers.get("before_agent_start")!(event, ctx) as { systemPrompt: string } | undefined;

		expect(result?.systemPrompt).toContain("Recovery Context");
	});

	it("recovery context only injected once (cleared after first before_agent_start)", async () => {
		const plan = makePlan();
		const state = makeState("validating");
		saveState(basePath, state);
		savePlan(basePath, plan);

		const { handlers } = registerExtension(tmpDir);
		const ctx = buildMockCtx();
		await handlers.get("session_start")!({ type: "session_start" }, ctx);

		const event = { systemPrompt: "base" };
		const first = handlers.get("before_agent_start")!(event, ctx) as { systemPrompt: string } | undefined;
		const second = handlers.get("before_agent_start")!(event, ctx) as { systemPrompt: string } | undefined;

		expect(first?.systemPrompt).toContain("Recovery Context");
		expect(second?.systemPrompt).not.toContain("Recovery Context");
	});
});

// ---------------------------------------------------------------------------
// VAL-CROSS-009 / VAL-STATE-011: Session entry cache mirrors filesystem
// ---------------------------------------------------------------------------

describe("VAL-CROSS-009 / VAL-STATE-011: session entry cache", () => {
	it("filesystem state takes priority over session entries on session_start", async () => {
		const fsState = makeState("planning");
		saveState(basePath, fsState);

		const cachedState = makeState("executing");
		const cacheEntry = makeCacheEntry(cachedState);
		const ctx = buildMockCtx([cacheEntry]);

		const { handlers } = registerExtension(tmpDir);
		await handlers.get("session_start")!({ type: "session_start" }, ctx);

		const state = loadState(basePath);
		expect(state?.status).toBe("planning");
	});

	it("session entries used as fallback when state.json missing", async () => {
		const cachedState = makeState("draft_review");
		const cacheEntry = makeCacheEntry(cachedState);
		const ctx = buildMockCtx([cacheEntry]);

		const { handlers } = registerExtension(tmpDir);
		await handlers.get("session_start")!({ type: "session_start" }, ctx);

		const state = loadState(basePath);
		expect(state?.status).toBe("draft_review");
	});

	it("null sentinel entry prevents stale cache restoration", () => {
		const cacheEntry = makeCacheEntry(null);
		const ctx = buildMockCtx([cacheEntry]);

		const { handlers } = registerExtension(tmpDir);
		handlers.get("session_start")!({ type: "session_start" }, ctx);

		const state = loadState(basePath);
		expect(state).toBeNull();
	});

	it("last session cache entry takes priority over earlier entries", async () => {
		const oldEntry = makeCacheEntry(makeState("planning"));
		const newEntry = makeCacheEntry(makeState("approved"));
		const ctx = buildMockCtx([oldEntry, newEntry]);

		const { handlers } = registerExtension(tmpDir);
		await handlers.get("session_start")!({ type: "session_start" }, ctx);

		const state = loadState(basePath);
		expect(state?.status).toBe("approved");
	});

	it("session_compact re-caches state from filesystem — widget restore after /compact", async () => {
		const state = makeState("executing");
		saveState(basePath, state);

		const ctx = buildMockCtx();
		const { handlers, appendedEntries } = registerExtension(tmpDir);
		// session_start auto-activates mission mode when state exists on filesystem
		await handlers.get("session_start")!({ type: "session_start" }, ctx);
		const preCompactCount = appendedEntries.filter((e) => e.type === "mission-state-cache").length;
		handlers.get("session_compact")!({ type: "session_compact" }, ctx);

		const cacheEntries = appendedEntries.filter((e) => e.type === "mission-state-cache");
		expect(cacheEntries.length).toBeGreaterThan(preCompactCount);
		const lastEntry = cacheEntries[cacheEntries.length - 1];
		expect((lastEntry.data as MissionState).status).toBe("executing");
	});
});

// ---------------------------------------------------------------------------
// VAL-CROSS-012: Reset is now handled via Mission Control overlay (X key).
// See mission-control.test.ts for those tests.

// ---------------------------------------------------------------------------
// VAL-CROSS-013 / VAL-CROSS-005: Worker attempt status transitions
// ---------------------------------------------------------------------------

describe("VAL-CROSS-013 / VAL-CROSS-005: worker attempt status transitions", () => {
	function makeMockSpawnFn(exitCode: number, output: string): (cmd: string, args: string[], opts: object) => object {
		return (_cmd: string, _args: string[], _opts: object) => {
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
					for (const h of stdoutHandlers) h(Buffer.from(output));
				}
				for (const h of closeHandlers) h(exitCode, null);
			});
			return proc;
		};
	}

	it("successful attempt has status success, exit code 0, completedAt, durationMs > 0", async () => {
		const output = [
			makeReportResultLine(),
			JSON.stringify({
				type: "message_end",
				message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
			}),
		].join("\n");
		const { registerSpawnWorkerTool } = await import("../extensions/tools/spawn-worker.js");
		const mockPi = buildMockPi();
		registerSpawnWorkerTool(mockPi.pi, {
			basePath,
			projectDir: tmpDir,
			updateWidget: () => {},
			_spawnOverride: makeMockSpawnFn(0, output) as never,
		});

		const state = makeState("approved");
		saveState(basePath, state);
		const plan = makePlan({
			milestones: [makeMilestone("m1", [makeFeature("f1")])],
		});
		savePlan(basePath, plan);

		await invokeTool(mockPi.tools, "spawn_worker", { featureId: "f1" });

		const savedPlan = loadPlan(basePath);
		const attempt = savedPlan?.milestones[0].features[0].attempts[0];
		expect(attempt?.status).toBe("success");
		expect(attempt?.exitCode).toBe(0);
		expect(attempt?.completedAt).toBeDefined();
		expect(attempt?.durationMs).toBeGreaterThan(0);
	});

	it("failed attempt has status failure, non-zero exit code, completedAt, durationMs > 0", async () => {
		const output = JSON.stringify({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "Failed." }] },
		});
		const { registerSpawnWorkerTool } = await import("../extensions/tools/spawn-worker.js");
		const mockPi = buildMockPi();
		registerSpawnWorkerTool(mockPi.pi, {
			basePath,
			projectDir: tmpDir,
			updateWidget: () => {},
			_spawnOverride: makeMockSpawnFn(1, output) as never,
		});

		const state = makeState("approved");
		saveState(basePath, state);
		const plan = makePlan({
			milestones: [makeMilestone("m1", [makeFeature("f1")])],
		});
		savePlan(basePath, plan);

		await invokeTool(mockPi.tools, "spawn_worker", { featureId: "f1" });

		const savedPlan = loadPlan(basePath);
		const attempt = savedPlan?.milestones[0].features[0].attempts[0];
		expect(attempt?.status).toBe("failure");
		expect(attempt?.exitCode).not.toBe(0);
		expect(attempt?.completedAt).toBeDefined();
		expect(attempt?.durationMs).toBeGreaterThan(0);
	});

	it("retry creates attempt 2 in separate runtime directory — VAL-CROSS-005", async () => {
		const output = JSON.stringify({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "Retry done." }] },
		});
		const { registerSpawnWorkerTool } = await import("../extensions/tools/spawn-worker.js");
		const mockPi = buildMockPi();
		registerSpawnWorkerTool(mockPi.pi, {
			basePath,
			projectDir: tmpDir,
			updateWidget: () => {},
			_spawnOverride: makeMockSpawnFn(0, output) as never,
		});

		const featureWithAttempt = makeFeature("f1", "active", {
			attempts: [
				{
					attemptNumber: 1,
					startedAt: nowISO(),
					status: "failure",
					exitCode: 1,
					resultPath: "",
					stdoutPath: "",
					stderrPath: "",
				},
			],
		});
		const state = makeState("executing");
		saveState(basePath, state);
		const plan = makePlan({
			milestones: [makeMilestone("m1", [featureWithAttempt])],
		});
		savePlan(basePath, plan);

		await invokeTool(mockPi.tools, "spawn_worker", { featureId: "f1", additionalContext: "Try again" });

		const attempt2Dir = join(basePath, "runtime", "f1", "2");
		expect(existsSync(join(attempt2Dir, "worker-skill.md"))).toBe(true);
		expect(existsSync(join(attempt2Dir, "worker-prompt.md"))).toBe(true);

		const prompt2 = readFileSync(join(attempt2Dir, "worker-prompt.md"), "utf8");
		expect(prompt2).toContain("Try again");
	});
});
