import type { TUI } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionPlan, MissionState } from "../types.js";
import { formatDuration } from "../utils.js";
import type { FrameStyle } from "./frame.js";
import { footerBar, panel, section, themeFrameStyle, titleBar } from "./frame.js";

export type StatusOverlayAction = { kind: "close" } | { kind: "scroll"; delta: number } | { kind: "noop" };

const PAGE_SIZE = 10;

function styledStatusName(status: string, style?: FrameStyle): string {
	switch (status) {
		case "executing":
			return (style?.successFn ?? ((t: string) => t))(status);
		case "paused":
			return (style?.warningFn ?? ((t: string) => t))(status);
		case "validating":
			return (style?.accentFn ?? ((t: string) => t))(status);
		case "completed":
			return (style?.successFn ?? ((t: string) => t))(status);
		case "failed":
			return (style?.errorFn ?? ((t: string) => t))(status);
		default:
			return (style?.mutedFn ?? ((t: string) => t))(status);
	}
}

export function renderStatusOverlay(
	state: MissionState,
	plan: MissionPlan | null,
	width: number,
	height: number,
	scrollOffset: number,
	style?: FrameStyle,
): string[] {
	const contentWidth = width - 4;
	const mf = style?.mutedFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);
	const lines: string[] = [];

	lines.push(`${mf("State:")} ${styledStatusName(state.status, style)}`);

	const durationMs = Date.now() - new Date(state.startedAt).getTime();
	lines.push(`${mf("Duration:")} ${tf(formatDuration(durationMs))}`);

	if (state.currentMilestoneId && plan) {
		const milestone = plan.milestones.find((m) => m.id === state.currentMilestoneId);
		if (milestone) {
			lines.push(`${mf("Milestone:")} ${tf(milestone.name)}`);
		}
	}

	if (state.currentFeatureId && plan) {
		const feature = plan.milestones.flatMap((m) => m.features).find((f) => f.id === state.currentFeatureId);
		if (feature) {
			lines.push(`${mf("Feature:")} ${tf(feature.name)}`);
		}
	}

	lines.push("");
	lines.push(section("Progress", contentWidth, style));
	lines.push(`${mf("Completed:")} ${tf(`${state.totalFeaturesCompleted}`)}`);
	lines.push(`${mf("Failed:")}    ${tf(`${state.totalFeaturesFailed}`)}`);
	lines.push(`${mf("Skipped:")}   ${tf(`${state.totalFeaturesSkipped}`)}`);
	lines.push(`${mf("Fix tasks:")} ${tf(`${state.totalFixFeaturesCreated}`)}`);

	if (state.status === "paused" && state.resumeTargetState) {
		lines.push("");
		lines.push(mf(`Paused (will resume to: ${state.resumeTargetState})`));
	}

	const panelHeight = Math.max(5, height - 7);
	return [
		titleBar("Mission Status", width, style),
		...panel("Status", lines, width, panelHeight, scrollOffset, style),
		...footerBar("Esc: close  ↑↓: scroll  PgUp/PgDn: page", width, style),
	];
}

export function handleStatusOverlayKey(key: string): StatusOverlayAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	if (matchesKey(key, "up")) return { kind: "scroll", delta: -1 };
	if (matchesKey(key, "down")) return { kind: "scroll", delta: 1 };
	if (matchesKey(key, "pageUp")) return { kind: "scroll", delta: -PAGE_SIZE };
	if (matchesKey(key, "pageDown")) return { kind: "scroll", delta: PAGE_SIZE };
	return { kind: "noop" };
}

export class StatusOverlayComponent {
	private style: FrameStyle | undefined;
	private scrollOffset = 0;

	constructor(
		private tui: TUI,
		private done: () => void,
		private state: MissionState,
		private plan: MissionPlan | null,
		theme?: { fg: (...args: any[]) => string; bg: (...args: any[]) => string; bold: (text: string) => string },
	) {
		this.style = theme ? themeFrameStyle(theme) : undefined;
	}

	handleInput(data: string): void {
		const action = handleStatusOverlayKey(data);
		if (action.kind === "close") this.done();
		if (action.kind === "scroll") {
			this.scrollOffset = Math.max(0, this.scrollOffset + action.delta);
		}
	}

	render(width: number): string[] {
		const height = this.tui.terminal.rows - 5;
		return renderStatusOverlay(this.state, this.plan, width, height, this.scrollOffset, this.style);
	}

	invalidate(): void {}

	dispose(): void {}
}
