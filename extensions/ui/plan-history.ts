import { matchesKey } from "@mariozechner/pi-tui";
import type { PlanMutation } from "../types.js";
import type { FrameStyle } from "./frame.js";
import { frame } from "./frame.js";
import { formatRelativeTime } from "./mission-control.js";

export type PlanHistoryAction = { kind: "close" } | { kind: "noop" };

export function renderPlanHistoryView(mutations: PlanMutation[], width = 80, style?: FrameStyle): string[] {
	const mf = style?.mutedFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);
	const af = style?.accentFn ?? ((t: string) => t);

	if (mutations.length === 0) {
		return frame("Plan History", [mf("(no history yet)")], width, "Esc: close", style);
	}

	const sorted = [...mutations].sort((a, b) => a.planVersion - b.planVersion);
	const lines: string[] = [];

	for (const mutation of sorted) {
		const time = formatRelativeTime(mutation.timestamp);
		lines.push(
			`${af(`v${mutation.planVersion}`)}  ${mf(time.padEnd(4))}  ${tf(mutation.actor)}  ${mf(mutation.kind)}`,
		);
		lines.push(`  ${tf(mutation.summary)}`);
	}

	return frame("Plan History", lines, width, "Esc: close", style);
}

export function handlePlanHistoryKey(key: string): PlanHistoryAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}
