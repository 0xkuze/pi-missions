import type { Component, Focusable, TUI } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionPlan } from "../types.js";
import type { FrameStyle } from "./frame.js";
import { footerBar, panel, styledFeatureIcon, styledFeatureName, themeFrameStyle, titleBar } from "./frame.js";

export type PlanOverlayAction = { kind: "close" } | { kind: "scroll"; delta: number } | { kind: "noop" };

const ICON_FIX = "\u27a1";
const PAGE_SIZE = 10;

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

export function renderPlanOverlay(
	plan: MissionPlan,
	width: number,
	height: number,
	scrollOffset: number,
	style?: FrameStyle,
): string[] {
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

	const panelHeight = Math.max(5, height - 4);
	return [
		titleBar("Mission Plan", width, style),
		...panel("Plan", lines, width, panelHeight, scrollOffset, style),
		...footerBar("Esc: close  ↑↓: scroll  PgUp/PgDn: page", width, style),
	];
}

export function handlePlanOverlayKey(key: string): PlanOverlayAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	if (matchesKey(key, "up")) return { kind: "scroll", delta: -1 };
	if (matchesKey(key, "down")) return { kind: "scroll", delta: 1 };
	if (matchesKey(key, "pageUp")) return { kind: "scroll", delta: -PAGE_SIZE };
	if (matchesKey(key, "pageDown")) return { kind: "scroll", delta: PAGE_SIZE };
	return { kind: "noop" };
}

export class PlanOverlayComponent implements Component, Focusable {
	focused = false;
	private style: FrameStyle | undefined;
	private scrollOffset = 0;
	private theme:
		| { fg: (...args: any[]) => string; bg: (...args: any[]) => string; bold: (text: string) => string }
		| undefined;
	private cachedWidth = 0;
	private cachedLines: string[] = [];
	private version = 0;
	private cachedVersion = -1;

	constructor(
		private tui: TUI,
		private done: () => void,
		private plan: MissionPlan,
		theme?: { fg: (...args: any[]) => string; bg: (...args: any[]) => string; bold: (text: string) => string },
	) {
		this.theme = theme;
		this.style = theme ? themeFrameStyle(theme) : undefined;
	}

	handleInput(data: string): void {
		const action = handlePlanOverlayKey(data);
		if (action.kind === "close") this.done();
		if (action.kind === "scroll") {
			this.scrollOffset = Math.max(0, this.scrollOffset + action.delta);
			this.version++;
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		if (width === this.cachedWidth && this.version === this.cachedVersion) return this.cachedLines;
		const height = this.tui.terminal.rows - 5;
		const result = renderPlanOverlay(this.plan, width, height, this.scrollOffset, this.style);
		this.cachedWidth = width;
		this.cachedLines = result;
		this.cachedVersion = this.version;
		return result;
	}

	invalidate(): void {
		this.cachedVersion = -1;
		if (this.theme) {
			this.style = themeFrameStyle(this.theme);
		}
	}

	dispose(): void {}
}
