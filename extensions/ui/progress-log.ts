import { matchesKey } from "@mariozechner/pi-tui";
import type { ProgressEvent } from "../types.js";
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

export function renderProgressLog(progressLog: ProgressEvent[]): string[] {
	const lines: string[] = ["Progress Log"];

	if (progressLog.length === 0) {
		lines.push("  (no events yet)");
		return lines;
	}

	const events = [...progressLog].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

	for (const event of events) {
		const time = formatRelativeTime(event.timestamp);
		const icon = progressEventIcon(event.type);
		lines.push(`  ${time.padEnd(4)} ${icon} ${event.detail}`);
	}

	lines.push("");
	lines.push("Esc: close");

	return lines;
}

export function handleProgressLogKey(key: string): ProgressLogAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}
