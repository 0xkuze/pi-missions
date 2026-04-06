import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionState } from "../types.js";
import type { FrameStyle } from "./frame.js";
import { footerBar, panel, section, titleBar } from "./frame.js";

export type PlanningSetupAction = { kind: "close" } | { kind: "noop" };

export function renderPlanningSetupView(
	state: MissionState,
	goal: string | undefined,
	width: number,
	style: FrameStyle | undefined,
	height: number,
	scrollOffset = 0,
): string[] {
	const contentWidth = width - 4;
	const tf = style?.textFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const lines: string[] = [];

	if (goal) {
		lines.push(bf(tf(`Goal: ${goal}`)));
		lines.push("");
	}

	lines.push(mf("Orchestrator is analyzing the codebase and gathering"));
	lines.push(mf("constraints before drafting a plan."));
	lines.push("");
	lines.push(mf("The orchestrator will ask you questions in the chat."));
	lines.push(mf("Answer them to help refine the plan."));

	const contextBullets = extractContextBullets(state);
	if (contextBullets.length > 0) {
		lines.push("");
		lines.push(section("Context discovered", contentWidth, style));
		for (const bullet of contextBullets) {
			lines.push(`\u2022 ${tf(bullet)}`);
		}
	}

	const panelHeight = Math.max(5, height - 7);
	return [
		titleBar("Mission Setup", width, style),
		...panel("Setup", lines, width, panelHeight, scrollOffset, style),
		...footerBar("Esc: close", width, style),
	];
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
