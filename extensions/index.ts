import { exec } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { registerCommands } from "./commands.js";
import { resolveModel } from "./config.js";
import { captureGitSnapshot, ensureGitRepo, isGitAvailable } from "./git.js";
import { handleMissionInput } from "./input-handler.js";
import { buildCompactMissionSummary, buildOrchestratorProtocol, clearProtocolCache } from "./orchestrator/protocol.js";
import { isOnboardingCompleted, saveGlobalConfig } from "./state/global-config.js";
import { acquireLock, getLockConflict, releaseLock } from "./state/lock.js";
import { invalidateCaches, loadConfig, loadPlan, loadState, savePlan, saveState } from "./state/manager.js";
import { appendMutation, clearHistory } from "./state/plan-history.js";
import { loadRegistry, removeFromRegistry, updateRegistry } from "./state/registry.js";
import { transitionState } from "./state/transitions.js";
import { type Question, type QuestionAnswer, registerAskQuestionsTool } from "./tools/ask-questions.js";
import { registerCommitChangesTool } from "./tools/commit-changes.js";
import { registerCompleteMissionTool } from "./tools/complete.js";
import { registerCreateFixTool } from "./tools/create-fix.js";
import { registerRunValidationTool } from "./tools/run-validation.js";
import { killActiveWorker, registerSpawnWorkerTool } from "./tools/spawn-worker.js";
import { registerSubmitPlanTool } from "./tools/submit-plan.js";
import { registerUpdateStateTool } from "./tools/update-state.js";
import type { Feature, GlobalConfig, MissionPlan, MissionState, WorkerResult } from "./types.js";
import { DraftReviewComponent } from "./ui/draft-review.js";
import { MissionControlComponent } from "./ui/mission-control.js";
import { OnboardingOverlayComponent } from "./ui/onboarding-overlay.js";
import { QuestionsOverlayComponent } from "./ui/questions-overlay.js";
import type { ThemeStyler } from "./ui/widget.js";
import { buildWidgetLines } from "./ui/widget.js";
import { generateId, nowISO } from "./utils.js";
import { checkOrphanedWorker, killOrphanedWorker } from "./worker-pid.js";

const SESSION_CACHE_KEY = "mission-state-cache";
const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);

function cachePayload(state: MissionState): MissionState {
	return { ...state, progressLog: [] };
}

function hasPendingFeatures(basePath: string): boolean {
	const plan = loadPlan(basePath);
	if (!plan) return false;
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.status === "pending" || feature.status === "active") return true;
		}
	}
	return false;
}

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

	// Mission mode gate: when false, no protocol injection, no widget, no tools active.
	// Auto-activates if filesystem state exists on session start.
	let missionModeActive = false;

	// Tracks the user's model before mission mode was activated so it can be restored on deactivation.
	let preMissionModelId: string | undefined;
	let preMissionModelProvider: string | undefined;

	const MISSION_TOOL_NAMES = [
		"submit_plan",
		"spawn_worker",
		"update_mission_state",
		"complete_mission",
		"run_validation",
		"create_fix_feature",
		"ask_questions",
	] as const;

	const missionToolSet = new Set<string>(MISSION_TOOL_NAMES);

	const RESTRICTED_TOOLS = new Set(["edit", "write"]);
	const RESTRICTED_STATUSES = new Set(["executing", "validating"]);

	function enableMissionTools(): void {
		const current = new Set(pi.getActiveTools());
		let changed = false;
		for (const name of MISSION_TOOL_NAMES) {
			if (!current.has(name)) {
				current.add(name);
				changed = true;
			}
		}
		if (changed) pi.setActiveTools([...current]);
	}

	function disableMissionTools(): void {
		const current = pi.getActiveTools();
		const filtered = current.filter((name) => !missionToolSet.has(name));
		if (filtered.length !== current.length) pi.setActiveTools(filtered);
	}

	function restrictOrchestratorTools(): void {
		const current = pi.getActiveTools();
		const filtered = current.filter((name) => !RESTRICTED_TOOLS.has(name));
		if (filtered.length !== current.length) pi.setActiveTools(filtered);
	}

	function restoreOrchestratorTools(): void {
		const current = new Set(pi.getActiveTools());
		let changed = false;
		for (const name of RESTRICTED_TOOLS) {
			if (!current.has(name)) {
				current.add(name);
				changed = true;
			}
		}
		if (changed) pi.setActiveTools([...current]);
	}

	let lastContextPercent: number | null = null;

	let lastWidgetKey = "";

	function widgetCacheKey(state: MissionState, plan?: MissionPlan): string {
		return `${state.status}|${state.currentFeatureId ?? ""}|${state.currentMilestoneId ?? ""}|${state.totalFeaturesCompleted}|${state.totalFeaturesSkipped}|${plan?.planVersion ?? 0}`;
	}

	function renderMissionWidget(ctx: ExtensionContext, state: MissionState, plan?: MissionPlan): void {
		const key = widgetCacheKey(state, plan);
		if (key === lastWidgetKey) return;
		lastWidgetKey = key;
		ctx.ui.setWidget("mission", (_tui, theme) => {
			const styler: ThemeStyler = { fg: theme.fg.bind(theme), bold: theme.bold.bind(theme) };
			const lines = buildWidgetLines(state, plan, undefined, styler);
			const container = new Container();
			for (const line of lines) {
				container.addChild(new Text(line, 1, 0));
			}
			return container;
		});
	}

	function updateWidget(state: MissionState, plan?: MissionPlan): void {
		if (latestCtx) {
			renderMissionWidget(latestCtx, state, plan);
		}
		// Mirror every state change to the session entry cache so the widget
		// can be restored after /compact or a fresh session start.
		pi.appendEntry(SESSION_CACHE_KEY, cachePayload(state));
		updateRegistry(state, projectDir, plan);
	}

	function clearWidget(): void {
		lastWidgetKey = "";
		if (latestCtx) {
			latestCtx.ui.setWidget("mission", undefined);
		}
	}

	// session_start: load state from filesystem (authoritative), fall back to
	// session entry cache when filesystem is absent, capture git snapshot if needed,
	// run crash recovery, update widget, acquire lock.
	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;

		// Workers (non-interactive pi processes) must not activate the extension.
		// They run in the same project dir and would find state.json, inject protocol,
		// acquire locks, and interfere with the orchestrator session.
		if (!ctx.hasUI) {
			disableMissionTools();
			return;
		}

		// Disable mission tools by default; they are enabled only when mission mode activates.
		disableMissionTools();

		const fsState = loadState(basePath);

		if (fsState !== null) {
			// Terminal states: render widget but do NOT activate mission mode or tools.
			if (TERMINAL_STATUSES.has(fsState.status)) {
				renderMissionWidget(ctx, fsState, loadPlan(basePath) ?? undefined);
				return;
			}

			missionModeActive = true;
			enableMissionTools();
			await switchToOrchestratorModel(ctx);
			// Capture git snapshot if not yet present and git is available.
			const stateWithSnapshot = captureSnapshotIfNeeded(fsState, projectDir);
			cleanupOrphanedWorker(stateWithSnapshot, basePath);
			// Filesystem is authoritative — run crash recovery then render.
			const {
				state: recoveredState,
				plan: recoveredPlan,
				recoveryContext,
			} = reconcileStateOnStart(stateWithSnapshot, basePath);

			// Auto-resume from pause so the mission continues from the exact step it was at.
			let activeState = recoveredState;
			if (activeState.status === "paused" && activeState.resumeTargetState) {
				const resumeTarget = activeState.resumeTargetState;
				try {
					activeState = transitionState(activeState, resumeTarget);
					if (resumeTarget === "draft_review") {
						pendingRecoveryContext =
							"Mission resumed to draft_review. The plan is still awaiting user approval. The user must approve through Mission Control (Ctrl+Shift+M \u2192 A). Do NOT start execution.";
					}
				} catch {
					// why: best-effort resume — if transition fails, show paused state
				}
			}

			if (recoveryContext || activeState !== recoveredState || stateWithSnapshot !== fsState) {
				saveState(basePath, activeState, (s) => pi.appendEntry(SESSION_CACHE_KEY, cachePayload(s)));
				if (recoveredPlan) savePlan(basePath, recoveredPlan);
				if (recoveryContext) pendingRecoveryContext = recoveryContext;
			}
			renderMissionWidget(ctx, activeState, recoveredPlan ?? undefined);
			if (RESTRICTED_STATUSES.has(activeState.status)) {
				restrictOrchestratorTools();
			}
			if (!TERMINAL_STATUSES.has(activeState.status)) {
				await handleLockConflict(basePath, ctx);
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

		// Terminal cached states: render widget but do NOT activate mission mode or tools.
		if (TERMINAL_STATUSES.has(cached.status)) {
			renderMissionWidget(ctx, cached);
			return;
		}

		// Restore from cache: write back to filesystem so it becomes authoritative.
		// Also capture snapshot for the restored state.
		missionModeActive = true;
		enableMissionTools();
		await switchToOrchestratorModel(ctx);
		let cachedState = captureSnapshotIfNeeded(cached, projectDir);

		// Auto-resume from pause so the mission continues from the exact step.
		if (cachedState.status === "paused" && cachedState.resumeTargetState) {
			const resumeTarget = cachedState.resumeTargetState;
			try {
				cachedState = transitionState(cachedState, resumeTarget);
				if (resumeTarget === "draft_review") {
					pendingRecoveryContext =
						"Mission resumed to draft_review. The plan is still awaiting user approval. The user must approve through Mission Control (Ctrl+Shift+M \u2192 A). Do NOT start execution.";
				}
			} catch {
				// why: best-effort resume
			}
		}

		saveState(basePath, cachedState, (s) => pi.appendEntry(SESSION_CACHE_KEY, cachePayload(s)));
		const plan = loadPlan(basePath);
		renderMissionWidget(ctx, cachedState, plan ?? undefined);
		if (RESTRICTED_STATUSES.has(cachedState.status)) {
			restrictOrchestratorTools();
		}
		if (!TERMINAL_STATUSES.has(cachedState.status)) {
			await handleLockConflict(basePath, ctx);
		}
	});

	// before_agent_start: load state and inject orchestrator protocol into system prompt.
	// Also injects pending crash recovery context when present.
	pi.on("before_agent_start", (event, _ctx) => {
		if (!missionModeActive) return undefined;
		const state = loadState(basePath);
		if (!state) return undefined;

		if (RESTRICTED_STATUSES.has(state.status)) {
			restrictOrchestratorTools();
		} else {
			restoreOrchestratorTools();
		}

		const plan = loadPlan(basePath);
		const config = loadConfig(basePath);
		const isHighUsage = lastContextPercent !== null && lastContextPercent > 70;
		const turnCount = state.turnCount ?? 1;
		const protocol = buildOrchestratorProtocol(state, plan ?? undefined, config, isHighUsage, {
			turnCount,
			contextUsagePercent: lastContextPercent ?? undefined,
		});

		if (!protocol) return undefined;

		if (state.status === "executing") {
			state.turnCount = turnCount + 1;
			saveState(basePath, state);
		}

		const recovery = pendingRecoveryContext;
		pendingRecoveryContext = null;

		const suffix = recovery ? `\n\n## Recovery Context\n${recovery}` : "";
		return { systemPrompt: `${event.systemPrompt}\n\n${protocol}${suffix}` };
	});

	pi.on("session_shutdown", (_event, _ctx) => {
		killActiveWorker();
		if (!missionModeActive) return;
		const state = loadState(basePath);
		if (!state) return;
		const pausableStatuses = new Set(["planning", "draft_review", "approved", "validating"]);
		const shouldPause =
			pausableStatuses.has(state.status) || (state.status === "executing" && hasPendingFeatures(basePath));
		if (!shouldPause) return;
		try {
			const newState = transitionState(state, "paused");
			saveState(basePath, newState);
		} catch {
			// why: best-effort pause — if transition fails (e.g. approved → paused not allowed), don't crash shutdown
		}
	});

	pi.on("session_compact", (_event, _ctx) => {
		if (!missionModeActive) return;
		const state = loadState(basePath);
		if (state !== null) {
			pi.appendEntry(SESSION_CACHE_KEY, cachePayload(state));
		}
	});

	pi.on("context", (_event, ctx) => {
		if (!missionModeActive) return;
		const usage = ctx.getContextUsage();
		lastContextPercent = usage?.percent ?? null;
	});

	pi.on("session_before_compact", (event, _ctx) => {
		if (!missionModeActive) return;
		const state = loadState(basePath);
		if (!state) return;
		const plan = loadPlan(basePath);
		const summary = buildCompactMissionSummary(state, plan ?? undefined);
		const mutableEvent = event as { customInstructions?: string };
		if (mutableEvent.customInstructions) {
			mutableEvent.customInstructions += `\n\n${summary}`;
		} else {
			mutableEvent.customInstructions = summary;
		}
	});

	pi.on("input", (event, _ctx) => {
		const state = loadState(basePath);
		return handleMissionInput(event.text, missionModeActive, state);
	});

	function showDraftReview(plan: MissionPlan): void {
		setTimeout(() => {
			const ctx = latestCtx;
			if (!ctx) return;
			ctx.ui.custom<void>(
				(tui, theme, _kb, done) =>
					new DraftReviewComponent(
						tui,
						done,
						plan,
						{
							onApprove: () => {
								const state = loadState(basePath);
								const currentPlan = loadPlan(basePath);
								if (state && currentPlan) {
									const now = nowISO();
									const newPlanVersion = currentPlan.planVersion + 1;
									const updatedPlan: MissionPlan = {
										...currentPlan,
										approvedAt: now,
										planVersion: newPlanVersion,
									};
									savePlan(basePath, updatedPlan);
									appendMutation(basePath, {
										planVersion: newPlanVersion,
										timestamp: now,
										actor: "user",
										kind: "plan-approved",
										summary: "Plan approved by user",
										payload: {},
									});
									const newState = transitionState(state, "approved");
									saveState(basePath, newState);
									updateWidget(newState, updatedPlan);
									pi.sendUserMessage("Plan approved. Call spawn_worker for the first feature.", {
										deliverAs: "followUp",
									});
								}
							},
						},
						theme,
					),
				{
					overlay: true,
					overlayOptions: {
						maxHeight: "95%",
						anchor: "center",
					},
				},
			);
		}, 0);
	}

	// Register all orchestrator tools.
	registerSubmitPlanTool(pi, { basePath, updateWidget, showDraftReview });
	registerSpawnWorkerTool(pi, {
		basePath,
		projectDir,
		updateWidget,
		refreshWidget: (state: MissionState, plan?: MissionPlan) => {
			if (latestCtx) renderMissionWidget(latestCtx, state, plan);
		},
		getThinkingLevel: () => pi.getThinkingLevel(),
		setThinkingLevel: (level) => pi.setThinkingLevel(level),
		availableModels: () => {
			if (!latestCtx) return [];
			const models = latestCtx.modelRegistry.getAll();
			const ids: string[] = [];
			for (const m of models) {
				ids.push(m.id);
				ids.push(`${m.provider}/${m.id}`);
			}
			return ids;
		},
	});
	registerUpdateStateTool(pi, { basePath, updateWidget });
	registerCompleteMissionTool(pi, { basePath, updateWidget });
	registerRunValidationTool(pi, {
		basePath,
		projectDir,
		updateWidget,
		exec: async (cmd, cwd, timeoutMs) => {
			const signal = AbortSignal.timeout(timeoutMs);
			const [command, ...args] = cmd.split(" ");
			const result = await pi.exec(command!, args, { cwd, signal });
			return {
				exitCode: result.killed ? null : result.code,
				stdout: result.stdout,
				stderr: result.stderr,
				timedOut: result.killed,
			};
		},
	});
	registerCommitChangesTool(pi, { basePath, projectDir, updateWidget });
	registerCreateFixTool(pi, { basePath, updateWidget });
	registerAskQuestionsTool(pi, {
		basePath,
		showQuestions: (questions: Question[]) => {
			const ctx = latestCtx;
			if (!ctx) {
				return Promise.resolve(
					questions.map((q) => ({ question: q.question, answer: q.options[0] ?? "", isCustom: false })),
				);
			}
			return ctx.ui
				.custom<QuestionAnswer[] | null>(
					(tui, theme, _kb, done) => new QuestionsOverlayComponent(tui, done, questions, theme),
					{
						overlay: true,
						overlayOptions: {
							maxHeight: "95%",
							anchor: "center",
						},
					},
				)
				.then(
					(answers) =>
						answers ?? questions.map((q) => ({ question: q.question, answer: "(skipped)", isCustom: false })),
				);
		},
	});

	// why: disableMissionTools() cannot run here — runtime APIs (getActiveTools/setActiveTools)
	// are not available during extension loading. Tools are disabled in session_start instead.

	function resetMission(): void {
		killActiveWorker();
		const currentState = loadState(basePath);
		if (currentState) {
			removeFromRegistry(currentState.missionId);
		}
		try {
			rmSync(basePath, { recursive: true, force: true });
		} catch {
			// why: directory may not exist if mission never started; ignore
		}
		invalidateCaches(basePath);
		clearProtocolCache();
		clearWidget();
		pi.setSessionName("");
		pi.appendEntry(SESSION_CACHE_KEY, null);
		if (latestCtx) {
			latestCtx.ui.notify("Mission reset.", "info");
		}
	}

	async function showOnboarding(ctx: ExtensionContext): Promise<GlobalConfig | null> {
		const availableModels = ctx.modelRegistry.getAll().map((m) => m.id);
		return ctx.ui.custom<GlobalConfig | null>(
			(tui, theme, _kb, done) => new OnboardingOverlayComponent(tui, done, availableModels, theme),
			{
				overlay: true,
				overlayOptions: {
					maxHeight: "95%",
					anchor: "center",
				},
			},
		);
	}

	async function switchToOrchestratorModel(ctx: ExtensionContext): Promise<void> {
		const currentModel = ctx.model;
		if (currentModel) {
			preMissionModelId = currentModel.id;
			preMissionModelProvider = currentModel.provider;
		}
		const config = loadConfig(basePath);
		const plan = loadPlan(basePath);
		const orchestratorModelId = resolveModel("orchestrator", config, plan);
		if (!orchestratorModelId) return;
		if (currentModel && currentModel.id === orchestratorModelId) return;
		const allModels = ctx.modelRegistry.getAll();
		const match = allModels.find(
			(m) => m.id === orchestratorModelId || `${m.provider}/${m.id}` === orchestratorModelId,
		);
		if (match) {
			await pi.setModel(match);
		}
	}

	async function restorePreMissionModel(ctx: ExtensionContext): Promise<void> {
		if (!preMissionModelId) return;
		const allModels = ctx.modelRegistry.getAll();
		const match = allModels.find(
			(m) => m.id === preMissionModelId && (!preMissionModelProvider || m.provider === preMissionModelProvider),
		);
		if (match) {
			await pi.setModel(match);
		}
		preMissionModelId = undefined;
		preMissionModelProvider = undefined;
	}

	async function activateMissionMode(ctx: ExtensionContext): Promise<void> {
		if (!isOnboardingCompleted()) {
			const result = await showOnboarding(ctx);
			if (result) {
				saveGlobalConfig(result);
			} else {
				missionModeActive = false;
				disableMissionTools();
				return;
			}
		}
		missionModeActive = true;
		enableMissionTools();
		await switchToOrchestratorModel(ctx);
		let state = loadState(basePath);
		if (state) {
			if (state.status === "paused" && state.resumeTargetState) {
				try {
					state = transitionState(state, state.resumeTargetState);
					saveState(basePath, state);
				} catch {
					// why: best-effort resume — if transition fails, show paused state
				}
			}
			if (RESTRICTED_STATUSES.has(state.status)) {
				restrictOrchestratorTools();
			} else {
				restoreOrchestratorTools();
			}
			const plan = loadPlan(basePath);
			updateWidget(state, plan ?? undefined);
		}
	}

	function deactivateMissionMode(): void {
		const state = loadState(basePath);
		if (state) {
			const pausableStatuses = new Set(["planning", "draft_review", "approved", "validating"]);
			const shouldPause =
				pausableStatuses.has(state.status) || (state.status === "executing" && hasPendingFeatures(basePath));
			if (shouldPause) {
				try {
					const newState = transitionState(state, "paused");
					saveState(basePath, newState);
				} catch {
					// why: best-effort pause
				}
			}
		}
		if (latestCtx) {
			restorePreMissionModel(latestCtx).catch(() => {
				// why: best-effort restore — if model no longer available, don't crash
			});
		}
		clearWidget();
		missionModeActive = false;
		disableMissionTools();
	}

	// Register all slash commands.
	registerCommands(pi, {
		basePath,
		updateWidget,
		clearWidget,
		isMissionModeActive: () => missionModeActive,
		setMissionModeActive: (active: boolean) => {
			missionModeActive = active;
		},
		onActivate: activateMissionMode,
		onDeactivate: deactivateMissionMode,
	});

	function clearStalePlanData(): void {
		const planFile = join(basePath, "plan.json");
		const runtimeDir = join(basePath, "runtime");
		try {
			if (existsSync(planFile)) rmSync(planFile);
		} catch {
			// why: best-effort cleanup; file may already be gone
		}
		clearHistory(basePath);
		try {
			if (existsSync(runtimeDir)) rmSync(runtimeDir, { recursive: true, force: true });
		} catch {
			// why: best-effort cleanup
		}
	}

	function startNewMission(description: string): void {
		ensureGitRepo(projectDir);
		clearStalePlanData();
		const now = nowISO();
		let gitSnapshot: MissionState["gitSnapshot"];
		try {
			if (isGitAvailable(projectDir)) {
				gitSnapshot = captureGitSnapshot(projectDir);
			}
		} catch {
			// why: git snapshot is best-effort — don't block mission start
		}
		const newState: MissionState = {
			missionId: generateId(),
			status: "planning",
			progressLog: [{ timestamp: now, type: "mission_started", detail: "Mission started" }],
			startedAt: now,
			missionStartedAtMs: Date.now(),
			totalFeaturesCompleted: 0,
			totalFeaturesFailed: 0,
			totalFeaturesSkipped: 0,
			totalFixFeaturesCreated: 0,
			gitSnapshot,
		};
		saveState(basePath, newState);
		missionModeActive = true;
		enableMissionTools();
		if (latestCtx) {
			switchToOrchestratorModel(latestCtx).catch(() => {
				// why: best-effort model switch — don't block mission start if model unavailable
			});
		}
		updateWidget(newState);
		pi.setSessionName(description);
		pi.sendUserMessage(`New mission: ${description}`);
	}

	// Register Ctrl+Shift+M shortcut to open Mission Control overlay.
	pi.registerShortcut("ctrl+shift+m", {
		description: "Open Mission Control overlay",
		handler: async (ctx) => {
			if (!missionModeActive) {
				ctx.ui.notify("Mission mode is not active. Run /mission-mode to activate.", "info");
				return;
			}
			const deps = {
				basePath,
				projectPath: projectDir,
				loadState,
				loadPlan,
				loadConfig,
				sendUserMessage: (content: string, options?: { deliverAs?: "steer" | "followUp" }) =>
					pi.sendUserMessage(content, options),
				getInput: (title: string, placeholder?: string) => ctx.ui.input(title, placeholder),
				confirm: (title: string, message: string) => ctx.ui.confirm(title, message),
				notify: (message: string, type?: "info" | "warning" | "error") => ctx.ui.notify(message, type),
				updateWidget,
				availableModels: ctx.modelRegistry.getAll().map((m) => m.id),
				openFile: (filePath: string) => {
					exec(`open "${filePath}"`);
				},
				setModel: async (modelId: string) => {
					const model = ctx.modelRegistry.getAll().find((m) => m.id === modelId);
					if (model) await pi.setModel(model);
				},
				resetMission,
				loadRegistry,
				startNewMission,
			};
			const result = await ctx.ui.custom<string | undefined>(
				(tui, theme, _kb, done) => new MissionControlComponent(tui, done, deps, theme),
				{
					overlay: true,
					overlayOptions: {
						maxHeight: "95%",
						anchor: "center",
					},
				},
			);
			if (result === "new_mission") {
				const description = await ctx.ui.input("New Mission", "Describe your mission goal...");
				if (description?.trim()) {
					startNewMission(description.trim());
				}
			}
		},
	});
}

function cleanupOrphanedWorker(state: MissionState, basePath: string): void {
	if (state.status !== "executing" || !state.currentFeatureId) return;
	const plan = loadPlan(basePath);
	if (!plan) return;
	const feature = findFeatureInPlan(plan, state.currentFeatureId);
	if (!feature) return;
	const attemptNumber = feature.attempts.length + 1;
	const workerStatus = checkOrphanedWorker(basePath, state.currentFeatureId, attemptNumber);
	if (workerStatus === "alive") {
		killOrphanedWorker(basePath, state.currentFeatureId, attemptNumber);
	}
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

async function handleLockConflict(basePath: string, ctx: ExtensionContext): Promise<void> {
	const sessionId = ctx.sessionManager.getSessionId();
	const sessionInfo = { sessionId, pid: process.pid, startedAt: nowISO(), lastHeartbeatAt: nowISO() };
	const conflict = getLockConflict(basePath, sessionId);

	if (conflict.kind === "none") {
		acquireLock(basePath, sessionInfo);
		return;
	}

	if (conflict.kind === "live") {
		const observe = await ctx.ui.confirm(
			"Mission Active in Another Session",
			`Session ${conflict.session.sessionId} (PID ${conflict.session.pid}) is running this mission. Observe in read-only mode?`,
		);
		if (!observe) {
			ctx.ui.setWidget("mission", undefined);
			ctx.ui.notify("Another session holds the mission lock. Extension is idle.", "info");
		}
		return;
	}

	const takeover = await ctx.ui.confirm(
		"Stale Mission Lock Detected",
		`Session ${conflict.session.sessionId} (PID ${conflict.session.pid}) left a stale lock. Take over?`,
	);
	if (takeover) {
		releaseLock(basePath);
		acquireLock(basePath, sessionInfo);
	} else {
		ctx.ui.setWidget("mission", undefined);
		ctx.ui.notify("Stale lock takeover declined. Extension is idle.", "info");
	}
}
