import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands.js";
import { captureGitSnapshot, isGitAvailable } from "./git.js";
import { buildOrchestratorProtocol } from "./orchestrator/protocol.js";
import { acquireLock } from "./state/lock.js";
import { loadConfig, loadPlan, loadState, savePlan, saveState } from "./state/manager.js";
import { registerCommitChangesTool } from "./tools/commit-changes.js";
import { registerCompleteMissionTool } from "./tools/complete.js";
import { registerCreateFixTool } from "./tools/create-fix.js";
import { registerRunValidationTool } from "./tools/run-validation.js";
import { registerSpawnWorkerTool } from "./tools/spawn-worker.js";
import { registerSubmitPlanTool } from "./tools/submit-plan.js";
import { registerUpdateStateTool } from "./tools/update-state.js";
import type { Feature, MissionPlan, MissionState, WorkerResult } from "./types.js";
import { MissionControlComponent } from "./ui/mission-control.js";
import { updateWidget as renderWidget } from "./ui/widget.js";
import { nowISO } from "./utils.js";

const SESSION_CACHE_KEY = "mission-state-cache";
const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);

type RecoveryAction =
	| { kind: "none" }
	| { kind: "feature_done"; featureId: string }
	| { kind: "feature_failed"; featureId: string }
	| { kind: "attempt_interrupted"; featureId: string }
	| { kind: "missing_feature"; featureId: string }
	| { kind: "back_to_executing" }
	| { kind: "mission_failed"; reason: string };

function readResultJson(resultPath: string): WorkerResult | null {
	try {
		const raw = readFileSync(resultPath, "utf8");
		return JSON.parse(raw) as WorkerResult;
	} catch {
		return null;
	}
}

function findFeatureInPlan(plan: MissionPlan, featureId: string): Feature | null {
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.id === featureId) return feature;
		}
	}
	return null;
}

function determineRecovery(state: MissionState, plan: MissionPlan | null, basePath: string): RecoveryAction {
	if (state.status === "executing") {
		const featureId = state.currentFeatureId;
		if (!featureId) {
			return { kind: "none" };
		}
		if (!plan) {
			return { kind: "mission_failed", reason: "Plan missing during recovery" };
		}
		const feature = findFeatureInPlan(plan, featureId);
		if (!feature) {
			return { kind: "missing_feature", featureId };
		}
		const attemptNumber = feature.attempts.length + 1;
		const resultPath = join(basePath, "runtime", featureId, String(attemptNumber), "result.json");
		const prevAttemptNumber = feature.attempts.length;
		const prevResultPath =
			prevAttemptNumber > 0 ? join(basePath, "runtime", featureId, String(prevAttemptNumber), "result.json") : null;
		const checkPath = prevResultPath && existsSync(prevResultPath) ? prevResultPath : resultPath;
		if (existsSync(checkPath)) {
			const result = readResultJson(checkPath);
			if (result?.status === "success") {
				return { kind: "feature_done", featureId };
			}
			return { kind: "feature_failed", featureId };
		}
		return { kind: "attempt_interrupted", featureId };
	}
	if (state.status === "validating") {
		return { kind: "back_to_executing" };
	}
	if (state.status === "draft_review") {
		if (!plan) {
			return { kind: "mission_failed", reason: "Plan missing in draft_review state" };
		}
		return { kind: "none" };
	}
	if (state.status === "approved") {
		if (!plan) {
			return { kind: "mission_failed", reason: "Plan missing in approved state" };
		}
		return { kind: "none" };
	}
	return { kind: "none" };
}

function applyRecovery(
	state: MissionState,
	plan: MissionPlan | null,
	action: RecoveryAction,
): { state: MissionState; plan: MissionPlan | null; context: string | null } {
	const now = nowISO();
	switch (action.kind) {
		case "none":
			return { state, plan, context: null };
		case "feature_done": {
			const updatedPlan = plan
				? {
						...plan,
						milestones: plan.milestones.map((m) => ({
							...m,
							features: m.features.map((f) =>
								f.id === action.featureId ? { ...f, status: "done" as const, completedAt: now } : f,
							),
						})),
					}
				: null;
			const recoveredState: MissionState = {
				...state,
				currentFeatureId: undefined,
				totalFeaturesCompleted: state.totalFeaturesCompleted + 1,
				progressLog: [
					...state.progressLog,
					{
						timestamp: now,
						type: "worker_complete" as const,
						detail: `Recovery: feature '${action.featureId}' completed (result.json found)`,
					},
				],
			};
			return {
				state: recoveredState,
				plan: updatedPlan,
				context: `Crash recovery: feature '${action.featureId}' was completed before crash. State reconciled.`,
			};
		}
		case "feature_failed": {
			const failedState: MissionState = {
				...state,
				currentFeatureId: undefined,
				totalFeaturesFailed: state.totalFeaturesFailed + 1,
				progressLog: [
					...state.progressLog,
					{
						timestamp: now,
						type: "worker_complete" as const,
						detail: `Recovery: feature '${action.featureId}' failed (result.json found)`,
					},
				],
			};
			return {
				state: failedState,
				plan,
				context: `Crash recovery: feature '${action.featureId}' failed before crash. State reconciled.`,
			};
		}
		case "attempt_interrupted": {
			const interruptedState: MissionState = {
				...state,
				currentFeatureId: undefined,
				progressLog: [
					...state.progressLog,
					{
						timestamp: now,
						type: "worker_complete" as const,
						detail: `Recovery: worker for '${action.featureId}' was interrupted (no result.json)`,
					},
				],
			};
			return {
				state: interruptedState,
				plan,
				context: `Crash recovery: worker for feature '${action.featureId}' was interrupted. No result found.`,
			};
		}
		case "missing_feature": {
			const now2 = nowISO();
			const failedMission: MissionState = {
				...state,
				status: "failed",
				completedAt: now2,
				currentFeatureId: undefined,
				progressLog: [
					...state.progressLog,
					{
						timestamp: now2,
						type: "mission_failed" as const,
						detail: `Recovery failed: feature '${action.featureId}' not found in plan`,
					},
				],
			};
			return {
				state: failedMission,
				plan,
				context: `Mission failed during recovery: feature '${action.featureId}' references a feature not in plan.`,
			};
		}
		case "back_to_executing": {
			const resumedState: MissionState = {
				...state,
				status: "executing",
				progressLog: [
					...state.progressLog,
					{
						timestamp: now,
						type: "feature_start" as const,
						detail: "Recovery: validation interrupted, returning to executing",
					},
				],
			};
			return {
				state: resumedState,
				plan,
				context: "Crash recovery: validation was in progress. Returned to executing state.",
			};
		}
		case "mission_failed": {
			const now3 = nowISO();
			const failedMission2: MissionState = {
				...state,
				status: "failed",
				completedAt: now3,
				currentFeatureId: undefined,
				progressLog: [
					...state.progressLog,
					{
						timestamp: now3,
						type: "mission_failed" as const,
						detail: `Recovery failed: ${action.reason}`,
					},
				],
			};
			return {
				state: failedMission2,
				plan,
				context: `Mission failed during recovery: ${action.reason}`,
			};
		}
	}
}

export function reconcileStateOnStart(
	state: MissionState,
	basePath: string,
): { state: MissionState; plan: MissionPlan | null; recoveryContext: string | null } {
	const plan = loadPlan(basePath);
	const action = determineRecovery(state, plan, basePath);
	const { state: recoveredState, plan: recoveredPlan, context } = applyRecovery(state, plan, action);
	return { state: recoveredState, plan: recoveredPlan, recoveryContext: context };
}

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

	// recoveryContext is set by session_start crash recovery and injected on the next before_agent_start.
	let pendingRecoveryContext: string | null = null;

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
	// session entry cache when filesystem is absent, capture git snapshot if needed,
	// run crash recovery, update widget, acquire lock.
	pi.on("session_start", (_event, ctx) => {
		latestCtx = ctx;

		const fsState = loadState(basePath);

		if (fsState !== null) {
			// Capture git snapshot if not yet present and git is available.
			const stateWithSnapshot = captureSnapshotIfNeeded(fsState, projectDir);
			// Filesystem is authoritative — run crash recovery then render.
			const {
				state: recoveredState,
				plan: recoveredPlan,
				recoveryContext,
			} = reconcileStateOnStart(stateWithSnapshot, basePath);
			if (recoveryContext) {
				saveState(basePath, recoveredState);
				if (recoveredPlan) savePlan(basePath, recoveredPlan);
				pendingRecoveryContext = recoveryContext;
			} else if (stateWithSnapshot !== fsState) {
				// Snapshot was captured — persist the updated state.
				saveState(basePath, recoveredState);
			}
			renderWidget(ctx.ui, recoveredState, recoveredPlan ?? undefined);
			if (!TERMINAL_STATUSES.has(recoveredState.status)) {
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
		// Also capture snapshot for the restored state.
		const cachedWithSnapshot = captureSnapshotIfNeeded(cached, projectDir);
		saveState(basePath, cachedWithSnapshot);
		const plan = loadPlan(basePath);
		renderWidget(ctx.ui, cachedWithSnapshot, plan ?? undefined);
		if (!TERMINAL_STATUSES.has(cachedWithSnapshot.status)) {
			tryAcquireLock(basePath, ctx);
		}
	});

	// before_agent_start: load state and inject orchestrator protocol into system prompt.
	// Also injects pending crash recovery context when present.
	pi.on("before_agent_start", (event, _ctx) => {
		const state = loadState(basePath);
		if (!state) return undefined;

		const plan = loadPlan(basePath);
		const config = loadConfig(basePath);
		const protocol = buildOrchestratorProtocol(state, plan ?? undefined, config);

		if (!protocol) return undefined;

		const recovery = pendingRecoveryContext;
		pendingRecoveryContext = null;

		const suffix = recovery ? `\n\n## Recovery Context\n${recovery}` : "";
		return { systemPrompt: `${event.systemPrompt}\n\n${protocol}${suffix}` };
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
	registerRunValidationTool(pi, { basePath, projectDir, updateWidget });
	registerCommitChangesTool(pi, { basePath, projectDir, updateWidget });
	registerCreateFixTool(pi, { basePath, updateWidget });

	// Register all slash commands.
	registerCommands(pi, { basePath, updateWidget, clearWidget });

	// Register Ctrl+Shift+M shortcut to open Mission Control overlay.
	pi.registerShortcut("ctrl+shift+m", {
		description: "Open Mission Control overlay",
		handler: async (ctx) => {
			const deps = {
				basePath,
				loadState,
				loadPlan,
				loadConfig,
				sendUserMessage: (content: string) => pi.sendUserMessage(content),
				getInput: (title: string, placeholder?: string) => ctx.ui.input(title, placeholder),
				notify: (message: string, type?: "info" | "warning" | "error") => ctx.ui.notify(message, type),
				updateWidget,
				availableModels: [] as string[],
				openFile: (_path: string) => {},
			};
			await ctx.ui.custom<void>((tui, _theme, _kb, done) => new MissionControlComponent(tui, done, deps), {
				overlay: true,
			});
		},
	});
}

function captureSnapshotIfNeeded(state: MissionState, projectDir: string): MissionState {
	if (state.gitSnapshot !== undefined) return state;
	try {
		if (!isGitAvailable(projectDir)) return state;
		const snapshot = captureGitSnapshot(projectDir);
		return { ...state, gitSnapshot: snapshot };
	} catch {
		return state;
	}
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
