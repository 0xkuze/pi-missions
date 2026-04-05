import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionState } from "../types.js";
import { frame, section } from "./frame.js";

export type PlanningSetupAction = { kind: "close" } | { kind: "noop" };

export function renderPlanningSetupView(state: MissionState, goal?: string, width = 80): string[] {
	const contentWidth = width - 4;
	const lines: string[] = [];

	if (goal) {
		lines.push(`Goal: ${goal}`);
		lines.push("");
	}

	lines.push("Orchestrator is analyzing the codebase and gathering");
	lines.push("constraints before drafting a plan.");
	lines.push("");
	lines.push("The orchestrator will ask you questions in the chat.");
	lines.push("Answer them to help refine the plan.");

	const contextBullets = extractContextBullets(state);
	if (contextBullets.length > 0) {
		lines.push("");
		lines.push(section("Context discovered", contentWidth));
		for (const bullet of contextBullets) {
			lines.push(`\u2022 ${bullet}`);
		}
	}

	return frame("Mission Setup", lines, width, "Esc: close");
}

function extractContextBullets(state: MissionState): string[] {
	const bullets: string[] = [];
	for (const event of state.progressLog) {
		if (event.type === "planning_started" && event.metadata) {
			const context = event.metadata.context;
			if (Array.isArray(context)) {
				for (const item of context) {
					if (typeof item === "string") {
						bullets.push(item);
					}
				}
			}
		}
	}
	return bullets;
}

export function handlePlanningSetupKey(key: string): PlanningSetupAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}
