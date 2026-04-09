import type { ThemeColor } from "@mariozechner/pi-coding-agent";
import type { MissionPlan, MissionState } from "../types.js";
import { countProgress } from "./count-progress.js";

export interface WidgetAssertionInfo {
	assertionsPassed: number;
	assertionsTotal: number;
}

const DEFAULT_BAR_WIDTH = 10;
const MAX_LINE_WIDTH = 120;
const DONE_CHAR = "\u2588";
const ACTIVE_CHAR = "\u2593";
const PENDING_CHAR = "\u2591";
const SHORTCUT_HINT = "(Ctrl+Shift+M)";

function formatElapsed(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m`;
	return `${totalSeconds}s`;
}

function getElapsedStr(state: MissionState): string | undefined {
	if (state.missionStartedAtMs === undefined) return undefined;
	const elapsed = Date.now() - state.missionStartedAtMs;
	if (elapsed < 0) return undefined;
	return formatElapsed(elapsed);
}

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
	elapsed?: string,
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
	if (elapsed) {
		const elapsedStr = theme ? theme.fg("muted", `${elapsed} elapsed`) : `${elapsed} elapsed`;
		parts.push(elapsedStr);
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
	assertionInfo?: WidgetAssertionInfo,
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
			const allDone = total > 0 && done >= total && !hasActive;
			if (allDone) {
				if (!theme) {
					const bar = DONE_CHAR.repeat(barWidth);
					return [formatProgressLine("\u2713 Done", bar, total, total, "completing...")];
				}
				const prefix = theme.bold(theme.fg("success", "\u2713 Done"));
				const bar = theme.fg("success", DONE_CHAR.repeat(barWidth));
				const body = theme.fg("success", "completing...");
				return [buildStyledLine(prefix, bar, total, total, body, theme)];
			}
			const milestoneName = findCurrentMilestoneName(state, plan);
			const featureName = findCurrentFeatureName(state, plan);
			const elapsed = getElapsedStr(state);
			if (!theme) {
				const bar = buildProgressBar(done, total, hasActive, barWidth);
				const assertionSuffix = assertionInfo
					? `  \u00b7  ${assertionInfo.assertionsPassed}/${assertionInfo.assertionsTotal} assertions`
					: "";
				return [
					truncate(
						formatProgressLine(
							"\u25cf Running",
							bar,
							done,
							total,
							`${buildExecutingSuffix(milestoneName, featureName, undefined, elapsed)}${assertionSuffix}`,
						),
						MAX_LINE_WIDTH,
					),
				];
			}
			const prefix = theme.bold(theme.fg("success", "\u25cf Running"));
			const bar = buildStyledProgressBar(done, total, hasActive, barWidth, theme);
			const suffix = buildExecutingSuffix(milestoneName, featureName, theme, elapsed);
			const assertionPart = assertionInfo
				? `${sep(theme)}${theme.fg("text", `${assertionInfo.assertionsPassed}/${assertionInfo.assertionsTotal} assertions`)}`
				: "";
			return [
				`${buildStyledLine(prefix, bar, done, total, suffix, theme).replace(hint(theme), "")}${assertionPart}${hint(theme)}`,
			];
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
				if (!theme) {
					const base = "\u25cf Validating  \u00b7  validating milestone";
					const assertionSuffix = assertionInfo
						? `  \u00b7  ${assertionInfo.assertionsPassed}/${assertionInfo.assertionsTotal} assertions`
						: "";
					return [truncate(`${base}${assertionSuffix}`, MAX_LINE_WIDTH)];
				}
				const icon = theme.bold(theme.fg("accent", "\u25cf Validating"));
				const body = theme.fg("text", "validating milestone");
				const assertionPart = assertionInfo
					? `${sep(theme)}${theme.fg("text", `${assertionInfo.assertionsPassed}/${assertionInfo.assertionsTotal} assertions`)}`
					: "";
				return [`${icon}${sep(theme)}${body}${assertionPart}${hint(theme)}`];
			}
			const { done, total } = countProgress(state, plan);
			const milestoneName = findCurrentMilestoneName(state, plan);
			const assertionSuffix = assertionInfo
				? `  \u00b7  ${assertionInfo.assertionsPassed}/${assertionInfo.assertionsTotal} assertions`
				: "";
			if (!theme) {
				const bar = buildProgressBar(done, total, false, barWidth);
				const suffix = milestoneName
					? `validating milestone: ${milestoneName}${assertionSuffix}`
					: `validating milestone${assertionSuffix}`;
				return [truncate(formatProgressLine("\u25cf Validating", bar, done, total, suffix), MAX_LINE_WIDTH)];
			}
			const prefix = theme.bold(theme.fg("accent", "\u25cf Validating"));
			const bar = buildStyledProgressBar(done, total, false, barWidth, theme);
			const baseSuffix = milestoneName
				? `${theme.fg("text", `validating: ${milestoneName}`)}`
				: theme.fg("text", "validating milestone");
			const assertionPart = assertionInfo
				? `${sep(theme)}${theme.fg("text", `${assertionInfo.assertionsPassed}/${assertionInfo.assertionsTotal} assertions`)}`
				: "";
			return [
				`${prefix}  ${bar}  ${theme.fg("text", `${done}/${total} features`)}${sep(theme)}${baseSuffix}${assertionPart}${hint(theme)}`,
			];
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
