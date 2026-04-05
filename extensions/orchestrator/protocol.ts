import type { MissionConfig, MissionPlan, MissionState } from "../types.js";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "aborted", "idle"]);

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

You are in the planning phase. Your task: deeply understand the codebase, gather constraints, and produce a structured plan by calling \`submit_plan\`.

STEPS:
1. Analyze the codebase \u2014 use read, bash, and grep to understand structure, technology stack, existing patterns, and constraints.
2. Identify what exists and what needs to be built. Check for AGENTS.md, package.json, README, and similar context files.
3. Ask the user focused clarifying questions if requirements are ambiguous.
4. When you have sufficient context, call \`submit_plan\` with milestones, features, acceptance criteria, and validation commands.

RULES:
- This is the planning phase only. Do not begin executing features or running workers.
- Submit a plan with at least one milestone and at least one feature per milestone.
- Each feature must have clear, testable acceptance criteria.
- Group features into milestones that represent validation checkpoints.

${autonomyInstructions(autonomy)}`;
}

function draftReviewProtocol(): string {
	return `## MISSION ORCHESTRATOR \u2014 DRAFT REVIEW

A plan has been submitted and is awaiting user approval. The plan is visible in the Mission Control overlay.

RULES:
- Do NOT start executing features. Execution is prohibited until the user approves the plan.
- Wait for the user to approve via \`/mission-approve\` or to request changes.
- If the user requests changes, you may call \`submit_plan\` again with a revised plan.`;
}

function approvedProtocol(plan: MissionPlan | undefined): string {
	const description = plan?.description ?? "(no description)";
	const totalFeatures = plan?.milestones.flatMap((m) => m.features).length ?? 0;
	const totalMilestones = plan?.milestones.length ?? 0;
	return `## MISSION ORCHESTRATOR \u2014 EXECUTION READY

The plan has been approved and execution is ready to begin.

MISSION: ${description}
SCOPE: ${totalMilestones} milestones, ${totalFeatures} features

START EXECUTION NOW:
1. Call \`update_mission_state\` with action \`start_milestone\` for the first milestone.
2. Call \`spawn_worker\` with the first feature's ID to begin execution.

TOOLS AVAILABLE: spawn_worker, update_mission_state, run_validation, commit_changes, create_fix_feature, complete_mission`;
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

CURRENT PROGRESS:
${progress}${warnings}

TOOLS: spawn_worker, update_mission_state, run_validation, commit_changes, create_fix_feature, complete_mission

NEXT STEP: Call spawn_worker with the next pending feature ID. After all features in a milestone complete, call run_validation before proceeding.

${autonomyInstructions(autonomy)}`;
}

function validatingProtocol(): string {
	return `## MISSION ORCHESTRATOR \u2014 VALIDATING

Milestone validation is in progress. Wait for the validation results before taking further action.

RULES:
- Do NOT start any new worker tasks while validation is running.
- When validation completes, analyze the results and decide: proceed to the next milestone or create fix features.`;
}

function pausedProtocol(): string {
	return `## MISSION PAUSED

The mission has been paused by the user. Stop all work and wait for the user to resume.`;
}

export function buildOrchestratorProtocol(
	state: MissionState | null,
	plan?: MissionPlan,
	config?: MissionConfig,
): string | null {
	if (!state) return null;
	if (TERMINAL_STATUSES.has(state.status)) return null;

	const autonomy = config?.autonomy ?? "medium";

	switch (state.status) {
		case "planning":
			return planningProtocol(autonomy);
		case "draft_review":
			return draftReviewProtocol();
		case "approved":
			return approvedProtocol(plan);
		case "executing":
			return executingProtocol(state, plan, autonomy);
		case "validating":
			return validatingProtocol();
		case "paused":
			return pausedProtocol();
		default:
			return null;
	}
}
