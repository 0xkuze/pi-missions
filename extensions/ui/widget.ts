import type { MissionPlan, MissionState } from "../types.js";

const DEFAULT_BAR_WIDTH = 10;
const MAX_LINE_WIDTH = 120;
const DONE_CHAR = "\u2588";
const ACTIVE_CHAR = "\u2593";
const PENDING_CHAR = "\u2591";

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 1)}\u2026`;
}

function countTotalFeatures(plan: MissionPlan): number {
	return plan.milestones.reduce((sum, m) => sum + m.features.length, 0);
}

function countDoneFeatures(state: MissionState): number {
	return state.totalFeaturesCompleted + state.totalFeaturesSkipped;
}

function buildProgressBar(doneCount: number, totalCount: number, hasActive: boolean, barWidth: number): string {
	if (totalCount === 0) return DONE_CHAR.repeat(barWidth);

	const doneWidth = Math.round((doneCount / totalCount) * barWidth);
	const activeWidth = hasActive ? 1 : 0;
	const pendingWidth = Math.max(0, barWidth - doneWidth - activeWidth);
	const actualDoneWidth = barWidth - activeWidth - pendingWidth;

	return DONE_CHAR.repeat(actualDoneWidth) + ACTIVE_CHAR.repeat(activeWidth) + PENDING_CHAR.repeat(pendingWidth);
}

function formatProgressLine(
	prefix: string,
	bar: string,
	doneCount: number,
	totalCount: number,
	suffix: string,
): string {
	const line = `${prefix}  ${bar}  ${doneCount}/${totalCount} features  \u00b7  ${suffix}`;
	return truncate(line, MAX_LINE_WIDTH);
}

function findCurrentFeatureName(state: MissionState, plan: MissionPlan): string | undefined {
	if (!state.currentFeatureId) return undefined;
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.id === state.currentFeatureId) return feature.name;
		}
	}
	return undefined;
}

function findCurrentMilestoneName(state: MissionState, plan: MissionPlan): string | undefined {
	if (!state.currentMilestoneId) return undefined;
	return plan.milestones.find((m) => m.id === state.currentMilestoneId)?.name;
}

function findBlockedFeatureName(state: MissionState, plan: MissionPlan): string | undefined {
	if (state.currentFeatureId) {
		return findCurrentFeatureName(state, plan);
	}
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.status === "failed" || feature.status === "blocked") {
				return feature.name;
			}
		}
	}
	return undefined;
}

function buildExecutingSuffix(milestoneName: string | undefined, featureName: string | undefined): string {
	const parts: string[] = [];
	if (milestoneName) parts.push(`Milestone: ${milestoneName}`);
	if (featureName) parts.push(`Feature: ${featureName}`);
	return parts.length > 0 ? parts.join("  \u00b7  ") : "running";
}

export function buildWidgetLines(state: MissionState, plan?: MissionPlan, barWidth = DEFAULT_BAR_WIDTH): string[] {
	switch (state.status) {
		case "aborted":
			return [];

		case "planning":
			return [truncate("\u23f3 Planning  \u00b7  analyzing codebase...", MAX_LINE_WIDTH)];

		case "draft_review": {
			const milestoneCount = plan?.milestones.length ?? 0;
			const featureCount = plan ? countTotalFeatures(plan) : 0;
			return [
				truncate(
					`\ud83d\udccb Draft  \u00b7  ${milestoneCount} milestones, ${featureCount} features  \u00b7  awaiting approval`,
					MAX_LINE_WIDTH,
				),
			];
		}

		case "approved":
			return [truncate("\u2713 Approved  \u00b7  plan approved, starting execution", MAX_LINE_WIDTH)];

		case "executing": {
			if (!plan) return ["\u25cf Running"];
			const total = countTotalFeatures(plan);
			const done = countDoneFeatures(state);
			const hasActive = !!state.currentFeatureId;
			const bar = buildProgressBar(done, total, hasActive, barWidth);
			const milestoneName = findCurrentMilestoneName(state, plan);
			const featureName = findCurrentFeatureName(state, plan);
			return [
				formatProgressLine("\u25cf Running", bar, done, total, buildExecutingSuffix(milestoneName, featureName)),
			];
		}

		case "paused": {
			if (!plan) return ["\u23f8 Paused  \u00b7  waiting for input"];
			const total = countTotalFeatures(plan);
			const done = countDoneFeatures(state);
			const bar = buildProgressBar(done, total, false, barWidth);
			return [formatProgressLine("\u23f8 Paused", bar, done, total, "waiting for input")];
		}

		case "validating": {
			if (!plan) return ["\u25cf Validating  \u00b7  validating milestone"];
			const total = countTotalFeatures(plan);
			const done = countDoneFeatures(state);
			const bar = buildProgressBar(done, total, false, barWidth);
			const milestoneName = findCurrentMilestoneName(state, plan);
			const suffix = milestoneName ? `validating milestone: ${milestoneName}` : "validating milestone";
			return [formatProgressLine("\u25cf Validating", bar, done, total, suffix)];
		}

		case "completed": {
			const bar = DONE_CHAR.repeat(barWidth);
			const total = plan ? countTotalFeatures(plan) : state.totalFeaturesCompleted + state.totalFeaturesSkipped;
			return [formatProgressLine("\u2713 Done", bar, total, total, "report ready")];
		}

		case "failed": {
			if (!plan) return ["\u2717 Failed"];
			const total = countTotalFeatures(plan);
			const done = countDoneFeatures(state);
			const bar = buildProgressBar(done, total, false, barWidth);
			const blockedName = findBlockedFeatureName(state, plan);
			const suffix = blockedName ? `blocked on ${blockedName}` : "blocked";
			return [formatProgressLine("\u2717 Failed", bar, done, total, suffix)];
		}
	}
}

export interface WidgetUI {
	setWidget(name: string, lines: string[]): void;
}

export function updateWidget(ui: WidgetUI, state: MissionState, plan?: MissionPlan): void {
	const lines = buildWidgetLines(state, plan);
	ui.setWidget("mission", lines);
}
