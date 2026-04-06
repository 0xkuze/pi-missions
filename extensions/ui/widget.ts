import type { ThemeColor } from "@mariozechner/pi-coding-agent";
import type { MissionPlan, MissionState } from "../types.js";
import { countProgress } from "./count-progress.js";

const DEFAULT_BAR_WIDTH = 10;
const MAX_LINE_WIDTH = 120;
const DONE_CHAR = "\u2588";
const ACTIVE_CHAR = "\u2593";
const PENDING_CHAR = "\u2591";
const SHORTCUT_HINT = "(Ctrl+Shift+M)";

export type ThemeStyler = {
	fg: (color: ThemeColor, text: string) => string;
	bold: (text: string) => string;
};

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 1)}\u2026`;
}

function buildProgressBar(doneCount: number, totalCount: number, hasActive: boolean, barWidth: number): string {
	if (totalCount === 0) return DONE_CHAR.repeat(barWidth);

	const doneWidth = Math.round((doneCount / totalCount) * barWidth);
	const activeWidth = hasActive ? 1 : 0;
	const pendingWidth = Math.max(0, barWidth - doneWidth - activeWidth);
	const actualDoneWidth = barWidth - activeWidth - pendingWidth;

	return DONE_CHAR.repeat(actualDoneWidth) + ACTIVE_CHAR.repeat(activeWidth) + PENDING_CHAR.repeat(pendingWidth);
}

function buildStyledProgressBar(
	doneCount: number,
	totalCount: number,
	hasActive: boolean,
	barWidth: number,
	theme: ThemeStyler,
): string {
	if (totalCount === 0) return theme.fg("success", DONE_CHAR.repeat(barWidth));

	const doneWidth = Math.round((doneCount / totalCount) * barWidth);
	const activeWidth = hasActive ? 1 : 0;
	const pendingWidth = Math.max(0, barWidth - doneWidth - activeWidth);
	const actualDoneWidth = barWidth - activeWidth - pendingWidth;

	const donePart = actualDoneWidth > 0 ? theme.fg("success", DONE_CHAR.repeat(actualDoneWidth)) : "";
	const activePart = activeWidth > 0 ? theme.fg("accent", ACTIVE_CHAR.repeat(activeWidth)) : "";
	const pendingPart = pendingWidth > 0 ? theme.fg("muted", PENDING_CHAR.repeat(pendingWidth)) : "";

	return donePart + activePart + pendingPart;
}

function sep(theme?: ThemeStyler): string {
	return theme ? theme.fg("muted", " \u00b7 ") : "  \u00b7  ";
}

function hint(theme?: ThemeStyler): string {
	return theme ? `  ${theme.fg("muted", SHORTCUT_HINT)}` : "";
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

function buildExecutingSuffix(
	milestoneName: string | undefined,
	featureName: string | undefined,
	theme?: ThemeStyler,
): string {
	const parts: string[] = [];
	if (milestoneName) {
		const label = theme ? theme.fg("muted", "Milestone:") : "Milestone:";
		const value = theme ? theme.fg("text", ` ${milestoneName}`) : ` ${milestoneName}`;
		parts.push(`${label}${value}`);
	}
	if (featureName) {
		const label = theme ? theme.fg("muted", "Feature:") : "Feature:";
		const value = theme ? theme.fg("text", ` ${featureName}`) : ` ${featureName}`;
		parts.push(`${label}${value}`);
	}
	return parts.length > 0 ? parts.join(sep(theme)) : "running";
}

function buildStyledLine(
	prefix: string,
	bar: string,
	doneCount: number,
	totalCount: number,
	suffix: string,
	theme: ThemeStyler,
): string {
	const count = theme.fg("text", `${doneCount}/${totalCount} features`);
	return `${prefix}  ${bar}  ${count}${sep(theme)}${suffix}${hint(theme)}`;
}

export function buildWidgetLines(
	state: MissionState,
	plan?: MissionPlan,
	barWidth = DEFAULT_BAR_WIDTH,
	theme?: ThemeStyler,
): string[] {
	switch (state.status) {
		case "aborted":
			return [];

		case "planning": {
			if (!theme) return [truncate("\u25c7 Planning  \u00b7  analyzing codebase...", MAX_LINE_WIDTH)];
			const icon = theme.bold(theme.fg("accent", "\u25c7 Planning"));
			const body = theme.fg("text", "analyzing codebase...");
			return [`${icon}${sep(theme)}${body}${hint(theme)}`];
		}

		case "draft_review": {
			const milestoneCount = plan?.milestones.length ?? 0;
			const featureCount = plan ? countProgress(state, plan).total : 0;
			if (!theme) {
				return [
					truncate(
						`\u25c6 Draft  \u00b7  ${milestoneCount} milestones, ${featureCount} features  \u00b7  awaiting approval`,
						MAX_LINE_WIDTH,
					),
				];
			}
			const icon = theme.bold(theme.fg("accent", "\u25c6 Draft"));
			const counts = theme.fg("text", `${milestoneCount} milestones, ${featureCount} features`);
			const approval = theme.fg("accent", "awaiting approval");
			return [`${icon}${sep(theme)}${counts}${sep(theme)}${approval}${hint(theme)}`];
		}

		case "approved": {
			if (!theme) return [truncate("\u2713 Approved  \u00b7  plan approved, starting execution", MAX_LINE_WIDTH)];
			const icon = theme.bold(theme.fg("success", "\u2713 Approved"));
			const body = theme.fg("text", "plan approved, starting execution");
			return [`${icon}${sep(theme)}${body}${hint(theme)}`];
		}

		case "executing": {
			if (!plan) {
				if (!theme) return ["\u25cf Running"];
				return [`${theme.bold(theme.fg("success", "\u25cf Running"))}${hint(theme)}`];
			}
			const { done, total, hasActive } = countProgress(state, plan);
			const milestoneName = findCurrentMilestoneName(state, plan);
			const featureName = findCurrentFeatureName(state, plan);
			if (!theme) {
				const bar = buildProgressBar(done, total, hasActive, barWidth);
				return [
					formatProgressLine("\u25cf Running", bar, done, total, buildExecutingSuffix(milestoneName, featureName)),
				];
			}
			const prefix = theme.bold(theme.fg("success", "\u25cf Running"));
			const bar = buildStyledProgressBar(done, total, hasActive, barWidth, theme);
			const suffix = buildExecutingSuffix(milestoneName, featureName, theme);
			return [buildStyledLine(prefix, bar, done, total, suffix, theme)];
		}

		case "paused": {
			if (!plan) {
				if (!theme) return ["\u23f8 Paused  \u00b7  waiting for input"];
				const icon = theme.bold(theme.fg("warning", "\u23f8 Paused"));
				const body = theme.fg("warning", "waiting for input");
				return [`${icon}${sep(theme)}${body}${hint(theme)}`];
			}
			const { done, total } = countProgress(state, plan);
			if (!theme) {
				const bar = buildProgressBar(done, total, false, barWidth);
				return [formatProgressLine("\u23f8 Paused", bar, done, total, "waiting for input")];
			}
			const prefix = theme.bold(theme.fg("warning", "\u23f8 Paused"));
			const bar = buildStyledProgressBar(done, total, false, barWidth, theme);
			const body = theme.fg("warning", "waiting for input");
			return [buildStyledLine(prefix, bar, done, total, body, theme)];
		}

		case "validating": {
			if (!plan) {
				if (!theme) return ["\u25cf Validating  \u00b7  validating milestone"];
				const icon = theme.bold(theme.fg("accent", "\u25cf Validating"));
				const body = theme.fg("text", "validating milestone");
				return [`${icon}${sep(theme)}${body}${hint(theme)}`];
			}
			const { done, total } = countProgress(state, plan);
			const milestoneName = findCurrentMilestoneName(state, plan);
			if (!theme) {
				const bar = buildProgressBar(done, total, false, barWidth);
				const suffix = milestoneName ? `validating milestone: ${milestoneName}` : "validating milestone";
				return [formatProgressLine("\u25cf Validating", bar, done, total, suffix)];
			}
			const prefix = theme.bold(theme.fg("accent", "\u25cf Validating"));
			const bar = buildStyledProgressBar(done, total, false, barWidth, theme);
			const suffix = milestoneName
				? `${theme.fg("text", `validating: ${milestoneName}`)}`
				: theme.fg("text", "validating milestone");
			return [buildStyledLine(prefix, bar, done, total, suffix, theme)];
		}

		case "completed": {
			const { total } = countProgress(state, plan);
			if (!theme) {
				const bar = DONE_CHAR.repeat(barWidth);
				return [formatProgressLine("\u2713 Done", bar, total, total, "report ready")];
			}
			const prefix = theme.bold(theme.fg("success", "\u2713 Done"));
			const bar = theme.fg("success", DONE_CHAR.repeat(barWidth));
			const body = theme.fg("success", "report ready");
			return [buildStyledLine(prefix, bar, total, total, body, theme)];
		}

		case "failed": {
			if (!plan) {
				if (!theme) return ["\u2717 Failed"];
				return [`${theme.bold(theme.fg("error", "\u2717 Failed"))}${hint(theme)}`];
			}
			const { done, total } = countProgress(state, plan);
			const blockedName = findBlockedFeatureName(state, plan);
			if (!theme) {
				const bar = buildProgressBar(done, total, false, barWidth);
				const suffix = blockedName ? `blocked on ${blockedName}` : "blocked";
				return [formatProgressLine("\u2717 Failed", bar, done, total, suffix)];
			}
			const prefix = theme.bold(theme.fg("error", "\u2717 Failed"));
			const bar = buildStyledProgressBar(done, total, false, barWidth, theme);
			const body = theme.fg("error", blockedName ? `blocked on ${blockedName}` : "blocked");
			return [buildStyledLine(prefix, bar, done, total, body, theme)];
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
