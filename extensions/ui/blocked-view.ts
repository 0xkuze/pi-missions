import { matchesKey } from "@mariozechner/pi-tui";
import type { Feature } from "../types.js";
import { frame, section } from "./frame.js";

export type BlockedViewAction = { kind: "retry" } | { kind: "skip" } | { kind: "close" } | { kind: "noop" };

export interface LastFailureDetails {
	errorMessage?: string;
	details?: string;
}

export function renderBlockedView(
	feature: Feature,
	maxRetries: number,
	lastFailure: LastFailureDetails | undefined,
	width = 80,
): string[] {
	const contentWidth = width - 4;
	const lines: string[] = [];

	lines.push(`Blocked: ${feature.name}`);
	lines.push("");

	const attemptCount = feature.attempts.length;
	lines.push(`Attempts: ${attemptCount}/${maxRetries} failed`);
	lines.push("");

	if (lastFailure) {
		lines.push(section("Last Failure", contentWidth));
		if (lastFailure.errorMessage) {
			lines.push(lastFailure.errorMessage);
		}
		if (lastFailure.details) {
			const detailLines = lastFailure.details.split("\n");
			for (const line of detailLines) {
				lines.push(line);
			}
		}
		lines.push("");
	}

	lines.push("This feature has exhausted all retry attempts.");
	lines.push("You can retry with additional instructions, skip it, or return to chat.");

	return frame("Mission Blocked", lines, width, "R: retry   S: skip   Esc: back to chat");
}

export function handleBlockedViewKey(key: string): BlockedViewAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	if (key.toUpperCase() === "R") return { kind: "retry" };
	if (key.toUpperCase() === "S") return { kind: "skip" };
	return { kind: "noop" };
}
