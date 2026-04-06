import type { MissionPlan, MissionState } from "../types.js";

export interface ProgressCounts {
	done: number;
	total: number;
	hasActive: boolean;
}

export function countProgress(state: MissionState, plan?: MissionPlan): ProgressCounts {
	if (!plan) {
		return {
			done: state.totalFeaturesCompleted + state.totalFeaturesSkipped,
			total: state.totalFeaturesCompleted + state.totalFeaturesSkipped + state.totalFeaturesFailed,
			hasActive: !!state.currentFeatureId,
		};
	}
	let done = 0;
	let total = 0;
	let hasActive = false;
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			total++;
			if (feature.status === "done" || feature.status === "skipped") done++;
			if (feature.status === "active") hasActive = true;
		}
	}
	return { done, total, hasActive };
}
