import type { TUI } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import type { Feature, MissionPlan, MissionState, ProgressEvent } from "../types.js";

const ICON_DONE = "\u2713";
const ICON_ACTIVE = "\u25cf";
const ICON_PENDING = "\u25cb";
const ICON_FAILED = "\u2717";
const ICON_SKIPPED = "\u2013";
const ICON_FIX = "\u27a1";

export function formatRelativeTime(timestamp: string): string {
	const ms = Date.now() - new Date(timestamp).getTime();
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h`;
	if (minutes > 0) return `${minutes}m`;
	return `${seconds}s`;
}

function featureStatusIcon(feature: Feature): string {
	switch (feature.status) {
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

function findCurrentFeature(state: MissionState, plan: MissionPlan): Feature | undefined {
	if (!state.currentFeatureId) return undefined;
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.id === state.currentFeatureId) return feature;
		}
	}
	return undefined;
}

function findCurrentMilestone(state: MissionState, plan: MissionPlan) {
	if (!state.currentMilestoneId) return undefined;
	return plan.milestones.find((m) => m.id === state.currentMilestoneId);
}

function buildWarnings(state: MissionState): string[] {
	const warnings: string[] = [];
	if (state.gitSnapshot && !state.gitSnapshot.autoCommitEnabled) {
		warnings.push("Repo dirty: auto-commit off");
	}
	return warnings;
}

export function renderCurrentFeaturePanel(state: MissionState, plan: MissionPlan): string[] {
	const feature = findCurrentFeature(state, plan);
	const milestone = findCurrentMilestone(state, plan);

	if (!feature) {
		return ["Current Feature", "  (no feature active)"];
	}

	const lines: string[] = [];
	lines.push("Current Feature");
	lines.push(`  ${feature.name}`);

	if (milestone) {
		lines.push(`  Milestone: ${milestone.name}`);
	}

	const workerModel = plan.modelAssignment.worker;
	if (workerModel) {
		lines.push(`  Worker: ${workerModel}`);
	}

	const attemptCount = feature.attempts.length;
	const maxRetries = 3;
	lines.push(`  Attempt: ${attemptCount + 1}/${maxRetries}`);

	if (feature.acceptanceCriteria.length > 0) {
		lines.push("  Acceptance Criteria");
		for (const criterion of feature.acceptanceCriteria) {
			lines.push(`   \u2022 ${criterion}`);
		}
	}

	const warnings = buildWarnings(state);
	if (warnings.length > 0) {
		lines.push("  Warnings");
		for (const warning of warnings) {
			lines.push(`   \u2022 ${warning}`);
		}
	}

	return lines;
}

export function renderMissionOutline(plan: MissionPlan): string[] {
	const lines: string[] = ["Mission Outline"];

	for (const milestone of plan.milestones) {
		lines.push(`  ${milestone.name}`);

		for (const feature of milestone.features) {
			const icon = featureStatusIcon(feature);
			const fixMarker = feature.fixOrigin ? ` ${ICON_FIX}` : "";
			lines.push(`    ${icon} ${feature.name}${fixMarker}`);
		}
	}

	return lines;
}

function progressEventIcon(type: ProgressEvent["type"]): string {
	switch (type) {
		case "feature_complete":
		case "milestone_complete":
		case "validation_pass":
		case "mission_complete":
			return ICON_DONE;
		case "feature_failed":
		case "validation_fail":
		case "mission_failed":
			return ICON_FAILED;
		case "feature_start":
		case "worker_spawn":
			return ICON_ACTIVE;
		case "feature_skipped":
			return ICON_SKIPPED;
		default:
			return "\u00b7";
	}
}

export function renderProgressLog(state: MissionState): string[] {
	const lines: string[] = ["Progress Log"];

	if (state.progressLog.length === 0) {
		lines.push("  (no events yet)");
		return lines;
	}

	const events = [...state.progressLog].sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	for (const event of events) {
		const time = formatRelativeTime(event.timestamp);
		const icon = progressEventIcon(event.type);
		lines.push(`  ${time.padEnd(4)} ${icon} ${event.detail}`);
	}

	return lines;
}

export function renderKeyboardShortcuts(): string[] {
	return ["P: Pause  S: Skip  D: Done  R: Redirect", "M: Models  V: Validate  L: Logs  Esc: Close"];
}

const POLL_INTERVAL_MS = 2_000;

export interface MissionControlDeps {
	basePath: string;
	loadState: (basePath: string) => MissionState | null;
	loadPlan: (basePath: string) => MissionPlan | null;
}

export class MissionControlComponent {
	private state: MissionState | null;
	private plan: MissionPlan | null;
	private pollInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		private tui: TUI,
		private done: () => void,
		private deps: MissionControlDeps,
	) {
		this.state = deps.loadState(deps.basePath);
		this.plan = deps.loadPlan(deps.basePath);
		this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
	}

	private poll(): void {
		const nextState = this.deps.loadState(this.deps.basePath);
		const nextPlan = this.deps.loadPlan(this.deps.basePath);
		if (
			JSON.stringify(nextState) !== JSON.stringify(this.state) ||
			JSON.stringify(nextPlan) !== JSON.stringify(this.plan)
		) {
			this.state = nextState;
			this.plan = nextPlan;
			this.tui.requestRender();
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done();
		}
	}

	render(width: number): string[] {
		const state = this.state;
		const plan = this.plan;

		if (!state) {
			return [" No active mission.", " Press Esc to close."];
		}

		const leftWidth = Math.floor(width / 2) - 1;
		const rightWidth = width - leftWidth - 1;

		const leftLines = plan ? renderCurrentFeaturePanel(state, plan) : ["Current Feature", "  (no plan loaded)"];
		const rightOutline = plan ? renderMissionOutline(plan) : ["Mission Outline", "  (no plan loaded)"];
		const rightLog = renderProgressLog(state);
		const rightLines = [...rightOutline, "", ...rightLog];

		const maxRows = Math.max(leftLines.length, rightLines.length);
		const output: string[] = [];

		for (let i = 0; i < maxRows; i++) {
			const left = (leftLines[i] ?? "").slice(0, leftWidth).padEnd(leftWidth);
			const right = (rightLines[i] ?? "").slice(0, rightWidth);
			output.push(`${left} ${right}`);
		}

		output.push("");
		for (const line of renderKeyboardShortcuts()) {
			output.push(line);
		}

		return output;
	}

	invalidate(): void {}

	dispose(): void {
		if (this.pollInterval !== null) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}
}
