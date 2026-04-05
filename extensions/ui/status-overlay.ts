import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionPlan, MissionState } from "../types.js";
import { formatDuration } from "../utils.js";
import type { FrameStyle } from "./frame.js";
import { frame, section } from "./frame.js";

export type StatusOverlayAction = { kind: "close" } | { kind: "noop" };

export function renderStatusOverlay(
	state: MissionState,
	plan: MissionPlan | null,
	width = 80,
	style?: FrameStyle,
): string[] {
	const contentWidth = width - 4;
	const lines: string[] = [];

	lines.push(`State: ${state.status}`);

	const durationMs = Date.now() - new Date(state.startedAt).getTime();
	lines.push(`Duration: ${formatDuration(durationMs)}`);

	if (state.currentMilestoneId && plan) {
		const milestone = plan.milestones.find((m) => m.id === state.currentMilestoneId);
		if (milestone) {
			lines.push(`Milestone: ${milestone.name}`);
		}
	}

	if (state.currentFeatureId && plan) {
		const feature = plan.milestones.flatMap((m) => m.features).find((f) => f.id === state.currentFeatureId);
		if (feature) {
			lines.push(`Feature: ${feature.name}`);
		}
	}

	lines.push("");
	lines.push(section("Progress", contentWidth, style));
	lines.push(`Completed: ${state.totalFeaturesCompleted}`);
	lines.push(`Failed:    ${state.totalFeaturesFailed}`);
	lines.push(`Skipped:   ${state.totalFeaturesSkipped}`);
	lines.push(`Fix tasks: ${state.totalFixFeaturesCreated}`);

	if (state.status === "paused" && state.resumeTargetState) {
		lines.push("");
		lines.push(`Paused (will resume to: ${state.resumeTargetState})`);
	}

	return frame("Mission Status", lines, width, "Esc: close", style);
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
