import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionPlan, MissionState } from "../types.js";
import { formatDuration } from "../utils.js";

export type StatusOverlayAction = { kind: "close" } | { kind: "noop" };

export function renderStatusOverlay(state: MissionState, plan: MissionPlan | null): string[] {
	const lines: string[] = ["Mission Status", ""];

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
	lines.push("Progress");
	lines.push(`  Completed: ${state.totalFeaturesCompleted}`);
	lines.push(`  Failed:    ${state.totalFeaturesFailed}`);
	lines.push(`  Skipped:   ${state.totalFeaturesSkipped}`);
	lines.push(`  Fix tasks: ${state.totalFixFeaturesCreated}`);

	if (state.status === "paused" && state.resumeTargetState) {
		lines.push("");
		lines.push(`Paused (will resume to: ${state.resumeTargetState})`);
	}

	lines.push("");
	lines.push("Esc: close");

	return lines;
}

export function handleStatusOverlayKey(key: string): StatusOverlayAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	return { kind: "noop" };
}

export class StatusOverlayComponent {
	constructor(
		private state: MissionState,
		private plan: MissionPlan | null,
		private done: () => void,
	) {}

	handleInput(data: string): void {
		const action = handleStatusOverlayKey(data);
		if (action.kind === "close") this.done();
	}

	render(width: number): string[] {
		return renderStatusOverlay(this.state, this.plan).map((l) => l.slice(0, width));
	}

	invalidate(): void {}
}
