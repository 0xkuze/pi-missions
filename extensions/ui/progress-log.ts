import { matchesKey } from "@mariozechner/pi-tui";
import type { ProgressEvent } from "../types.js";
import type { FrameStyle } from "./frame.js";
import { footerBar, panel, titleBar } from "./frame.js";
import { formatRelativeTime } from "./mission-control.js";

export type ProgressLogAction = { kind: "close" } | { kind: "noop" };

function styledProgressEventIcon(type: ProgressEvent["type"], style?: FrameStyle): string {
	switch (type) {
		case "feature_complete":
		case "milestone_complete":
		case "validation_pass":
		case "mission_complete":
		case "plan_approved":
		case "commit_created":
		case "worker_complete":
			return (style?.successFn ?? ((t: string) => t))("\u2713");
		case "feature_failed":
		case "validation_fail":
		case "mission_failed":
		case "mission_aborted":
		case "feature_blocked":
			return (style?.errorFn ?? ((t: string) => t))("\u2717");
		case "feature_start":
		case "worker_spawn":
		case "milestone_start":
		case "validation_start":
		case "planning_started":
		case "mission_started":
			return (style?.accentFn ?? ((t: string) => t))("\u25cf");
		case "feature_skipped":
			return (style?.mutedFn ?? ((t: string) => t))("\u2013");
		case "pause":
		case "resume":
		case "redirect":
		case "plan_mutated":
		case "plan_submitted":
		case "fix_feature_created":
			return (style?.mutedFn ?? ((t: string) => t))("\u00b7");
		default:
			return (style?.mutedFn ?? ((t: string) => t))("\u00b7");
	}
}

export function renderProgressLog(
	progressLog: ProgressEvent[],
	width: number,
	style: FrameStyle | undefined,
	height: number,
): string[] {
	const mf = style?.mutedFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);

	const panelHeight = Math.max(5, height - 7);

	if (progressLog.length === 0) {
		return [
			titleBar("Progress Log", width, style),
			...panel("Events", [mf("(no events yet)")], width, panelHeight, 0, style),
			...footerBar("Esc: close", width, style),
		];
	}

	const events = [...progressLog].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	const lines: string[] = [];

	for (const event of events) {
		const time = formatRelativeTime(event.timestamp);
		const icon = styledProgressEventIcon(event.type, style);
		lines.push(`${mf(time.padEnd(4))} ${icon} ${tf(event.detail)}`);
	}

	return [
		titleBar("Progress Log", width, style),
		...panel("Events", lines, width, panelHeight, 0, style),
		...footerBar("Esc: close", width, style),
	];
}

export function handleProgressLogKey(key: string): ProgressLogAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}
