import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionPlan, MissionState } from "../types.js";
import { formatDuration } from "../utils.js";
import type { FrameStyle } from "./frame.js";
import { footerBar, panel, section, titleBar } from "./frame.js";

export type StatusOverlayAction = { kind: "close" } | { kind: "noop" };

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
	width = 80,
	style?: FrameStyle,
	height = 40,
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
		...panel("Status", lines, width, panelHeight, 0, style),
		...footerBar("Esc: close", width, style),
	];
}

export function handleStatusOverlayKey(key: string): StatusOverlayAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}

export class StatusOverlayComponent {
	private style: FrameStyle | undefined;

	constructor(
		private state: MissionState,
		private plan: MissionPlan | null,
		private done: () => void,
		style?: FrameStyle,
	) {
		this.style = style;
	}

	handleInput(data: string): void {
		const action = handleStatusOverlayKey(data);
		if (action.kind === "close") this.done();
	}

	render(width: number): string[] {
		return renderStatusOverlay(this.state, this.plan, width, this.style);
	}

	invalidate(): void {}
}
