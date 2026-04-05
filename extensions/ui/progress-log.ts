import { matchesKey } from "@mariozechner/pi-tui";
import type { ProgressEvent } from "../types.js";
import { frame } from "./frame.js";
import { formatRelativeTime } from "./mission-control.js";

export type ProgressLogAction = { kind: "close" } | { kind: "noop" };

function progressEventIcon(type: ProgressEvent["type"]): string {
	switch (type) {
		case "feature_complete":
		case "milestone_complete":
		case "validation_pass":
		case "mission_complete":
		case "plan_approved":
		case "commit_created":
		case "worker_complete":
			return "\u2713";
		case "feature_failed":
		case "validation_fail":
		case "mission_failed":
		case "mission_aborted":
		case "feature_blocked":
			return "\u2717";
		case "feature_start":
		case "worker_spawn":
		case "milestone_start":
		case "validation_start":
		case "planning_started":
		case "mission_started":
			return "\u25cf";
		case "feature_skipped":
			return "\u2013";
		case "pause":
		case "resume":
		case "redirect":
		case "plan_mutated":
		case "plan_submitted":
		case "fix_feature_created":
			return "\u00b7";
		default:
			return "\u00b7";
	}
}

export function renderProgressLog(progressLog: ProgressEvent[], width = 80): string[] {
	if (progressLog.length === 0) {
		return frame("Progress Log", ["(no events yet)"], width, "Esc: close");
	}

	const events = [...progressLog].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	const lines: string[] = [];

	for (const event of events) {
		const time = formatRelativeTime(event.timestamp);
		const icon = progressEventIcon(event.type);
		lines.push(`${time.padEnd(4)} ${icon} ${event.detail}`);
	}

	return frame("Progress Log", lines, width, "Esc: close");
}

export function handleProgressLogKey(key: string): ProgressLogAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}
