import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands.js";
import { buildOrchestratorProtocol } from "./orchestrator/protocol.js";
import { acquireLock } from "./state/lock.js";
import { loadConfig, loadPlan, loadState, saveState } from "./state/manager.js";
import { registerCompleteMissionTool } from "./tools/complete.js";
import { registerSpawnWorkerTool } from "./tools/spawn-worker.js";
import { registerSubmitPlanTool } from "./tools/submit-plan.js";
import { registerUpdateStateTool } from "./tools/update-state.js";
import type { MissionPlan, MissionState } from "./types.js";
import { updateWidget as renderWidget } from "./ui/widget.js";
import { nowISO } from "./utils.js";

const SESSION_CACHE_KEY = "mission-state-cache";
const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);

function findLatestCacheEntry(ctx: ExtensionContext): MissionState | null | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type: string; customType?: string; data?: unknown };
		if (entry.type === "custom" && entry.customType === SESSION_CACHE_KEY) {
			// data === null means null sentinel (user reset)
			// data === undefined or missing means no data (empty entry)
			const raw = entry.data;
			if (raw === null) return null;
			if (raw !== undefined) return raw as MissionState;
			// data is explicitly undefined but entry exists — treat as no state
			return null;
		}
	}
	// No cache entry found at all
	return undefined;
}

export default function (pi: ExtensionAPI): void {
	const basePath = join(process.cwd(), ".pi", "missions");
	const projectDir = process.cwd();

	// latestCtx is updated on every session_start so widget calls have access to ctx.ui.
	let latestCtx: ExtensionContext | null = null;

	function updateWidget(state: MissionState, plan?: MissionPlan): void {
		if (latestCtx) {
			renderWidget(latestCtx.ui, state, plan);
		}
		// Mirror every state change to the session entry cache so the widget
		// can be restored after /compact or a fresh session start.
		pi.appendEntry(SESSION_CACHE_KEY, state);
	}

	function clearWidget(): void {
		if (latestCtx) {
			latestCtx.ui.setWidget("mission", undefined);
		}
	}

	// session_start: load state from filesystem (authoritative), fall back to
	// session entry cache when filesystem is absent, update widget, acquire lock.
	pi.on("session_start", (_event, ctx) => {
		latestCtx = ctx;

		const fsState = loadState(basePath);

		if (fsState !== null) {
			// Filesystem is authoritative — use it.
			const plan = loadPlan(basePath);
			renderWidget(ctx.ui, fsState, plan ?? undefined);
			if (!TERMINAL_STATUSES.has(fsState.status)) {
				tryAcquireLock(basePath, ctx);
			}
			return;
		}

		// No filesystem state: check session entry cache for fallback restore.
		// Returns undefined when no cache entry exists at all.
		// Returns null when null sentinel was written (user reset — do not restore).
		// Returns MissionState when cached state is available.
		const cached = findLatestCacheEntry(ctx);

		if (cached === undefined || cached === null) {
			// Either no cache or null sentinel: extension stays idle.
			return;
		}

		// Restore from cache: write back to filesystem so it becomes authoritative.
		saveState(basePath, cached);
		const plan = loadPlan(basePath);
		renderWidget(ctx.ui, cached, plan ?? undefined);
		if (!TERMINAL_STATUSES.has(cached.status)) {
			tryAcquireLock(basePath, ctx);
		}
	});

	// before_agent_start: load state and inject orchestrator protocol into system prompt.
	pi.on("before_agent_start", (event, _ctx) => {
		const state = loadState(basePath);
		if (!state) return undefined;

		const plan = loadPlan(basePath);
		const config = loadConfig(basePath);
		const protocol = buildOrchestratorProtocol(state, plan ?? undefined, config);

		if (!protocol) return undefined;

		return { systemPrompt: `${event.systemPrompt}\n\n${protocol}` };
	});

	// session_compact: re-cache state from filesystem to keep session entries
	// current after context compaction removes old entries.
	pi.on("session_compact", (_event, _ctx) => {
		const state = loadState(basePath);
		if (state !== null) {
			pi.appendEntry(SESSION_CACHE_KEY, state);
		}
	});

	// Register all orchestrator tools.
	registerSubmitPlanTool(pi, { basePath, updateWidget });
	registerSpawnWorkerTool(pi, { basePath, projectDir, updateWidget });
	registerUpdateStateTool(pi, { basePath, updateWidget });
	registerCompleteMissionTool(pi, { basePath, updateWidget });

	// Register all slash commands.
	registerCommands(pi, { basePath, updateWidget, clearWidget });

	// Register Ctrl+Shift+M shortcut — Phase 3 placeholder for Mission Control overlay.
	pi.registerShortcut("ctrl+shift+m", {
		description: "Open Mission Control overlay",
		handler: (_ctx) => {
			// Phase 3: open Mission Control overlay via ctx.ui.custom({ overlay: true })
		},
	});
}

function tryAcquireLock(basePath: string, ctx: ExtensionContext): void {
	const sessionId = ctx.sessionManager.getSessionId();
	acquireLock(basePath, {
		sessionId,
		pid: process.pid,
		startedAt: nowISO(),
		lastHeartbeatAt: nowISO(),
	});
}
