import type { MissionPlan, MissionState } from "../types.js";
import { nowISO } from "../utils.js";

export const RESOLVED_FEATURE_STATUSES = new Set(["done", "skipped", "failed", "blocked"]);

export function findMilestoneForFeature(
	plan: MissionPlan,
	featureId: string,
): MissionPlan["milestones"][number] | null {
	for (const milestone of plan.milestones) {
		if (milestone.features.some((f) => f.id === featureId)) return milestone;
	}
	return null;
}

export function autoStartMilestone(
	plan: MissionPlan,
	state: MissionState,
	featureId: string,
): { plan: MissionPlan; state: MissionState } {
	const milestone = findMilestoneForFeature(plan, featureId);
	if (!milestone || milestone.status !== "pending") return { plan, state };
	const now = nowISO();
	return {
		plan: {
			...plan,
			milestones: plan.milestones.map((m) =>
				m.id === milestone.id ? { ...m, status: "active" as const, startedAt: now } : m,
			),
		},
		state: {
			...state,
			currentMilestoneId: milestone.id,
			progressLog: [
				...state.progressLog,
				{ timestamp: now, type: "milestone_start" as const, detail: `Milestone '${milestone.name}' started` },
			],
		},
	};
}

export function autoCompleteMilestone(
	plan: MissionPlan,
	state: MissionState,
	featureId: string,
): { plan: MissionPlan; state: MissionState } {
	const milestone = findMilestoneForFeature(plan, featureId);
	if (!milestone || milestone.status !== "active") return { plan, state };
	if (!milestone.features.every((f) => RESOLVED_FEATURE_STATUSES.has(f.status))) return { plan, state };

	const hasFailedFeatures = milestone.features.some((f) => f.status === "failed");
	const milestoneStatus = hasFailedFeatures ? ("failed" as const) : ("done" as const);
	const eventType = hasFailedFeatures ? ("milestone_complete" as const) : ("milestone_complete" as const);
	const suffix = hasFailedFeatures ? " (with failed features)" : "";

	const now = nowISO();
	return {
		plan: {
			...plan,
			milestones: plan.milestones.map((m) =>
				m.id === milestone.id ? { ...m, status: milestoneStatus, completedAt: now } : m,
			),
		},
		state: {
			...state,
			progressLog: [
				...state.progressLog,
				{ timestamp: now, type: eventType, detail: `Milestone '${milestone.name}' completed${suffix}` },
			],
		},
	};
}
