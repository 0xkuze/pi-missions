import { matchesKey } from "@mariozechner/pi-tui";
import type { Feature } from "../types.js";
import type { FrameStyle } from "./frame.js";
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
	style?: FrameStyle,
): string[] {
	const contentWidth = width - 4;
	const ef = style?.errorFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const lines: string[] = [];

	lines.push(`${ef("Blocked:")} ${bf(tf(feature.name))}`);
	lines.push("");

	const attemptCount = feature.attempts.length;
	lines.push(mf(`Attempts: ${attemptCount}/${maxRetries} failed`));
	lines.push("");

	if (lastFailure) {
		lines.push(section("Last Failure", contentWidth, style));
		if (lastFailure.errorMessage) {
			lines.push(ef(lastFailure.errorMessage));
		}
		if (lastFailure.details) {
			const detailLines = lastFailure.details.split("\n");
			for (const line of detailLines) {
				lines.push(ef(line));
			}
		}
		lines.push("");
	}

	lines.push(mf("This feature has exhausted all retry attempts."));
	lines.push(mf("You can retry with additional instructions, skip it, or return to chat."));

	return frame("Mission Blocked", lines, width, "R: retry   S: skip   Esc: back to chat", style);
}

export function handleBlockedViewKey(key: string): BlockedViewAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	if (key.toUpperCase() === "R") return { kind: "retry" };
	if (key.toUpperCase() === "S") return { kind: "skip" };
	return { kind: "noop" };
}
