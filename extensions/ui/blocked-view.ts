import { matchesKey } from "@mariozechner/pi-tui";
import type { Feature } from "../types.js";

export type BlockedViewAction = { kind: "retry" } | { kind: "skip" } | { kind: "close" } | { kind: "noop" };

export interface LastFailureDetails {
	errorMessage?: string;
	details?: string;
}

export function renderBlockedView(
	feature: Feature,
	maxRetries: number,
	lastFailure: LastFailureDetails | undefined,
): string[] {
	const lines: string[] = [];

	lines.push(`Blocked: ${feature.name}`);
	lines.push("");

	const attemptCount = feature.attempts.length;
	lines.push(`Attempts: ${attemptCount}/${maxRetries} failed`);
	lines.push("");

	if (lastFailure) {
		lines.push("Last Failure");
		if (lastFailure.errorMessage) {
			lines.push(`  ${lastFailure.errorMessage}`);
		}
		if (lastFailure.details) {
			const detailLines = lastFailure.details.split("\n");
			for (const line of detailLines) {
				lines.push(`  ${line}`);
			}
		}
		lines.push("");
	}

	lines.push("This feature has exhausted all retry attempts.");
	lines.push("You can retry with additional instructions, skip it, or return to chat.");
	lines.push("");
	lines.push("R: retry with instructions   S: skip feature   Esc: back to chat");

	return lines;
}

export function handleBlockedViewKey(key: string): BlockedViewAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	if (key.toUpperCase() === "R") return { kind: "retry" };
	if (key.toUpperCase() === "S") return { kind: "skip" };
	return { kind: "noop" };
}
