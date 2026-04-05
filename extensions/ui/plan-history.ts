import { matchesKey } from "@mariozechner/pi-tui";
import type { PlanMutation } from "../types.js";
import { formatRelativeTime } from "./mission-control.js";

export type PlanHistoryAction = { kind: "close" } | { kind: "noop" };

export function renderPlanHistoryView(mutations: PlanMutation[]): string[] {
	const lines: string[] = ["Plan History"];

	if (mutations.length === 0) {
		lines.push("  (no history yet)");
		lines.push("");
		lines.push("Esc: close");
		return lines;
	}

	const sorted = [...mutations].sort((a, b) => a.planVersion - b.planVersion);

	for (const mutation of sorted) {
		const time = formatRelativeTime(mutation.timestamp);
		lines.push(`  v${mutation.planVersion}  ${time.padEnd(4)}  ${mutation.actor}  ${mutation.kind}`);
		lines.push(`    ${mutation.summary}`);
	}

	lines.push("");
	lines.push("Esc: close");

	return lines;
}

export function handlePlanHistoryKey(key: string): PlanHistoryAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}
