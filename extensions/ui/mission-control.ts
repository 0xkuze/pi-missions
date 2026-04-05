import type { TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { saveConfig, savePlan, saveState } from "../state/manager.js";
import { appendMutation, readHistory } from "../state/plan-history.js";
import { transitionState } from "../state/transitions.js";
import type { Feature, MissionConfig, MissionPlan, MissionState, PlanMutation, ProgressEvent } from "../types.js";
import { nowISO } from "../utils.js";
import { handleBlockedViewKey, type LastFailureDetails, renderBlockedView } from "./blocked-view.js";
import { handleDraftReviewKey, renderDraftReview } from "./draft-review.js";
import type { FrameStyle } from "./frame.js";
import {
	frame,
	section,
	sectionWithCount,
	styledFeatureIcon,
	styledFeatureName,
	themeFrameStyle,
	wrapText,
} from "./frame.js";
import { handlePlanHistoryKey, renderPlanHistoryView } from "./plan-history.js";
import { handlePlanningSetupKey, renderPlanningSetupView } from "./planning-setup.js";
import { handleProgressLogKey, renderProgressLog as renderProgressLogStandalone } from "./progress-log.js";
import {
	handleModelViewKey,
	handleReportViewKey,
	type ModelViewState,
	renderModelView,
	renderReportView,
} from "./report-view.js";
import { type CommandDisplayEntry, handleValidationViewKey, renderValidationView } from "./validation-view.js";

const ICON_FIX = "\u27a1";

const PROGRESS_BAR_DONE = "\u2588";
const PROGRESS_BAR_ACTIVE = "\u2593";
const PROGRESS_BAR_PENDING = "\u2591";
const MAX_LOG_ENTRIES = 13;

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatRelativeTime(timestamp: string): string {
	const ms = Date.now() - new Date(timestamp).getTime();
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h`;
	if (minutes > 0) return `${minutes}m`;
	return `${seconds}s`;
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

export function renderCurrentFeaturePanel(
	state: MissionState,
	plan: MissionPlan,
	width = 40,
	style?: FrameStyle,
): string[] {
	const contentWidth = width - 4;
	const feature = findCurrentFeature(state, plan);
	const milestone = findCurrentMilestone(state, plan);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const wf = style?.warningFn ?? ((t: string) => t);

	if (!feature) {
		return frame("Current Feature", [mf("No Active Feature")], width, undefined, style);
	}

	const lines: string[] = [];
	lines.push(bf(tf(feature.name)));

	if (milestone) {
		lines.push(`${mf("Milestone:")} ${tf(milestone.name)}`);
	}

	const workerModel = plan.modelAssignment.worker;
	if (workerModel) {
		lines.push(`${mf("Worker:")} ${tf(workerModel)}`);
	}

	const attemptCount = feature.attempts.length;
	const maxRetries = 3;
	lines.push(`${mf("Attempt:")} ${tf(`${attemptCount + 1}/${maxRetries}`)}`);

	if (feature.acceptanceCriteria.length > 0) {
		lines.push(section("Acceptance Criteria", contentWidth, style));
		for (const criterion of feature.acceptanceCriteria) {
			lines.push(`\u2022 ${tf(criterion)}`);
		}
	}

	const warnings = buildWarnings(state);
	if (warnings.length > 0) {
		lines.push(section("Warnings", contentWidth, style));
		for (const warning of warnings) {
			lines.push(`\u2022 ${wf(warning)}`);
		}
	}

	return frame("Current Feature", lines, width, undefined, style);
}

export function renderMissionOutline(plan: MissionPlan, width = 40, style?: FrameStyle): string[] {
	const lines: string[] = [];
	const tf = style?.textFn ?? ((t: string) => t);

	for (const milestone of plan.milestones) {
		lines.push(tf(milestone.name));

		for (const feature of milestone.features) {
			const icon = styledFeatureIcon(feature.status, style);
			const name = styledFeatureName(feature.name, feature.status, style);
			const fixMarker = feature.fixOrigin ? ` ${ICON_FIX}` : "";
			lines.push(`  ${icon} ${name}${fixMarker}`);
		}
	}

	return frame("Mission Outline", lines, width, undefined, style);
}

function renderFeaturePanelContent(
	state: MissionState,
	plan: MissionPlan,
	contentWidth: number,
	style?: FrameStyle,
): string[] {
	const feature = findCurrentFeature(state, plan);
	const milestone = findCurrentMilestone(state, plan);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const wf = style?.warningFn ?? ((t: string) => t);
	const lines: string[] = [];

	lines.push(section("Current Feature", contentWidth, style));

	if (!feature) {
		if (state.status === "executing" || state.status === "validating") {
			const nextPending = plan.milestones.flatMap((m) => m.features).find((f) => f.status === "pending");
			if (nextPending) {
				lines.push(mf("Waiting to start:"));
				lines.push(bf(tf(nextPending.name)));
				if (milestone) lines.push(`${mf("Milestone:")} ${tf(milestone.name)}`);
			} else {
				lines.push(mf("All features dispatched"));
			}
		} else {
			lines.push(mf("No Active Feature"));
		}
		return lines;
	}

	lines.push(bf(tf(feature.name)));

	if (milestone) {
		lines.push(`${mf("Milestone:")} ${tf(milestone.name)}`);
	}

	const workerModel = plan.modelAssignment.worker;
	if (workerModel) {
		lines.push(`${mf("Worker:")} ${tf(workerModel)}`);
	}

	const attemptCount = feature.attempts.length;
	const maxRetries = 3;
	lines.push(`${mf("Attempt:")} ${tf(`${attemptCount + 1}/${maxRetries}`)}`);

	if (feature.acceptanceCriteria.length > 0) {
		lines.push(section("Acceptance Criteria", contentWidth, style));
		for (const criterion of feature.acceptanceCriteria) {
			lines.push(`\u2022 ${tf(criterion)}`);
		}
	}

	const warnings = buildWarnings(state);
	if (warnings.length > 0) {
		lines.push(section("Warnings", contentWidth, style));
		for (const warning of warnings) {
			lines.push(`\u2022 ${wf(warning)}`);
		}
	}

	return lines;
}

function countFeatureStats(plan: MissionPlan): { done: number; total: number } {
	let done = 0;
	let total = 0;
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			total++;
			if (feature.status === "done" || feature.status === "skipped") done++;
		}
	}
	return { done, total };
}

function renderOutlinePanelContent(plan: MissionPlan, contentWidth: number, style?: FrameStyle): string[] {
	const lines: string[] = [];
	const { done, total } = countFeatureStats(plan);
	const tf = style?.textFn ?? ((t: string) => t);

	lines.push(sectionWithCount("Features", `${done}/${total}`, contentWidth, style));

	for (const milestone of plan.milestones) {
		lines.push(tf(milestone.name));
		for (const feature of milestone.features) {
			const icon = styledFeatureIcon(feature.status, style);
			const fixMarker = feature.fixOrigin ? ` ${ICON_FIX}` : "";
			const prefix = `  ${icon} `;
			const prefixWidth = visibleWidth(prefix);
			const availableWidth = contentWidth - prefixWidth;
			const rawName = `${feature.name}${fixMarker}`;
			const wrappedRaw = wrapText(rawName, availableWidth);
			lines.push(`${prefix}${styledFeatureName(wrappedRaw[0], feature.status, style)}`);
			for (let i = 1; i < wrappedRaw.length; i++) {
				lines.push(" ".repeat(prefixWidth) + styledFeatureName(wrappedRaw[i], feature.status, style));
			}
		}
	}

	return lines;
}

function styledProgressEventIcon(type: ProgressEvent["type"], style?: FrameStyle): string {
	switch (type) {
		case "feature_complete":
		case "milestone_complete":
		case "validation_pass":
		case "mission_complete":
			return (style?.successFn ?? ((t: string) => t))("\u2713");
		case "feature_failed":
		case "validation_fail":
		case "mission_failed":
			return (style?.errorFn ?? ((t: string) => t))("\u2717");
		case "feature_start":
		case "worker_spawn":
			return (style?.accentFn ?? ((t: string) => t))("\u25cf");
		case "feature_skipped":
			return (style?.mutedFn ?? ((t: string) => t))("\u2013");
		default:
			return (style?.mutedFn ?? ((t: string) => t))("\u00b7");
	}
}

function renderLogPanelContent(state: MissionState, contentWidth: number, style?: FrameStyle): string[] {
	const lines: string[] = [];
	const mf = style?.mutedFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);

	if (state.progressLog.length === 0) {
		lines.push(sectionWithCount("Progress Log", "0", contentWidth, style));
		lines.push(mf("(no events yet)"));
		return lines;
	}

	const events = [...state.progressLog].sort(
		(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
	);

	const totalCount = events.length;
	const displayed = events.slice(0, MAX_LOG_ENTRIES);
	const pageLabel = totalCount <= MAX_LOG_ENTRIES ? `${totalCount}` : `1-${displayed.length} of ${totalCount}`;

	lines.push(sectionWithCount("Progress Log", pageLabel, contentWidth, style));

	for (const event of displayed) {
		const time = formatRelativeTime(event.timestamp);
		const icon = styledProgressEventIcon(event.type, style);
		const prefix = `${mf(time.padEnd(4))} ${icon} `;
		const prefixWidth = visibleWidth(prefix);
		const availableWidth = contentWidth - prefixWidth;
		const wrappedRaw = wrapText(event.detail, availableWidth);
		lines.push(`${prefix}${tf(wrappedRaw[0])}`);
		for (let i = 1; i < wrappedRaw.length; i++) {
			lines.push(" ".repeat(prefixWidth) + tf(wrappedRaw[i]));
		}
	}

	return lines;
}

export function renderProgressLog(state: MissionState, width = 40, style?: FrameStyle): string[] {
	const mf = style?.mutedFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);

	if (state.progressLog.length === 0) {
		return frame("Progress Log", [mf("(no events yet)")], width, undefined, style);
	}

	const events = [...state.progressLog].sort(
		(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
	);
	const lines: string[] = [];

	for (const event of events) {
		const time = formatRelativeTime(event.timestamp);
		const icon = styledProgressEventIcon(event.type, style);
		lines.push(`${mf(time.padEnd(4))} ${icon} ${tf(event.detail)}`);
	}

	return frame("Progress Log", lines, width, undefined, style);
}

export function renderKeyboardShortcuts(width = 80): string[] {
	const sep = "\u2500";
	return [
		sep.repeat(width),
		"P: Pause  S: Skip  D: Done  R: Redirect",
		"M: Models  V: Validate  L: Logs  H: History  Esc: Close",
	];
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
	| { kind: "open_history_view" }
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

	if (upper === "H") {
		if (!state || !ACTIVE_STATUSES.has(state.status)) {
			return { kind: "warn", message: "H: No active mission." };
		}
		return { kind: "open_history_view" };
	}

	return { kind: "noop" };
}

const ROLE_NAMES_ORDERED = ["orchestrator", "worker", "validator"] as const;

export function applyModelChangeToConfig(config: MissionConfig, roleIndex: number, model: string): MissionConfig {
	const role = ROLE_NAMES_ORDERED[roleIndex];
	if (!role) return config;
	return {
		...config,
		models: {
			...config.models,
			[role]: model,
		},
	};
}

const POLL_INTERVAL_MS = 2_000;

export type SubView =
	| { kind: "model" }
	| { kind: "validation" }
	| { kind: "logs" }
	| { kind: "history" }
	| { kind: "planning" }
	| { kind: "draft_review" }
	| { kind: "blocked"; featureId: string }
	| { kind: "report" };

export function resolveStateView(state: MissionState, plan: MissionPlan | null): SubView | null {
	if (state.status === "completed") return { kind: "report" };
	if (state.status === "draft_review") return { kind: "draft_review" };
	if (state.status === "planning") return { kind: "planning" };

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
	setModel: (modelId: string) => Promise<void>;
}

export class MissionControlComponent {
	private state: MissionState | null;
	private plan: MissionPlan | null;
	private config: MissionConfig;
	private planHistory: PlanMutation[];
	private currentSubView: SubView | null = null;
	private modelViewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
	private pollInterval: ReturnType<typeof setInterval> | null = null;
	private style: FrameStyle | undefined;

	constructor(
		private tui: TUI,
		private done: () => void,
		private deps: MissionControlDeps,
		// why: pi Theme uses branded union types for color parameters; we accept `any` at this boundary
		theme?: { fg: (...args: any[]) => string; bg: (...args: any[]) => string; bold: (text: string) => string },
	) {
		this.state = deps.loadState(deps.basePath);
		this.plan = deps.loadPlan(deps.basePath);
		this.config = deps.loadConfig(deps.basePath);
		this.planHistory = readHistory(deps.basePath);
		this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
		this.style = theme ? themeFrameStyle(theme) : undefined;
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
		const nextHistory = readHistory(this.deps.basePath);
		if (
			JSON.stringify(nextState) !== JSON.stringify(this.state) ||
			JSON.stringify(nextPlan) !== JSON.stringify(this.plan) ||
			JSON.stringify(nextConfig) !== JSON.stringify(this.config) ||
			nextHistory.length !== this.planHistory.length
		) {
			this.state = nextState;
			this.plan = nextPlan;
			this.config = nextConfig;
			this.planHistory = nextHistory;
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
				} else if (result.action.kind === "select_model") {
					const updated = applyModelChangeToConfig(this.config, result.action.roleIndex, result.action.model);
					saveConfig(this.deps.basePath, updated);
					this.config = updated;
					if (result.action.roleIndex === 0) {
						this.deps.setModel(result.action.model).catch(() => {
							this.deps.notify("Failed to apply model change", "error");
						});
					}
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
			case "history": {
				const action = handlePlanHistoryKey(data);
				if (action.kind === "close") {
					this.currentSubView = null;
					this.tui.requestRender();
				}
				return;
			}
			case "planning": {
				const action = handlePlanningSetupKey(data);
				if (action.kind === "close") {
					this.done();
				}
				return;
			}
			case "draft_review": {
				const action = handleDraftReviewKey(data);
				if (action.kind === "approve") {
					const currentState = this.deps.loadState(this.deps.basePath);
					const currentPlan = this.deps.loadPlan(this.deps.basePath);
					if (currentState && currentPlan) {
						const now = nowISO();
						const newPlanVersion = currentPlan.planVersion + 1;
						const updatedPlan: MissionPlan = {
							...currentPlan,
							approvedAt: now,
							planVersion: newPlanVersion,
						};
						savePlan(this.deps.basePath, updatedPlan);
						appendMutation(this.deps.basePath, {
							planVersion: newPlanVersion,
							timestamp: now,
							actor: "user",
							kind: "plan-approved",
							summary: "Plan approved by user",
							payload: {},
						});
						const newState = transitionState(currentState, "approved");
						saveState(this.deps.basePath, newState);
						this.state = newState;
						this.plan = updatedPlan;
						this.deps.updateWidget(newState, updatedPlan);
						this.deps.sendUserMessage(
							"I have approved the mission plan. Please begin execution by calling spawn_worker for the first feature.",
						);
					}
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
				this.modelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
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
			case "open_history_view":
				this.planHistory = readHistory(this.deps.basePath);
				this.currentSubView = { kind: "history" };
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
			const mf = this.style?.mutedFn ?? ((t: string) => t);
			const emptyLines = [
				"No active mission.",
				"",
				mf("Start a new mission by telling the orchestrator your goal."),
				mf("The LLM will analyze your codebase and draft a plan."),
			];
			return frame("Mission Control", emptyLines, width, "Esc: Close", this.style);
		}

		const activeView = this.resolveActiveView();
		if (activeView !== null) {
			return this.renderSubView(activeView, state, plan, width);
		}

		return this.renderMainOverlay(state, plan, width);
	}

	private renderSubView(view: SubView, state: MissionState, plan: MissionPlan | null, width: number): string[] {
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
				return renderModelView(
					this.config,
					effectivePlan,
					this.modelViewState,
					width,
					this.style,
					this.deps.availableModels,
				);
			}
			case "validation": {
				const milestone = plan?.milestones.find((m) => m.id === state.currentMilestoneId);
				const milestoneName = milestone?.name ?? "Current Milestone";
				const commands: CommandDisplayEntry[] = (milestone?.validationCommands ?? []).map((cmd) => ({
					label: cmd,
					status: "pending" as const,
				}));
				return renderValidationView(milestoneName, commands, false, width, this.style);
			}
			case "logs":
				return renderProgressLogStandalone(state.progressLog, width, this.style);
			case "history":
				return renderPlanHistoryView(this.planHistory, width, this.style);
			case "planning": {
				const goal = plan?.description;
				return renderPlanningSetupView(state, goal, width, this.style);
			}
			case "draft_review":
				if (!plan) return ["No plan to review.", "", "Esc: close"];
				return renderDraftReview(plan, width, this.style);
			case "blocked": {
				const feature = plan?.milestones.flatMap((m) => m.features).find((f) => f.id === view.featureId);
				if (!feature) return ["Feature not found.", "", "Esc: close"];
				const lastAttempt = feature.attempts[feature.attempts.length - 1];
				const lastFailure: LastFailureDetails | undefined = lastAttempt
					? { errorMessage: `Exit code: ${lastAttempt.exitCode ?? "unknown"}` }
					: undefined;
				return renderBlockedView(feature, 3, lastFailure, width, this.style);
			}
			case "report":
				if (!plan) return ["No report available.", "", "Esc: close"];
				return renderReportView(state, plan, this.deps.basePath, width, this.style);
		}
	}

	private renderStatusBar(state: MissionState, plan: MissionPlan | null, contentWidth: number): string {
		const sf = this.style?.successFn ?? ((t: string) => t);
		const wf = this.style?.warningFn ?? ((t: string) => t);
		const af = this.style?.accentFn ?? ((t: string) => t);
		const ef = this.style?.errorFn ?? ((t: string) => t);
		const mf = this.style?.mutedFn ?? ((t: string) => t);
		const tf = this.style?.textFn ?? ((t: string) => t);

		const statusLabels: Record<string, { label: string; fn: (t: string) => string }> = {
			executing: { label: "Running", fn: sf },
			paused: { label: "Paused", fn: wf },
			validating: { label: "Validating", fn: af },
			completed: { label: "Completed", fn: sf },
			failed: { label: "Failed", fn: ef },
		};
		const entry = statusLabels[state.status] ?? { label: capitalize(state.status), fn: mf };
		const statusDot = `${entry.fn("\u25cf")} ${entry.fn(entry.label)}`;

		if (!plan) return statusDot;

		const { done, total } = countFeatureStats(plan);
		const hasActive = !!state.currentFeatureId;
		const barWidth = Math.min(20, Math.max(5, contentWidth - 30));
		const doneWidth = total === 0 ? barWidth : Math.round((done / total) * barWidth);
		const activeWidth = hasActive ? 1 : 0;
		const pendingWidth = Math.max(0, barWidth - doneWidth - activeWidth);
		const actualDoneWidth = barWidth - activeWidth - pendingWidth;
		const bar =
			sf(PROGRESS_BAR_DONE.repeat(actualDoneWidth)) +
			(activeWidth > 0 ? af(PROGRESS_BAR_ACTIVE) : "") +
			mf(PROGRESS_BAR_PENDING.repeat(pendingWidth));
		const count = tf(`${done}/${total}`);

		const milestone = plan.milestones.find((m) => m.id === state.currentMilestoneId);
		const feature = state.currentFeatureId
			? plan.milestones.flatMap((m) => m.features).find((f) => f.id === state.currentFeatureId)
			: undefined;
		const parts: string[] = [];
		if (milestone) parts.push(`${mf("Milestone:")} ${tf(milestone.name)}`);
		if (feature) parts.push(`${mf("Feature:")} ${tf(feature.name)}`);
		const suffix = parts.length > 0 ? ` \u00b7 ${parts.join(" \u00b7 ")}` : "";

		return `${statusDot}  ${bar}  ${count}${suffix}`;
	}

	private renderMainOverlay(state: MissionState, plan: MissionPlan | null, width: number): string[] {
		const contentWidth = width - 4;
		const colWidth = Math.floor(contentWidth / 2);
		const rightColWidth = contentWidth - colWidth;

		const statusLine = this.renderStatusBar(state, plan, contentWidth);

		const leftContent = plan
			? renderFeaturePanelContent(state, plan, colWidth, this.style)
			: [section("Current Feature", colWidth, this.style), "(no plan loaded)"];

		const rightOutline = plan
			? renderOutlinePanelContent(plan, rightColWidth, this.style)
			: [section("Mission Outline", rightColWidth, this.style), "(no plan loaded)"];
		const rightLog = renderLogPanelContent(state, rightColWidth, this.style);
		const rightContent = [...rightOutline, "", ...rightLog];

		const maxRows = Math.max(leftContent.length, rightContent.length);
		const bodyLines: string[] = [statusLine, ""];

		for (let i = 0; i < maxRows; i++) {
			const rawLeft = leftContent[i] ?? "";
			const leftTrunc = truncateToWidth(rawLeft, colWidth);
			const leftPad = colWidth - visibleWidth(leftTrunc);
			const left = leftPad > 0 ? leftTrunc + " ".repeat(leftPad) : leftTrunc;
			const right = truncateToWidth(rightContent[i] ?? "", rightColWidth);
			bodyLines.push(`${left}${right}`);
		}

		const footer = "P: Pause  S: Skip  D: Done  R: Redirect  M: Models  V: Validate  L: Logs  H: History  Esc: Close";
		return frame("Mission Control", bodyLines, width, footer, this.style);
	}

	invalidate(): void {}

	dispose(): void {
		if (this.pollInterval !== null) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}
}
