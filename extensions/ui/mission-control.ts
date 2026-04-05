import type { TUI } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import { savePlan, saveState } from "../state/manager.js";
import { transitionState } from "../state/transitions.js";
import type { Feature, MissionConfig, MissionPlan, MissionState, ProgressEvent } from "../types.js";
import { nowISO } from "../utils.js";
import { handleBlockedViewKey, type LastFailureDetails, renderBlockedView } from "./blocked-view.js";
import { handleDraftReviewKey, renderDraftReview } from "./draft-review.js";
import { handleProgressLogKey, renderProgressLog as renderProgressLogStandalone } from "./progress-log.js";
import {
	handleModelViewKey,
	handleReportViewKey,
	type ModelViewState,
	renderModelView,
	renderReportView,
} from "./report-view.js";
import { type CommandDisplayEntry, handleValidationViewKey, renderValidationView } from "./validation-view.js";

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

export type OverlayAction =
	| { kind: "close" }
	| { kind: "pause" }
	| { kind: "resume" }
	| { kind: "skip" }
	| { kind: "done" }
	| { kind: "redirect" }
	| { kind: "open_model_view" }
	| { kind: "open_validation_view" }
	| { kind: "open_logs_view" }
	| { kind: "warn"; message: string }
	| { kind: "noop" };

const PAUSABLE_STATUSES = new Set(["planning", "draft_review", "approved", "executing", "validating"]);
const ACTIVE_STATUSES = new Set(["planning", "draft_review", "approved", "executing", "validating", "paused"]);

export function handleKeyboardAction(key: string, state: MissionState | null): OverlayAction {
	if (matchesKey(key, "escape")) return { kind: "close" };

	const upper = key.toUpperCase();

	if (upper === "P") {
		if (!state || !ACTIVE_STATUSES.has(state.status)) {
			return { kind: "warn", message: "P: No active mission to pause or resume." };
		}
		if (state.status === "paused") return { kind: "resume" };
		if (PAUSABLE_STATUSES.has(state.status)) return { kind: "pause" };
		return { kind: "warn", message: `P: Cannot pause from '${state.status}' state.` };
	}

	if (upper === "S") {
		if (!state || state.status !== "executing") {
			return { kind: "warn", message: "S: Skip is only available while executing." };
		}
		if (!state.currentFeatureId) {
			return { kind: "warn", message: "S: No current feature to skip." };
		}
		return { kind: "skip" };
	}

	if (upper === "D") {
		if (!state || !ACTIVE_STATUSES.has(state.status)) {
			return { kind: "warn", message: "D: No active mission." };
		}
		return { kind: "done" };
	}

	if (upper === "R") {
		if (!state || !ACTIVE_STATUSES.has(state.status)) {
			return { kind: "warn", message: "R: No active mission to redirect." };
		}
		return { kind: "redirect" };
	}

	if (upper === "M") {
		if (!state || !ACTIVE_STATUSES.has(state.status)) {
			return { kind: "warn", message: "M: No active mission." };
		}
		return { kind: "open_model_view" };
	}

	if (upper === "V") {
		if (!state || !ACTIVE_STATUSES.has(state.status)) {
			return { kind: "warn", message: "V: No active mission." };
		}
		return { kind: "open_validation_view" };
	}

	if (upper === "L") {
		if (!state || !ACTIVE_STATUSES.has(state.status)) {
			return { kind: "warn", message: "L: No active mission." };
		}
		return { kind: "open_logs_view" };
	}

	return { kind: "noop" };
}

const POLL_INTERVAL_MS = 2_000;

export type SubView =
	| { kind: "model" }
	| { kind: "validation" }
	| { kind: "logs" }
	| { kind: "draft_review" }
	| { kind: "blocked"; featureId: string }
	| { kind: "report" };

export function resolveStateView(state: MissionState, plan: MissionPlan | null): SubView | null {
	if (state.status === "completed") return { kind: "report" };
	if (state.status === "draft_review") return { kind: "draft_review" };

	if (state.currentFeatureId && plan) {
		for (const milestone of plan.milestones) {
			for (const feature of milestone.features) {
				if (
					feature.id === state.currentFeatureId &&
					(feature.status === "failed" || feature.status === "blocked")
				) {
					return { kind: "blocked", featureId: feature.id };
				}
			}
		}
	}

	return null;
}

export interface MissionControlDeps {
	basePath: string;
	loadState: (basePath: string) => MissionState | null;
	loadPlan: (basePath: string) => MissionPlan | null;
	loadConfig: (basePath: string) => MissionConfig;
	sendUserMessage: (content: string) => void;
	getInput: (title: string, placeholder?: string) => Promise<string | undefined>;
	notify: (message: string, type?: "info" | "warning" | "error") => void;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
	availableModels: string[];
	openFile: (path: string) => void;
}

export class MissionControlComponent {
	private state: MissionState | null;
	private plan: MissionPlan | null;
	private config: MissionConfig;
	private currentSubView: SubView | null = null;
	private modelViewState: ModelViewState = { selectedRoleIndex: null };
	private pollInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		private tui: TUI,
		private done: () => void,
		private deps: MissionControlDeps,
	) {
		this.state = deps.loadState(deps.basePath);
		this.plan = deps.loadPlan(deps.basePath);
		this.config = deps.loadConfig(deps.basePath);
		this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
	}

	private poll(): void {
		const nextState = this.deps.loadState(this.deps.basePath);
		const nextPlan = this.deps.loadPlan(this.deps.basePath);
		let nextConfig: MissionConfig;
		try {
			nextConfig = this.deps.loadConfig(this.deps.basePath);
		} catch {
			nextConfig = this.config;
		}
		if (
			JSON.stringify(nextState) !== JSON.stringify(this.state) ||
			JSON.stringify(nextPlan) !== JSON.stringify(this.plan) ||
			JSON.stringify(nextConfig) !== JSON.stringify(this.config)
		) {
			this.state = nextState;
			this.plan = nextPlan;
			this.config = nextConfig;
			this.tui.requestRender();
		}
	}

	handleInput(data: string): void {
		const activeView = this.resolveActiveView();
		if (activeView !== null) {
			this.handleSubViewInput(data, activeView);
			return;
		}
		const action = handleKeyboardAction(data, this.state);
		this.dispatchAction(action);
	}

	private handleSubViewInput(data: string, subView: SubView): void {
		switch (subView.kind) {
			case "model": {
				const result = handleModelViewKey(data, this.modelViewState, this.deps.availableModels);
				this.modelViewState = result.nextViewState;
				if (result.action.kind === "close") {
					this.currentSubView = null;
				}
				this.tui.requestRender();
				return;
			}
			case "validation": {
				const action = handleValidationViewKey(data);
				if (action.kind === "close") {
					this.currentSubView = null;
					this.tui.requestRender();
				}
				return;
			}
			case "logs": {
				const action = handleProgressLogKey(data);
				if (action.kind === "close") {
					this.currentSubView = null;
					this.tui.requestRender();
				}
				return;
			}
			case "draft_review": {
				const action = handleDraftReviewKey(data);
				if (action.kind === "approve") {
					this.deps.sendUserMessage("I approve the plan. Please proceed with execution.");
					this.currentSubView = null;
					this.done();
				} else if (action.kind === "close") {
					this.currentSubView = null;
					this.done();
				}
				this.tui.requestRender();
				return;
			}
			case "blocked": {
				const action = handleBlockedViewKey(data);
				if (action.kind === "close") {
					this.done();
				} else if (action.kind === "retry") {
					this.deps.sendUserMessage(
						`Please retry the blocked feature '${subView.featureId}' with additional guidance.`,
					);
					this.done();
				} else if (action.kind === "skip") {
					this.applySkip();
				}
				return;
			}
			case "report": {
				const action = handleReportViewKey(data);
				if (action.kind === "close") {
					this.done();
				} else if (action.kind === "open_report") {
					this.deps.openFile(`${this.deps.basePath}/report.md`);
				}
				return;
			}
		}
	}

	private dispatchAction(action: OverlayAction): void {
		switch (action.kind) {
			case "close":
				this.done();
				return;
			case "warn":
				this.deps.notify(action.message, "warning");
				return;
			case "noop":
				return;
			case "pause":
				this.applyPause();
				return;
			case "resume":
				this.applyResume();
				return;
			case "skip":
				this.applySkip();
				return;
			case "done":
				this.deps.sendUserMessage("Please call complete_mission to finalize the mission and generate the report.");
				this.done();
				return;
			case "redirect":
				this.applyRedirect();
				return;
			case "open_model_view":
				this.modelViewState = { selectedRoleIndex: null };
				this.currentSubView = { kind: "model" };
				this.tui.requestRender();
				return;
			case "open_validation_view":
				this.currentSubView = { kind: "validation" };
				this.tui.requestRender();
				return;
			case "open_logs_view":
				this.currentSubView = { kind: "logs" };
				this.tui.requestRender();
				return;
		}
	}

	private applyPause(): void {
		const state = this.deps.loadState(this.deps.basePath);
		if (!state) return;
		try {
			const newState = transitionState(state, "paused");
			saveState(this.deps.basePath, newState);
			const plan = this.deps.loadPlan(this.deps.basePath);
			this.state = newState;
			this.plan = plan;
			this.deps.updateWidget(newState, plan ?? undefined);
			this.tui.requestRender();
			this.deps.notify("Mission paused.", "info");
		} catch (err) {
			this.deps.notify(`Error: ${(err as Error).message}`, "error");
		}
	}

	private applyResume(): void {
		const state = this.deps.loadState(this.deps.basePath);
		if (!state || state.status !== "paused") return;
		const target = state.resumeTargetState;
		if (!target) {
			this.deps.notify("Error: paused state has no resumeTargetState.", "error");
			return;
		}
		try {
			const newState = transitionState(state, target);
			saveState(this.deps.basePath, newState);
			const plan = this.deps.loadPlan(this.deps.basePath);
			this.state = newState;
			this.plan = plan;
			this.deps.updateWidget(newState, plan ?? undefined);
			this.tui.requestRender();
			this.deps.sendUserMessage("Mission resumed. Please continue from where you left off.");
		} catch (err) {
			this.deps.notify(`Error: ${(err as Error).message}`, "error");
		}
	}

	private applySkip(): void {
		const state = this.deps.loadState(this.deps.basePath);
		if (!state || state.status !== "executing" || !state.currentFeatureId) return;

		const plan = this.deps.loadPlan(this.deps.basePath);
		if (!plan) {
			this.deps.notify("Error: no plan found.", "error");
			return;
		}

		const featureId = state.currentFeatureId;
		let featureName = featureId;
		const updatedPlan: MissionPlan = {
			...plan,
			milestones: plan.milestones.map((m) => ({
				...m,
				features: m.features.map((f) => {
					if (f.id === featureId) {
						featureName = f.name;
						return { ...f, status: "skipped" as const };
					}
					return f;
				}),
			})),
		};
		savePlan(this.deps.basePath, updatedPlan);

		const updatedState: MissionState = {
			...state,
			currentFeatureId: undefined,
			totalFeaturesSkipped: state.totalFeaturesSkipped + 1,
			progressLog: [
				...state.progressLog,
				{
					timestamp: nowISO(),
					type: "feature_skipped" as const,
					detail: `Feature '${featureName}' skipped by user`,
				},
			],
		};
		saveState(this.deps.basePath, updatedState);
		this.state = updatedState;
		this.plan = updatedPlan;
		this.deps.updateWidget(updatedState, updatedPlan);
		this.tui.requestRender();
		this.deps.sendUserMessage(`Feature '${featureName}' has been skipped. Please continue with the next feature.`);
	}

	private applyRedirect(): void {
		this.deps.getInput("Redirect Mission", "Enter new instruction for the orchestrator...").then((message) => {
			if (!message?.trim()) return;

			const state = this.deps.loadState(this.deps.basePath);
			if (state) {
				const updatedState: MissionState = {
					...state,
					progressLog: [
						...state.progressLog,
						{
							timestamp: nowISO(),
							type: "redirect" as const,
							detail: `User redirect: ${message.slice(0, 80)}`,
						},
					],
				};
				saveState(this.deps.basePath, updatedState);
				this.state = updatedState;
				this.deps.updateWidget(updatedState, this.plan ?? undefined);
			}

			this.deps.sendUserMessage(message);
			this.done();
		});
	}

	private resolveActiveView(): SubView | null {
		if (this.currentSubView !== null) return this.currentSubView;
		if (!this.state) return null;
		return resolveStateView(this.state, this.plan);
	}

	render(width: number): string[] {
		const state = this.state;
		const plan = this.plan;

		if (!state) {
			return [" No active mission.", " Press Esc to close."];
		}

		const activeView = this.resolveActiveView();
		if (activeView !== null) {
			return this.renderSubView(activeView, state, plan, width);
		}

		return this.renderMainOverlay(state, plan, width);
	}

	private renderSubView(view: SubView, state: MissionState, plan: MissionPlan | null, _width: number): string[] {
		switch (view.kind) {
			case "model": {
				const effectivePlan = plan ?? {
					id: "",
					description: "",
					planVersion: 0,
					milestones: [],
					validationCommands: [],
					modelAssignment: {},
					createdAt: "",
				};
				return renderModelView(this.config, effectivePlan, this.modelViewState);
			}
			case "validation": {
				const milestone = plan?.milestones.find((m) => m.id === state.currentMilestoneId);
				const milestoneName = milestone?.name ?? "Current Milestone";
				const commands: CommandDisplayEntry[] = (milestone?.validationCommands ?? []).map((cmd) => ({
					label: cmd,
					status: "pending" as const,
				}));
				return renderValidationView(milestoneName, commands, false);
			}
			case "logs":
				return renderProgressLogStandalone(state.progressLog);
			case "draft_review":
				if (!plan) return ["No plan to review.", "", "Esc: close"];
				return renderDraftReview(plan);
			case "blocked": {
				const feature = plan?.milestones.flatMap((m) => m.features).find((f) => f.id === view.featureId);
				if (!feature) return ["Feature not found.", "", "Esc: close"];
				const lastAttempt = feature.attempts[feature.attempts.length - 1];
				const lastFailure: LastFailureDetails | undefined = lastAttempt
					? { errorMessage: `Exit code: ${lastAttempt.exitCode ?? "unknown"}` }
					: undefined;
				return renderBlockedView(feature, 3, lastFailure);
			}
			case "report":
				if (!plan) return ["No report available.", "", "Esc: close"];
				return renderReportView(state, plan, this.deps.basePath);
		}
	}

	private renderMainOverlay(state: MissionState, plan: MissionPlan | null, width: number): string[] {
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
