import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionPlan } from "../types.js";
import type { FrameStyle } from "./frame.js";
import { frame } from "./frame.js";

export type PlanOverlayAction = { kind: "close" } | { kind: "noop" };

const ICON_DONE = "\u2713";
const ICON_ACTIVE = "\u25cf";
const ICON_PENDING = "\u25cb";
const ICON_FAILED = "\u2717";
const ICON_SKIPPED = "\u2013";
const ICON_FIX = "\u27a1";

function featureIcon(status: string): string {
	switch (status) {
		case "done":
			return ICON_DONE;
		case "active":
			return ICON_ACTIVE;
		case "pending":
			return ICON_PENDING;
		case "failed":
		case "blocked":
			return ICON_FAILED;
		case "skipped":
			return ICON_SKIPPED;
		default:
			return ICON_PENDING;
	}
}

function milestoneIcon(status: string): string {
	switch (status) {
		case "done":
			return ICON_DONE;
		case "active":
			return ICON_ACTIVE;
		case "pending":
			return ICON_PENDING;
		case "failed":
			return ICON_FAILED;
		default:
			return ICON_PENDING;
	}
}

export function renderPlanOverlay(plan: MissionPlan, width = 80, style?: FrameStyle): string[] {
	const lines: string[] = [`${plan.description}`, ""];

	for (const milestone of plan.milestones) {
		const mIcon = milestoneIcon(milestone.status);
		lines.push(`${mIcon} ${milestone.name} [${milestone.status}]`);

		for (const feature of milestone.features) {
			const fIcon = featureIcon(feature.status);
			const fixMark = feature.fixOrigin ? ` ${ICON_FIX}` : "";
			lines.push(`    ${fIcon} ${feature.name}${fixMark} [${feature.status}]`);
		}
		lines.push("");
	}

	return frame("Mission Plan", lines, width, "Esc: close", style);
}

export function handlePlanOverlayKey(key: string): PlanOverlayAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}

export class PlanOverlayComponent {
	private style: FrameStyle | undefined;

	constructor(
		private plan: MissionPlan,
		private done: () => void,
		style?: FrameStyle,
	) {
		this.style = style;
	}

	handleInput(data: string): void {
		const action = handlePlanOverlayKey(data);
		if (action.kind === "close") this.done();
	}

	render(width: number): string[] {
		return renderPlanOverlay(this.plan, width, this.style);
	}

	invalidate(): void {}
}
