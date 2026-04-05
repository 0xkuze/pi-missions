import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
// Import the default export directly
import setup from "../extensions/index.js";
import { acquireLock, isLocked } from "../extensions/state/lock.js";
import { saveState } from "../extensions/state/manager.js";
import type { ActiveSession, MissionState } from "../extensions/types.js";
import { nowISO } from "../extensions/utils.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePlanningState(): MissionState {
	return {
		missionId: "test-mission",
		status: "planning",
		progressLog: [],
		startedAt: new Date(Date.now() - 60_000).toISOString(),
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
	};
}

function makeExecutingState(): MissionState {
	return { ...makePlanningState(), status: "executing" };
}

function makeCompletedState(): MissionState {
	return { ...makePlanningState(), status: "completed", completedAt: nowISO() };
}

type SessionCacheEntry = { type: "custom"; customType: string; data?: unknown };

interface MockPiSetup {
	pi: ExtensionAPI;
	appendedEntries: Array<{ type: string; data: unknown }>;
	handlers: Map<string, (event: unknown, ctx: ExtensionContext) => unknown>;
	tools: Map<string, unknown>;
	commands: Map<string, unknown>;
	shortcuts: Map<string, unknown>;
}

function buildMockPi(): MockPiSetup {
	const appendedEntries: Array<{ type: string; data: unknown }> = [];
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const tools = new Map<string, unknown>();
	const commands = new Map<string, unknown>();
	const shortcuts = new Map<string, unknown>();

	const pi = {
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
			handlers.set(event, handler);
		},
		appendEntry: (type: string, data: unknown) => appendedEntries.push({ type, data }),
		registerTool: (tool: { name: string }) => tools.set(tool.name, tool),
		registerCommand: (name: string, opts: unknown) => commands.set(name, opts),
		registerShortcut: (shortcut: string, opts: unknown) => shortcuts.set(shortcut, opts),
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
		setSessionName: () => {},
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

	return { pi, appendedEntries, handlers, tools, commands, shortcuts };
}

function buildMockCtx(cacheEntries: SessionCacheEntry[] = [], sessionId = "test-session-id"): ExtensionContext {
	return {
		ui: {
			setWidget: mock(),
			notify: () => {},
			confirm: async () => false,
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
		cwd: tmpdir(),
		sessionManager: {
			getEntries: () => cacheEntries as never[],
			getSessionId: () => sessionId,
			getCwd: () => tmpdir(),
			getSessionDir: () => tmpdir(),
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
		modelRegistry: {} as never,
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	} as unknown as ExtensionContext;
}

function makeCacheEntry(data: unknown): SessionCacheEntry {
	return { type: "custom", customType: "mission-state-cache", data };
}

/**
 * Register the extension and capture all handlers/tools/commands.
 * Temporarily overrides process.cwd() so that basePath resolves to tmpDir.
 */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extension entry point (index.ts)", () => {
	let tmpDir: string;
	let basePath: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pi-missions-index-test-"));
		basePath = join(tmpDir, ".pi", "missions");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("registration", () => {
		it("registers all four orchestrator tools", () => {
			const { tools } = registerExtension(tmpDir);
			expect(tools.has("submit_plan")).toBe(true);
			expect(tools.has("spawn_worker")).toBe(true);
			expect(tools.has("update_mission_state")).toBe(true);
			expect(tools.has("complete_mission")).toBe(true);
		});

		it("registers all slash commands", () => {
			const { commands } = registerExtension(tmpDir);
			expect(commands.has("mission")).toBe(true);
			expect(commands.has("mission-approve")).toBe(true);
			expect(commands.has("mission-pause")).toBe(true);
			expect(commands.has("mission-resume")).toBe(true);
			expect(commands.has("mission-skip")).toBe(true);
			expect(commands.has("mission-reset")).toBe(true);
			expect(commands.has("mission-status")).toBe(true);
			expect(commands.has("mission-plan")).toBe(true);
		});

		it("registers Ctrl+Shift+M shortcut", () => {
			const { shortcuts } = registerExtension(tmpDir);
			expect(shortcuts.has("ctrl+shift+m")).toBe(true);
		});

		it("registers event handlers for session_start, before_agent_start, session_compact", () => {
			const { handlers } = registerExtension(tmpDir);
			expect(handlers.has("session_start")).toBe(true);
			expect(handlers.has("before_agent_start")).toBe(true);
			expect(handlers.has("session_compact")).toBe(true);
		});
	});

	describe("session_start handler u2014 VAL-STATE-011", () => {
		it("loads state from filesystem when it exists (filesystem takes priority)", () => {
			const state = makePlanningState();
			saveState(basePath, state);

			// Session entries have a different state u2014 filesystem should win
			const differentState = makeExecutingState();
			const cacheEntry = makeCacheEntry(differentState);
			const ctx = buildMockCtx([cacheEntry]);
			const setWidgetCalls: Array<[string, unknown]> = [];
			ctx.ui.setWidget = (_key: string, content: unknown) => setWidgetCalls.push([_key as string, content]);

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			handler({ type: "session_start", reason: "startup" }, ctx);

			// Widget should be set with content (component factory function from themed rendering)
			const contentCalls = setWidgetCalls.filter(([, content]) => typeof content === "function");
			expect(contentCalls.length).toBeGreaterThan(0);
		});

		it("falls back to session entries when filesystem state is absent", () => {
			// No filesystem state u2014 only session entry cache
			const cachedState = makePlanningState();
			const cacheEntry = makeCacheEntry(cachedState);
			const ctx = buildMockCtx([cacheEntry]);
			const setWidgetCalls: Array<[string, unknown]> = [];
			ctx.ui.setWidget = (_key: string, content: unknown) => setWidgetCalls.push([_key as string, content]);

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			handler({ type: "session_start", reason: "startup" }, ctx);

			// Widget should be set from the cached state
			const contentCalls = setWidgetCalls.filter(([, content]) => typeof content === "function");
			expect(contentCalls.length).toBeGreaterThan(0);
		});

		it("null sentinel in session entries prevents stale restore (VAL-CROSS-012)", () => {
			// No filesystem state AND null sentinel in session entries
			const nullEntry = makeCacheEntry(null);
			const ctx = buildMockCtx([nullEntry]);
			const setWidgetCalls: Array<[string, unknown]> = [];
			ctx.ui.setWidget = (_key: string, content: unknown) => setWidgetCalls.push([_key as string, content]);

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			handler({ type: "session_start", reason: "startup" }, ctx);

			// Widget must NOT be set with content u2014 null sentinel prevents stale restore
			const contentCalls = setWidgetCalls.filter(([, content]) => typeof content === "function");
			expect(contentCalls.length).toBe(0);
		});

		it("does nothing when no filesystem state and no session entries", () => {
			const ctx = buildMockCtx([]);
			const setWidgetCalls: Array<[string, unknown]> = [];
			ctx.ui.setWidget = (_key: string, content: unknown) => setWidgetCalls.push([_key as string, content]);

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			handler({ type: "session_start", reason: "startup" }, ctx);

			const contentCalls = setWidgetCalls.filter(([, content]) => typeof content === "function");
			expect(contentCalls.length).toBe(0);
		});

		it("uses the last cache entry when multiple exist", () => {
			// Two entries: first has planning state, last has executing state
			const oldEntry = makeCacheEntry(makePlanningState());
			const newerEntry = makeCacheEntry(makeExecutingState());
			const ctx = buildMockCtx([oldEntry, newerEntry]);
			const setWidgetCalls: Array<[string, unknown]> = [];
			ctx.ui.setWidget = (_key: string, content: unknown) => setWidgetCalls.push([_key as string, content]);

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			handler({ type: "session_start", reason: "startup" }, ctx);

			// Widget should be set with content (component factory)
			const contentCalls = setWidgetCalls.filter(([, content]) => typeof content === "function");
			expect(contentCalls.length).toBeGreaterThan(0);
		});

		it("null sentinel in cache takes priority over earlier state entries", () => {
			// Earlier entry is a state, later entry is null sentinel
			const stateEntry = makeCacheEntry(makePlanningState());
			const nullEntry = makeCacheEntry(null);
			const ctx = buildMockCtx([stateEntry, nullEntry]);
			const setWidgetCalls: Array<[string, unknown]> = [];
			ctx.ui.setWidget = (_key: string, content: unknown) => setWidgetCalls.push([_key as string, content]);

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			handler({ type: "session_start", reason: "startup" }, ctx);

			// null sentinel must prevent restore even if there was an earlier valid cache entry
			const contentCalls = setWidgetCalls.filter(([, content]) => typeof content === "function");
			expect(contentCalls.length).toBe(0);
		});

		it("does not throw for terminal state restored from filesystem", () => {
			const completedState = makeCompletedState();
			saveState(basePath, completedState);

			const ctx = buildMockCtx([]);
			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;

			expect(() => handler({ type: "session_start", reason: "startup" }, ctx)).not.toThrow();
		});
	});

	describe("before_agent_start handler u2014 VAL-PROTO-006", () => {
		it("returns undefined when no state exists", () => {
			const ctx = buildMockCtx([]);
			const event = { type: "before_agent_start", prompt: "hello", systemPrompt: "base prompt" };

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("before_agent_start")!;
			const result = handler(event, ctx);

			expect(result).toBeUndefined();
		});

		it("returns undefined for terminal states (completed, failed, aborted) u2014 VAL-PROTO-005", () => {
			for (const status of ["completed", "failed", "aborted"] as const) {
				const state: MissionState = {
					...makePlanningState(),
					status,
					completedAt: nowISO(),
				};
				saveState(basePath, state);

				const ctx = buildMockCtx([]);
				const event = { type: "before_agent_start", prompt: "", systemPrompt: "base" };

				const { handlers } = registerExtension(tmpDir);
				const handler = handlers.get("before_agent_start")!;
				const result = handler(event, ctx);

				expect(result).toBeUndefined();

				// Clean up between iterations
				rmSync(basePath, { recursive: true, force: true });
			}
		});

		it("appends protocol to systemPrompt for active states (planning)", () => {
			const state = makePlanningState();
			saveState(basePath, state);

			const ctx = buildMockCtx([]);
			const originalPrompt = "You are a coding assistant.";
			const event = { type: "before_agent_start", prompt: "do stuff", systemPrompt: originalPrompt };

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("before_agent_start")!;
			const result = handler(event, ctx) as { systemPrompt: string } | undefined;

			expect(result).toBeDefined();
			expect(result!.systemPrompt).toContain(originalPrompt);
			expect(result!.systemPrompt.length).toBeGreaterThan(originalPrompt.length);
		});

		it("preserves original systemPrompt as prefix", () => {
			const state = makePlanningState();
			saveState(basePath, state);

			const ctx = buildMockCtx([]);
			const originalPrompt = "ORIGINAL_PREFIX_CONTENT";
			const event = { type: "before_agent_start", prompt: "", systemPrompt: originalPrompt };

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("before_agent_start")!;
			const result = handler(event, ctx) as { systemPrompt: string } | undefined;

			expect(result).toBeDefined();
			expect(result!.systemPrompt.startsWith(originalPrompt)).toBe(true);
		});

		it("injects non-empty protocol for all active states", () => {
			const testStates: MissionState[] = [
				makePlanningState(),
				{ ...makePlanningState(), status: "draft_review" },
				{ ...makePlanningState(), status: "approved" },
				{ ...makePlanningState(), status: "executing" },
				{ ...makePlanningState(), status: "validating" },
				{ ...makePlanningState(), status: "paused", resumeTargetState: "executing" },
			];

			for (const state of testStates) {
				saveState(basePath, state);

				const ctx = buildMockCtx([]);
				const event = { type: "before_agent_start", prompt: "", systemPrompt: "" };

				const { handlers } = registerExtension(tmpDir);
				const handler = handlers.get("before_agent_start")!;
				const result = handler(event, ctx) as { systemPrompt: string } | undefined;

				expect(result).toBeDefined();
				expect(result!.systemPrompt.length).toBeGreaterThan(0);

				rmSync(basePath, { recursive: true, force: true });
			}
		});

		it("does not modify systemPrompt for null/idle/terminal states", () => {
			// No state u2014 idle
			const ctx = buildMockCtx([]);
			const event = { type: "before_agent_start", prompt: "", systemPrompt: "base" };

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("before_agent_start")!;
			const result = handler(event, ctx);

			expect(result).toBeUndefined();
		});
	});

	describe("session_shutdown handler", () => {
		it("registers session_shutdown event handler", () => {
			const { handlers } = registerExtension(tmpDir);
			expect(handlers.has("session_shutdown")).toBe(true);
		});

		it("pauses an executing mission on shutdown", () => {
			const state = makeExecutingState();
			saveState(basePath, state);

			const ctx = buildMockCtx([]);
			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_shutdown")!;
			handler({ type: "session_shutdown" }, ctx);

			const saved = JSON.parse(readFileSync(join(basePath, "state.json"), "utf8"));
			expect(saved.status).toBe("paused");
		});

		it("does not crash on completed state", () => {
			const state = makeCompletedState();
			saveState(basePath, state);

			const ctx = buildMockCtx([]);
			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_shutdown")!;
			expect(() => handler({ type: "session_shutdown" }, ctx)).not.toThrow();
		});

		it("does not crash when no state exists", () => {
			const ctx = buildMockCtx([]);
			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_shutdown")!;
			expect(() => handler({ type: "session_shutdown" }, ctx)).not.toThrow();
		});
	});

	describe("session_compact handler u2014 VAL-STATE-011", () => {
		it("re-caches state from filesystem after compaction", () => {
			const state = makePlanningState();
			saveState(basePath, state);

			const ctx = buildMockCtx([]);
			const { handlers, appendedEntries } = registerExtension(tmpDir);
			const handler = handlers.get("session_compact")!;
			handler({ type: "session_compact", compactionEntry: {}, fromExtension: false }, ctx);

			const cacheEntries = appendedEntries.filter((e) => e.type === "mission-state-cache");
			expect(cacheEntries.length).toBeGreaterThan(0);
			expect(cacheEntries[cacheEntries.length - 1].data).not.toBeNull();
		});

		it("does not append cache entry when no filesystem state exists", () => {
			// No state on filesystem
			const ctx = buildMockCtx([]);
			const { handlers, appendedEntries } = registerExtension(tmpDir);
			const handler = handlers.get("session_compact")!;
			handler({ type: "session_compact", compactionEntry: {}, fromExtension: false }, ctx);

			const cacheEntries = appendedEntries.filter((e) => e.type === "mission-state-cache");
			expect(cacheEntries.length).toBe(0);
		});
	});

	describe("session entry cache mirror u2014 VAL-STATE-011", () => {
		it("session_compact re-caches state to restore widget after compaction", () => {
			const state = makePlanningState();
			saveState(basePath, state);

			const ctx = buildMockCtx([]);
			const { handlers, appendedEntries } = registerExtension(tmpDir);

			// Simulate /compact
			const compactHandler = handlers.get("session_compact")!;
			compactHandler({ type: "session_compact", compactionEntry: {}, fromExtension: false }, ctx);

			const cacheEntries = appendedEntries.filter((e) => e.type === "mission-state-cache");
			expect(cacheEntries.length).toBeGreaterThan(0);
			const lastEntry = cacheEntries[cacheEntries.length - 1];
			expect(lastEntry.data).not.toBeNull();
			// The cached data should be the current state
			const cached = lastEntry.data as MissionState;
			expect(cached.status).toBe("planning");
		});
	});

	describe("lock observe/takeover UX u2014 VAL-LOCK-001, VAL-LOCK-002", () => {
		function makeLiveLockSession(sessionId = "other-session"): ActiveSession {
			return {
				sessionId,
				pid: process.pid,
				startedAt: nowISO(),
				lastHeartbeatAt: nowISO(),
			};
		}

		function makeStaleLockSession(sessionId = "dead-session"): ActiveSession {
			return {
				sessionId,
				pid: 999_999_999,
				startedAt: nowISO(),
				lastHeartbeatAt: nowISO(),
			};
		}

		it("VAL-LOCK-001: live lock prompts user to observe (confirm called) u2014 not silent failure", async () => {
			const state = makePlanningState();
			saveState(basePath, state);
			acquireLock(basePath, makeLiveLockSession());

			const confirmCalls: Array<[string, string]> = [];
			const ctx = buildMockCtx([], "my-session");
			ctx.ui.confirm = async (title: string, message: string) => {
				confirmCalls.push([title, message]);
				return true;
			};

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			await handler({ type: "session_start", reason: "startup" }, ctx);

			expect(confirmCalls.length).toBe(1);
			expect(confirmCalls[0][0]).toContain("Session");
		});

		it("VAL-LOCK-001: live lock declined u2014 widget cleared, notify shown, extension idle", async () => {
			const state = makePlanningState();
			saveState(basePath, state);
			acquireLock(basePath, makeLiveLockSession());

			const notifyCalls: Array<[string, string | undefined]> = [];
			const setWidgetCalls: Array<[string, unknown]> = [];
			const ctx = buildMockCtx([], "my-session");
			ctx.ui.confirm = async () => false;
			ctx.ui.notify = (msg: string, type?: "info" | "warning" | "error") => notifyCalls.push([msg, type]);
			ctx.ui.setWidget = (_key: string, lines: unknown) => setWidgetCalls.push([_key as string, lines]);

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			await handler({ type: "session_start", reason: "startup" }, ctx);

			const clearCalls = setWidgetCalls.filter(([, lines]) => lines === undefined);
			expect(clearCalls.length).toBeGreaterThan(0);
			expect(notifyCalls.length).toBeGreaterThan(0);
		});

		it("VAL-LOCK-001: live lock confirmed observe u2014 widget shown, no lock acquired", async () => {
			const state = makePlanningState();
			saveState(basePath, state);
			acquireLock(basePath, makeLiveLockSession());

			const setWidgetCalls: Array<[string, unknown]> = [];
			const ctx = buildMockCtx([], "my-session");
			ctx.ui.confirm = async () => true;
			ctx.ui.setWidget = (_key: string, content: unknown) => setWidgetCalls.push([_key as string, content]);

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			await handler({ type: "session_start", reason: "startup" }, ctx);

			const contentCalls = setWidgetCalls.filter(([, content]) => typeof content === "function");
			expect(contentCalls.length).toBeGreaterThan(0);
		});

		it("VAL-LOCK-002: stale lock prompts user to take over (confirm called)", async () => {
			const state = makePlanningState();
			saveState(basePath, state);
			acquireLock(basePath, makeStaleLockSession());

			const confirmCalls: Array<[string, string]> = [];
			const ctx = buildMockCtx([], "my-session");
			ctx.ui.confirm = async (title: string, message: string) => {
				confirmCalls.push([title, message]);
				return true;
			};

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			await handler({ type: "session_start", reason: "startup" }, ctx);

			expect(confirmCalls.length).toBe(1);
			expect(confirmCalls[0][0]).toContain("Stale");
		});

		it("VAL-LOCK-002: stale lock confirmed takeover u2014 lock replaced with new session", async () => {
			const state = makePlanningState();
			saveState(basePath, state);
			acquireLock(basePath, makeStaleLockSession());

			const ctx = buildMockCtx([], "my-session");
			ctx.ui.confirm = async () => true;

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			await handler({ type: "session_start", reason: "startup" }, ctx);

			const lockStatus = isLocked(basePath);
			expect(lockStatus.locked).toBe(true);
			expect(lockStatus.session?.sessionId).toBe("my-session");
		});

		it("VAL-LOCK-002: stale lock declined u2014 widget cleared, extension idle", async () => {
			const state = makePlanningState();
			saveState(basePath, state);
			acquireLock(basePath, makeStaleLockSession());

			const notifyCalls: Array<[string, string | undefined]> = [];
			const setWidgetCalls: Array<[string, unknown]> = [];
			const ctx = buildMockCtx([], "my-session");
			ctx.ui.confirm = async () => false;
			ctx.ui.notify = (msg: string, type?: "info" | "warning" | "error") => notifyCalls.push([msg, type]);
			ctx.ui.setWidget = (_key: string, lines: unknown) => setWidgetCalls.push([_key as string, lines]);

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			await handler({ type: "session_start", reason: "startup" }, ctx);

			const clearCalls = setWidgetCalls.filter(([, lines]) => lines === undefined);
			expect(clearCalls.length).toBeGreaterThan(0);
			expect(notifyCalls.length).toBeGreaterThan(0);
		});

		it("no lock conflict u2014 lock acquired normally without confirm prompt", async () => {
			const state = makePlanningState();
			saveState(basePath, state);

			const confirmCalls: Array<[string, string]> = [];
			const ctx = buildMockCtx([], "my-session");
			ctx.ui.confirm = async (title: string, message: string) => {
				confirmCalls.push([title, message]);
				return true;
			};

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			await handler({ type: "session_start", reason: "startup" }, ctx);

			expect(confirmCalls.length).toBe(0);
		});

		it("terminal state u2014 no lock acquisition attempted", async () => {
			const state = makeCompletedState();
			saveState(basePath, state);
			acquireLock(basePath, makeLiveLockSession());

			const confirmCalls: Array<[string, string]> = [];
			const ctx = buildMockCtx([], "my-session");
			ctx.ui.confirm = async (title: string, message: string) => {
				confirmCalls.push([title, message]);
				return true;
			};

			const { handlers } = registerExtension(tmpDir);
			const handler = handlers.get("session_start")!;
			await handler({ type: "session_start", reason: "startup" }, ctx);

			expect(confirmCalls.length).toBe(0);
		});
	});
});
