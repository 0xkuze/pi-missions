import type { Feature, MissionPlan } from "./types.js";

type Milestone = MissionPlan["milestones"][number];

export function findFeature(plan: MissionPlan, featureId: string): Feature | null {
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.id === featureId) return feature;
		}
	}
	return null;
}

export function findFeatureWithMilestone(
	plan: MissionPlan,
	featureId: string,
): { milestone: Milestone; feature: Feature } | null {
	for (const milestone of plan.milestones) {
		const feature = milestone.features.find((f) => f.id === featureId);
		if (feature) return { milestone, feature };
	}
	return null;
}

export function hasPendingFeatures(plan: MissionPlan): boolean {
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.status === "pending" || feature.status === "active") return true;
		}
	}
	return false;
}

export function countPendingFeatures(plan: MissionPlan): number {
	let count = 0;
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.status === "pending" || feature.status === "active") count++;
		}
	}
	return count;
}
