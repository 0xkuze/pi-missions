import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionPlan } from "../types.js";
import type { FrameStyle } from "./frame.js";
import { frame, styledFeatureIcon, styledFeatureName } from "./frame.js";

export type PlanOverlayAction = { kind: "close" } | { kind: "noop" };

const ICON_FIX = "\u27a1";

function styledMilestoneIcon(status: string, style?: FrameStyle): string {
	switch (status) {
		case "done":
			return (style?.successFn ?? ((t: string) => t))("\u2713");
		case "active":
			return (style?.accentFn ?? ((t: string) => t))("\u25cf");
		case "pending":
			return (style?.mutedFn ?? ((t: string) => t))("\u00b7");
		case "failed":
			return (style?.errorFn ?? ((t: string) => t))("\u2717");
		default:
			return (style?.mutedFn ?? ((t: string) => t))("\u00b7");
	}
}

export function renderPlanOverlay(plan: MissionPlan, width = 80, style?: FrameStyle): string[] {
	const tf = style?.textFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const lines: string[] = [tf(plan.description), ""];

	for (const milestone of plan.milestones) {
		const mIcon = styledMilestoneIcon(milestone.status, style);
		lines.push(`${mIcon} ${tf(milestone.name)} ${mf(`[${milestone.status}]`)}`);

		for (const feature of milestone.features) {
			const fIcon = styledFeatureIcon(feature.status, style);
			const fName = styledFeatureName(feature.name, feature.status, style);
			const fixMark = feature.fixOrigin ? ` ${ICON_FIX}` : "";
			lines.push(`    ${fIcon} ${fName}${fixMark} ${mf(`[${feature.status}]`)}`);
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
