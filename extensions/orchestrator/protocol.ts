import { resolvePromptingMode } from "../config.js";
import type { MissionConfig, MissionPlan, MissionState } from "../types.js";
import { getCavemanOutputRule } from "./caveman-rules.js";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "aborted", "idle"]);

let protocolCache: { key: string; value: string | null } | null = null;

function protocolCacheKey(state: MissionState, plan?: MissionPlan, config?: MissionConfig, compact?: boolean): string {
	const autonomy = config?.autonomy ?? "medium";
	const mode = resolvePromptingMode(config ?? {});
	return `${state.status}|${state.currentFeatureId ?? ""}|${state.currentMilestoneId ?? ""}|${plan?.planVersion ?? 0}|${autonomy}|${state.totalFeaturesCompleted}|${state.totalFeaturesSkipped}|${compact ? "c" : ""}|${mode}`;
}

export function clearProtocolCache(): void {
	protocolCache = null;
}

function autonomyInstructions(autonomy: MissionConfig["autonomy"]): string {
	switch (autonomy) {
		case "low":
			return "AUTONOMY: low \u2014 after each feature completes, STOP and wait for the user to confirm before proceeding to the next feature.";
		case "high":
			return "AUTONOMY: high \u2014 run the full plan to completion without pausing. Only stop on critical failures that cannot proceed without user input.";
		default:
			return "AUTONOMY: medium \u2014 pause at milestone boundaries and on failures. Proceed through features within a milestone automatically.";
	}
}

function planningProtocol(autonomy: MissionConfig["autonomy"]): string {
	return `## MISSION ORCHESTRATOR \u2014 PLANNING PHASE

STEPS (follow in order):
1. Call \`ask_questions\` to interview the user about scope, priorities, constraints, and architecture preferences.
2. Targeted codebase scan \u2014 check package.json, README, AGENTS.md, directory structure ONLY. Do NOT read implementation files.
3. Call \`submit_plan\` with milestones, features, acceptance criteria, and validation commands.

RULES:
- Do NOT call submit_plan before calling ask_questions first.
- Do NOT read implementation files during planning. Only scan project metadata and structure.
- Each feature must have clear, testable acceptance criteria.
- Group features into milestones that represent validation checkpoints.

${autonomyInstructions(autonomy)}`;
}

function draftReviewProtocol(): string {
	return `## MISSION ORCHESTRATOR \u2014 DRAFT REVIEW

Plan submitted. The plan is awaiting user approval through the Mission Control UI (Ctrl+Shift+M \u2192 A).
A session resume does NOT mean approval.
Do NOT call start_milestone or spawn_worker.
Do NOT self-approve.
Wait for the user to approve through the UI.
You may refine the plan via \`submit_plan\` if the user requests changes.`;
}

function approvedProtocol(plan: MissionPlan | undefined): string {
	const description = plan?.description ?? "(no description)";
	const totalFeatures = plan?.milestones.flatMap((m) => m.features).length ?? 0;
	const totalMilestones = plan?.milestones.length ?? 0;
	return `## MISSION ORCHESTRATOR \u2014 APPROVED

MISSION: ${description}
SCOPE: ${totalMilestones} milestones, ${totalFeatures} features

Start now: call \`update_mission_state\` (start_milestone), then \`spawn_worker\` for the first feature.
On worker failure, use \`create_fix_feature\` instead of debugging yourself.`;
}

function progressSummary(state: MissionState, plan: MissionPlan | undefined): string {
	const allFeatures = plan?.milestones.flatMap((m) => m.features) ?? [];
	const allMilestones = plan?.milestones ?? [];

	const completedFeatures = state.totalFeaturesCompleted + state.totalFeaturesSkipped;
	const totalFeatures = allFeatures.length;
	const currentMilestoneIndex = allMilestones.findIndex((m) => m.id === state.currentMilestoneId) + 1;
	const totalMilestones = allMilestones.length;

	const currentMilestone = allMilestones.find((m) => m.id === state.currentMilestoneId);
	const currentMilestoneName = currentMilestone?.name ?? state.currentMilestoneId ?? "(unknown)";

	const currentFeature = allFeatures.find((f) => f.id === state.currentFeatureId);
	const currentFeatureName = currentFeature?.name ?? state.currentFeatureId ?? "(none)";

	const currentFeatureIndex = allFeatures.findIndex((f) => f.id === state.currentFeatureId) + 1;

	const nextPendingFeature = allFeatures.find((f) => f.status === "pending" && f.id !== state.currentFeatureId);
	const nextFeatureName = nextPendingFeature?.name ?? "(no more features)";

	return `Milestone ${currentMilestoneIndex > 0 ? currentMilestoneIndex : "?"}/${totalMilestones > 0 ? totalMilestones : "?"}: ${currentMilestoneName}
Feature ${currentFeatureIndex > 0 ? currentFeatureIndex : "?"}/${totalFeatures > 0 ? totalFeatures : "?"}: ${currentFeatureName}
Next: ${nextFeatureName}
Progress: ${completedFeatures}/${totalFeatures} features done`;
}

function gitWarnings(state: MissionState): string {
	if (!state.gitSnapshot) return "";
	const warnings: string[] = [];
	if (!state.gitSnapshot.autoCommitEnabled) {
		warnings.push(
			"WARNING: Dirty repo detected \u2014 auto-commit is disabled. Call commit_changes only when appropriate.",
		);
	}
	if (warnings.length === 0) return "";
	return `\n${warnings.join("\n")}`;
}

function executingProtocol(
	state: MissionState,
	plan: MissionPlan | undefined,
	autonomy: MissionConfig["autonomy"],
): string {
	const progress = progressSummary(state, plan);
	const warnings = gitWarnings(state);
	return `## MISSION ORCHESTRATOR \u2014 EXECUTING

${progress}${warnings}

You are a project manager, not an implementer. Never read implementation files, edit code, or run tests. Delegate all implementation to workers.
On failure: call create_fix_feature, then spawn_worker for the fix. Do not debug yourself.
Call spawn_worker for the next pending feature. After all milestone features complete, call run_validation.
When ALL features across ALL milestones are done (no pending/active features remain), call complete_mission immediately with a summary.

${autonomyInstructions(autonomy)}`;
}

function validatingProtocol(): string {
	return `## MISSION ORCHESTRATOR \u2014 VALIDATING

Validation in progress. Do NOT start new workers. Wait for results, then proceed or create fix features.`;
}

function pausedProtocol(): string {
	return `## MISSION PAUSED

The mission has been paused by the user. Stop all work and wait for the user to resume.`;
}

function cavemanPlanning(): string {
	return `## CAVEMAN ORCHESTRATOR \u2014 PLANNING

You plan maker. Follow order:
1. ask_questions \u2014 ask user what want
2. Look package.json, README, dirs. NO read code files
3. submit_plan \u2014 milestones, features, criteria

NO submit_plan before ask_questions. NO read .ts/.js/.py files. Keep plan simple.`;
}

function cavemanExecuting(state: MissionState, plan: MissionPlan | undefined): string {
	const progress = progressSummary(state, plan);
	const warnings = gitWarnings(state);
	return `## CAVEMAN ORCHESTRATOR \u2014 EXECUTING

${progress}${warnings}

You boss. No touch code. spawn_worker do work. Worker fail? create_fix_feature then spawn_worker again.
All features done? run_validation. All milestones done? complete_mission. Go.`;
}

function cavemanDraftReview(): string {
	return `## CAVEMAN \u2014 DRAFT REVIEW\n\nPlan ready. Wait user approve via Mission Control (Ctrl+Shift+M \u2192 A). Resume does NOT mean approval. No call start_milestone. No call spawn_worker. Wait.`;
}

function cavemanApproved(plan: MissionPlan | undefined): string {
	const total = plan?.milestones.flatMap((m) => m.features).length ?? 0;
	return `## CAVEMAN \u2014 APPROVED\n\n${total} features ready. Start: update_mission_state(start_milestone), then spawn_worker. Go.`;
}

function cavemanValidating(): string {
	return `## CAVEMAN \u2014 VALIDATING\n\nValidation running. Wait. No spawn workers.`;
}

function cavemanPaused(): string {
	return `## CAVEMAN \u2014 PAUSED\n\nUser pause. Stop. Wait.`;
}

export function buildCompactMissionSummary(state: MissionState, plan?: MissionPlan): string {
	const allFeatures = plan?.milestones.flatMap((m) => m.features) ?? [];
	const total = allFeatures.length;
	const done = state.totalFeaturesCompleted + state.totalFeaturesSkipped;
	const failed = state.totalFeaturesFailed;
	const currentFeature = allFeatures.find((f) => f.id === state.currentFeatureId)?.name ?? "none";
	const currentMilestone = plan?.milestones.find((m) => m.id === state.currentMilestoneId)?.name ?? "none";
	return `MISSION STATE: ${state.status}, Progress: ${done}/${total} features done (${failed} failed), Current: ${currentFeature} in milestone ${currentMilestone}. Continue executing the mission plan.`;
}

export function buildOrchestratorProtocol(
	state: MissionState | null,
	plan?: MissionPlan,
	config?: MissionConfig,
	compact?: boolean,
): string | null {
	if (!state) return null;
	if (TERMINAL_STATUSES.has(state.status)) return null;

	const key = protocolCacheKey(state, plan, config, compact);
	if (protocolCache && protocolCache.key === key) {
		return protocolCache.value;
	}

	const autonomy = config?.autonomy ?? "medium";
	const mode = resolvePromptingMode(config ?? {});
	let result: string | null;

	if (compact && state.status === "executing") {
		result = buildCompactMissionSummary(state, plan);
	} else if (mode === "caveman" || mode === "caveman-full") {
		switch (state.status) {
			case "planning":
				result = cavemanPlanning();
				break;
			case "draft_review":
				result = cavemanDraftReview();
				break;
			case "approved":
				result = cavemanApproved(plan);
				break;
			case "executing":
				result = cavemanExecuting(state, plan);
				break;
			case "validating":
				result = cavemanValidating();
				break;
			case "paused":
				result = cavemanPaused();
				break;
			default:
				result = null;
				break;
		}
	} else {
		switch (state.status) {
			case "planning":
				result = planningProtocol(autonomy);
				break;
			case "draft_review":
				result = draftReviewProtocol();
				break;
			case "approved":
				result = approvedProtocol(plan);
				break;
			case "executing":
				result = executingProtocol(state, plan, autonomy);
				break;
			case "validating":
				result = validatingProtocol();
				break;
			case "paused":
				result = pausedProtocol();
				break;
			default:
				result = null;
				break;
		}
	}

	if (result !== null) {
		const outputRule = getCavemanOutputRule(mode);
		if (outputRule) {
			result = `${result}\n\n${outputRule}`;
		}
	}

	protocolCache = { key, value: result };
	return result;
}
