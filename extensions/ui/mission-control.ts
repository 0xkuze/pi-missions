import type { Component, Focusable, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { saveConfig, savePlan, saveState } from "../state/manager.js";
import { appendMutation, readHistory } from "../state/plan-history.js";
import type { MissionRegistryEntry } from "../state/registry.js";
import { transitionState } from "../state/transitions.js";
import type { Feature, MissionConfig, MissionPlan, MissionState, PlanMutation, ProgressEvent } from "../types.js";
import { nowISO } from "../utils.js";
import { handleBlockedViewKey, type LastFailureDetails, renderBlockedView } from "./blocked-view.js";
import { countProgress } from "./count-progress.js";
import { handleDraftReviewKey, renderDraftReview } from "./draft-review.js";
import type { FrameStyle } from "./frame.js";
import {
	applyBg,
	footerBar,
	frame,
	panel,
	panelWithCount,
	section,
	styledFeatureIcon,
	styledFeatureName,
	themeFrameStyle,
	titleBar,
	wrapText,
} from "./frame.js";
import {
	handleMissionListKey,
	initialMissionListState,
	type MissionListState,
	renderMissionList,
} from "./mission-list.js";
import { renderPlanHistoryView } from "./plan-history.js";
import { renderPlanningSetupView } from "./planning-setup.js";
import { renderProgressLog as renderProgressLogStandalone } from "./progress-log.js";
import {
	handleModelViewKey,
	handleReportViewKey,
	type ModelViewState,
	renderModelView,
	renderReportView,
} from "./report-view.js";
import { type CommandDisplayEntry, renderValidationView } from "./validation-view.js";

const ICON_FIX = "\u27a1";

const PROGRESS_BAR_DONE = "\u2588";
const PROGRESS_BAR_ACTIVE = "\u2593";
const PROGRESS_BAR_PENDING = "\u2591";
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
	| { kind: "reset" }
	| { kind: "open_model_view" }
	| { kind: "open_validation_view" }
	| { kind: "open_logs_view" }
	| { kind: "open_history_view" }
	| { kind: "warn"; message: string }
	| { kind: "noop" };

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);
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

	if (upper === "X") {
		if (!state) {
			return { kind: "warn", message: "X: No mission to reset." };
		}
		return { kind: "reset" };
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
	if (TERMINAL_STATUSES.has(state.status)) return null;
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
	projectPath: string;
	loadState: (basePath: string) => MissionState | null;
	loadPlan: (basePath: string) => MissionPlan | null;
	loadConfig: (basePath: string) => MissionConfig;
	sendUserMessage: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => void;
	getInput: (title: string, placeholder?: string) => Promise<string | undefined>;
	confirm: (title: string, message: string) => Promise<boolean>;
	notify: (message: string, type?: "info" | "warning" | "error") => void;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
	availableModels: string[];
	openFile: (path: string) => void;
	setModel: (modelId: string) => Promise<void>;
	resetMission: () => void;
	loadRegistry: () => MissionRegistryEntry[];
	startNewMission: (description: string) => void;
}

export class MissionControlComponent implements Component, Focusable {
	focused = false;
	private state: MissionState | null;
	private plan: MissionPlan | null;
	private config: MissionConfig;
	private planHistory: PlanMutation[];
	private currentSubView: SubView | null = null;
	private subViewScrollOffset = 0;
	private viewingMissionDetail = false;
	private modelViewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
	private missionListState: MissionListState = initialMissionListState();
	private registryEntries: MissionRegistryEntry[] = [];
	private pollInterval: ReturnType<typeof setInterval> | null = null;
	private style: FrameStyle | undefined;
	private theme:
		| { fg: (...args: any[]) => string; bg: (...args: any[]) => string; bold: (text: string) => string }
		| undefined;
	private leftScrollOffset = 0;
	private rightTopScrollOffset = 0;
	private rightBottomScrollOffset = 0;
	private activePane: "left" | "right-top" | "right-bottom" = "left";
	private cachedWidth = 0;
	private cachedLines: string[] = [];
	private version = 0;
	private cachedVersion = -1;
	private cachedSortedLog: ProgressEvent[] = [];
	private cachedLogLength = -1;
	private layoutLeftWidth = 0;
	private layoutRightTopSplitRow = 0;
	private layoutContentStartRow = 0;

	constructor(
		private tui: TUI,
		private done: (result?: string) => void,
		private deps: MissionControlDeps,
		// why: pi Theme uses branded union types for color parameters; we accept `any` at this boundary
		theme?: { fg: (...args: any[]) => string; bg: (...args: any[]) => string; bold: (text: string) => string },
	) {
		this.theme = theme;
		this.state = deps.loadState(deps.basePath);
		this.plan = deps.loadPlan(deps.basePath);
		this.config = deps.loadConfig(deps.basePath);
		this.planHistory = readHistory(deps.basePath);
		this.registryEntries = deps.loadRegistry();
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
			if (nextState?.status !== this.state?.status || nextState?.currentFeatureId !== this.state?.currentFeatureId) {
				this.leftScrollOffset = 0;
				this.rightTopScrollOffset = 0;
				this.rightBottomScrollOffset = 0;
			}
			this.state = nextState;
			this.plan = nextPlan;
			this.config = nextConfig;
			this.planHistory = nextHistory;
			this.version++;
			this.tui.requestRender();
		}
	}

	private isShowingMissionList(): boolean {
		if (this.viewingMissionDetail) return false;
		return !this.state || TERMINAL_STATUSES.has(this.state.status);
	}

	handleInput(data: string): void {
		if (this.isShowingMissionList()) {
			this.handleMissionListInput(data);
			return;
		}

		const activeView = this.resolveActiveView();
		if (activeView !== null) {
			this.handleSubViewInput(data, activeView);
			return;
		}

		if (data === "\t") {
			const panes: Array<"left" | "right-top" | "right-bottom"> = ["left", "right-top", "right-bottom"];
			const currentIdx = panes.indexOf(this.activePane);
			this.activePane = panes[(currentIdx + 1) % panes.length]!;
			this.version++;
			this.tui.requestRender();
			return;
		}

		if (this.handleMouseScroll(data)) {
			this.version++;
			this.tui.requestRender();
			return;
		}

		if (this.handleScroll(data)) {
			this.version++;
			this.tui.requestRender();
			return;
		}
		const action = handleKeyboardAction(data, this.state);
		this.dispatchAction(action);
	}

	private parseMouseEvent(data: string): { button: number; x: number; y: number } | null {
		const match = data.match(/^\x1b\[<(\d+);(\d+);(\d+)[Mm]$/);
		if (!match) return null;
		return {
			button: Number.parseInt(match[1]!, 10),
			x: Number.parseInt(match[2]!, 10),
			y: Number.parseInt(match[3]!, 10),
		};
	}

	private paneFromMousePosition(x: number, y: number): "left" | "right-top" | "right-bottom" | null {
		if (y < this.layoutContentStartRow || y < 1) return null;
		if (x <= this.layoutLeftWidth) return "left";
		if (y < this.layoutRightTopSplitRow) return "right-top";
		return "right-bottom";
	}

	private handleMouseScroll(data: string): boolean {
		const event = this.parseMouseEvent(data);
		if (!event) return false;
		if (event.button !== 64 && event.button !== 65) return false;
		const delta = event.button === 64 ? -3 : 3;
		const pane = this.paneFromMousePosition(event.x, event.y);
		if (!pane) return false;
		this.activePane = pane;
		this.applyScrollToActivePane(delta);
		return true;
	}

	private applyScrollToActivePane(delta: number): void {
		switch (this.activePane) {
			case "left":
				this.leftScrollOffset = Math.max(0, this.leftScrollOffset + delta);
				break;
			case "right-top":
				this.rightTopScrollOffset = Math.max(0, this.rightTopScrollOffset + delta);
				break;
			case "right-bottom":
				this.rightBottomScrollOffset = Math.max(0, this.rightBottomScrollOffset + delta);
				break;
		}
	}

	private handleScroll(data: string): boolean {
		if (matchesKey(data, "up")) {
			this.applyScrollToActivePane(-1);
			return true;
		}
		if (matchesKey(data, "down")) {
			this.applyScrollToActivePane(1);
			return true;
		}
		if (matchesKey(data, "pageUp")) {
			this.applyScrollToActivePane(-5);
			return true;
		}
		if (matchesKey(data, "pageDown")) {
			this.applyScrollToActivePane(5);
			return true;
		}
		return false;
	}

	private handleSubViewScroll(data: string): boolean {
		if (matchesKey(data, "up")) {
			this.subViewScrollOffset = Math.max(0, this.subViewScrollOffset - 1);
			return true;
		}
		if (matchesKey(data, "down")) {
			this.subViewScrollOffset++;
			return true;
		}
		if (matchesKey(data, "pageUp")) {
			this.subViewScrollOffset = Math.max(0, this.subViewScrollOffset - 10);
			return true;
		}
		if (matchesKey(data, "pageDown")) {
			this.subViewScrollOffset += 10;
			return true;
		}
		return false;
	}

	private handleSubViewInput(data: string, subView: SubView): void {
		switch (subView.kind) {
			case "model": {
				const result = handleModelViewKey(data, this.modelViewState, this.deps.availableModels);
				this.modelViewState = result.nextViewState;
				if (result.action.kind === "close") {
					this.currentSubView = null;
					this.leftScrollOffset = 0;
					this.rightTopScrollOffset = 0;
					this.rightBottomScrollOffset = 0;
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
			case "validation":
			case "logs":
			case "history":
			case "planning": {
				if (this.handleSubViewScroll(data)) {
					this.version++;
					this.tui.requestRender();
					return;
				}
				if (matchesKey(data, "escape")) {
					if (subView.kind === "planning") {
						this.done();
					} else {
						this.currentSubView = null;
						this.subViewScrollOffset = 0;
						this.leftScrollOffset = 0;
						this.rightTopScrollOffset = 0;
						this.rightBottomScrollOffset = 0;
						this.tui.requestRender();
					}
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
							{ deliverAs: "followUp" },
						);
					}
					this.currentSubView = null;
					this.leftScrollOffset = 0;
					this.rightTopScrollOffset = 0;
					this.rightBottomScrollOffset = 0;
					this.done();
				} else if (action.kind === "close") {
					this.currentSubView = null;
					this.leftScrollOffset = 0;
					this.rightTopScrollOffset = 0;
					this.rightBottomScrollOffset = 0;
					this.done();
				}
				this.tui.requestRender();
				return;
			}
			case "blocked": {
				if (this.handleSubViewScroll(data)) {
					this.version++;
					this.tui.requestRender();
					return;
				}
				const action = handleBlockedViewKey(data);
				if (action.kind === "close") {
					this.done();
				} else if (action.kind === "retry") {
					this.deps.sendUserMessage(
						`Please retry the blocked feature '${subView.featureId}' with additional guidance.`,
						{ deliverAs: "steer" },
					);
					this.done();
				} else if (action.kind === "skip") {
					this.applySkip();
				}
				return;
			}
			case "report": {
				if (this.handleSubViewScroll(data)) {
					this.version++;
					this.tui.requestRender();
					return;
				}
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
				if (this.viewingMissionDetail) {
					this.viewingMissionDetail = false;
					this.registryEntries = this.deps.loadRegistry();
					this.missionListState = initialMissionListState();
					this.version++;
					this.tui.requestRender();
					return;
				}
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
				this.deps.sendUserMessage("Please call complete_mission to finalize the mission and generate the report.", {
					deliverAs: "followUp",
				});
				this.done();
				return;
			case "redirect":
				this.applyRedirect();
				return;
			case "reset":
				this.applyReset();
				return;
			case "open_model_view":
				this.modelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
				this.currentSubView = { kind: "model" };
				this.subViewScrollOffset = 0;
				this.tui.requestRender();
				return;
			case "open_validation_view":
				this.currentSubView = { kind: "validation" };
				this.subViewScrollOffset = 0;
				this.tui.requestRender();
				return;
			case "open_logs_view":
				this.currentSubView = { kind: "logs" };
				this.subViewScrollOffset = 0;
				this.tui.requestRender();
				return;
			case "open_history_view":
				this.planHistory = readHistory(this.deps.basePath);
				this.currentSubView = { kind: "history" };
				this.subViewScrollOffset = 0;
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
			this.deps.sendUserMessage("Mission resumed. Please continue from where you left off.", { deliverAs: "steer" });
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
		this.deps.sendUserMessage(`Feature '${featureName}' has been skipped. Please continue with the next feature.`, {
			deliverAs: "followUp",
		});
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

			this.deps.sendUserMessage(message, { deliverAs: "steer" });
			this.done();
		});
	}

	private applyReset(): void {
		this.deps
			.confirm("Reset Mission", "This will permanently remove all mission state and files. Are you sure?")
			.then((confirmed) => {
				if (!confirmed) return;
				this.deps.resetMission();
				this.state = null;
				this.plan = null;
				this.registryEntries = this.deps.loadRegistry();
				this.missionListState = initialMissionListState();
				this.version++;
				this.tui.requestRender();
			});
	}

	private handleMissionListInput(data: string): void {
		const filtered = this.registryEntries;
		const { action, nextState } = handleMissionListKey(data, this.missionListState, filtered.length);
		this.missionListState = nextState;

		switch (action.kind) {
			case "close":
				this.done();
				return;
			case "new_mission":
				this.done("new_mission");
				return;
			case "select": {
				const entry = filtered[action.entryIndex];
				if (!entry) return;
				if (entry.projectPath !== this.deps.projectPath) {
					this.deps.notify(`Mission is in a different project: ${entry.projectPath}`, "info");
					return;
				}
				const loadedState = this.deps.loadState(this.deps.basePath);
				const loadedPlan = this.deps.loadPlan(this.deps.basePath);
				if (loadedState) {
					this.state = loadedState;
					this.plan = loadedPlan;
					this.viewingMissionDetail = true;
					this.leftScrollOffset = 0;
					this.rightTopScrollOffset = 0;
					this.rightBottomScrollOffset = 0;
					this.version++;
					this.tui.requestRender();
				}
				return;
			}
			case "noop":
				this.version++;
				this.tui.requestRender();
				return;
		}
	}

	private resolveActiveView(): SubView | null {
		if (this.currentSubView !== null) return this.currentSubView;
		if (!this.state) return null;
		return resolveStateView(this.state, this.plan);
	}

	render(width: number): string[] {
		const state = this.state;
		const plan = this.plan;

		if (this.isShowingMissionList()) {
			const height = this.tui.terminal.rows - 5;
			return renderMissionList(
				this.registryEntries,
				this.deps.projectPath,
				this.missionListState,
				width,
				height,
				this.style,
			);
		}

		if (!state) return ["No mission state."];

		const activeView = this.resolveActiveView();
		if (activeView !== null) {
			return this.renderSubView(activeView, state, plan, width);
		}

		if (width === this.cachedWidth && this.version === this.cachedVersion) return this.cachedLines;
		const result = this.renderMainOverlay(state, plan, width);
		this.cachedWidth = width;
		this.cachedLines = result;
		this.cachedVersion = this.version;
		return result;
	}

	private renderSubView(view: SubView, state: MissionState, plan: MissionPlan | null, width: number): string[] {
		const height = this.tui.terminal.rows - 5;
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
					height,
				);
			}
			case "validation": {
				const milestone = plan?.milestones.find((m) => m.id === state.currentMilestoneId);
				const milestoneName = milestone?.name ?? "Current Milestone";
				const commands: CommandDisplayEntry[] = (milestone?.validationCommands ?? []).map((cmd) => ({
					label: cmd,
					status: "pending" as const,
				}));
				return renderValidationView(
					milestoneName,
					commands,
					false,
					width,
					this.style,
					height,
					this.subViewScrollOffset,
				);
			}
			case "logs":
				return renderProgressLogStandalone(state.progressLog, width, this.style, height, this.subViewScrollOffset);
			case "history":
				return renderPlanHistoryView(this.planHistory, width, this.style, height, this.subViewScrollOffset);
			case "planning": {
				const goal = plan?.description;
				return renderPlanningSetupView(state, goal, width, this.style, height, this.subViewScrollOffset);
			}
			case "draft_review":
				if (!plan) return ["No plan to review.", "", "Esc: close"];
				return renderDraftReview(plan, width, this.style, height);
			case "blocked": {
				const feature = plan?.milestones.flatMap((m) => m.features).find((f) => f.id === view.featureId);
				if (!feature) return ["Feature not found.", "", "Esc: close"];
				const lastAttempt = feature.attempts[feature.attempts.length - 1];
				const lastFailure: LastFailureDetails | undefined = lastAttempt
					? { errorMessage: `Exit code: ${lastAttempt.exitCode ?? "unknown"}` }
					: undefined;
				return renderBlockedView(feature, 3, lastFailure, width, this.style, height, this.subViewScrollOffset);
			}
			case "report":
				if (!plan) return ["No report available.", "", "Esc: close"];
				return renderReportView(
					state,
					plan,
					this.deps.basePath,
					width,
					this.style,
					height,
					this.subViewScrollOffset,
				);
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

		if (!plan) {
			const dotVW = visibleWidth(statusDot);
			const dotPad = Math.max(0, Math.floor((contentWidth - dotVW) / 2));
			return " ".repeat(dotPad) + statusDot;
		}

		const { done, total, hasActive } = countProgress(state, plan ?? undefined);
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

		const result = `${statusDot}  ${bar}  ${count}${suffix}`;
		const resultVW = visibleWidth(result);
		const leftPad = Math.max(0, Math.floor((contentWidth - resultVW) / 2));
		return " ".repeat(leftPad) + result;
	}

	private buildFeaturePanelLines(state: MissionState, plan: MissionPlan, contentWidth: number): string[] {
		const feature = findCurrentFeature(state, plan);
		const milestone = findCurrentMilestone(state, plan);
		const mf = this.style?.mutedFn ?? ((t: string) => t);
		const tf = this.style?.textFn ?? ((t: string) => t);
		const bf = this.style?.boldFn ?? ((t: string) => t);
		const wf = this.style?.warningFn ?? ((t: string) => t);
		const lines: string[] = [];

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
			lines.push(section("Acceptance Criteria", contentWidth, this.style));
			for (const criterion of feature.acceptanceCriteria) {
				lines.push(`\u2022 ${tf(criterion)}`);
			}
		}

		const warnings = buildWarnings(state);
		if (warnings.length > 0) {
			lines.push(section("Warnings", contentWidth, this.style));
			for (const warning of warnings) {
				lines.push(`\u2022 ${wf(warning)}`);
			}
		}

		return lines;
	}

	private buildOutlineLines(plan: MissionPlan, contentWidth: number): string[] {
		const lines: string[] = [];
		const tf = this.style?.textFn ?? ((t: string) => t);

		for (const milestone of plan.milestones) {
			lines.push(tf(milestone.name));
			for (const feature of milestone.features) {
				const icon = styledFeatureIcon(feature.status, this.style);
				const fixMarker = feature.fixOrigin ? ` ${ICON_FIX}` : "";
				const prefix = `  ${icon} `;
				const prefixWidth = visibleWidth(prefix);
				const availableWidth = contentWidth - prefixWidth;
				const rawName = `${feature.name}${fixMarker}`;
				const wrappedRaw = wrapText(rawName, availableWidth);
				lines.push(`${prefix}${styledFeatureName(wrappedRaw[0]!, feature.status, this.style)}`);
				for (let i = 1; i < wrappedRaw.length; i++) {
					lines.push(" ".repeat(prefixWidth) + styledFeatureName(wrappedRaw[i]!, feature.status, this.style));
				}
			}
		}

		return lines;
	}

	private buildLogLines(state: MissionState, contentWidth: number): string[] {
		const mf = this.style?.mutedFn ?? ((t: string) => t);
		const tf = this.style?.textFn ?? ((t: string) => t);

		if (state.progressLog.length === 0) {
			return [mf("(no events yet)")];
		}

		if (state.progressLog.length !== this.cachedLogLength) {
			this.cachedSortedLog = [...state.progressLog].sort(
				(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
			);
			this.cachedLogLength = state.progressLog.length;
		}
		const events = this.cachedSortedLog;

		const lines: string[] = [];
		for (const event of events) {
			const time = formatRelativeTime(event.timestamp);
			const icon = styledProgressEventIcon(event.type, this.style);
			const prefix = `${mf(time.padEnd(4))} ${icon} `;
			const prefixWidth = visibleWidth(prefix);
			const availableWidth = contentWidth - prefixWidth;
			const wrappedRaw = wrapText(event.detail, availableWidth);
			lines.push(`${prefix}${tf(wrappedRaw[0]!)}`);
			for (let i = 1; i < wrappedRaw.length; i++) {
				lines.push(" ".repeat(prefixWidth) + tf(wrappedRaw[i]!));
			}
		}

		return lines;
	}

	private activePanelStyle(): FrameStyle | undefined {
		if (!this.style) return undefined;
		return { ...this.style, borderFn: this.style.accentFn };
	}

	private renderMainOverlay(state: MissionState, plan: MissionPlan | null, width: number): string[] {
		const termRows = this.tui.terminal.rows;
		const FOOTER_LINES = 3;
		const TITLE_LINES = 1;
		const STATUS_LINES = 1;
		const SPACING = 1;
		const MARGIN = 2;
		const availablePanelRows = Math.max(5, termRows - FOOTER_LINES - TITLE_LINES - STATUS_LINES - SPACING - MARGIN);

		const leftWidth = Math.floor(width * 0.4);
		const rightWidth = width - leftWidth;

		const statusLine = this.renderStatusBar(state, plan, width);

		const leftContentWidth = leftWidth - 4;
		const leftContent = plan ? this.buildFeaturePanelLines(state, plan, leftContentWidth) : ["No Active Feature"];
		const leftStyle = this.activePane === "left" ? this.activePanelStyle() : this.style;
		const leftPanel = panel(
			"Current Feature",
			leftContent,
			leftWidth,
			availablePanelRows,
			this.leftScrollOffset,
			leftStyle,
		);

		const rightTopHeight = Math.floor(availablePanelRows * 0.45);
		const rightBottomHeight = availablePanelRows - rightTopHeight;

		const rightContentWidth = rightWidth - 4;
		const { done, total } = countProgress(state, plan ?? undefined);
		const featuresContent = plan ? this.buildOutlineLines(plan, rightContentWidth) : ["(no plan loaded)"];
		const rightTopStyle = this.activePane === "right-top" ? this.activePanelStyle() : this.style;
		const featuresPanel = panelWithCount(
			"Features",
			`${done}/${total}`,
			featuresContent,
			rightWidth,
			rightTopHeight,
			this.rightTopScrollOffset,
			rightTopStyle,
		);

		const logContent = this.buildLogLines(state, rightContentWidth);
		const logCount = `${state.progressLog.length}`;
		const rightBottomStyle = this.activePane === "right-bottom" ? this.activePanelStyle() : this.style;
		const logPanel = panelWithCount(
			"Progress Log",
			logCount,
			logContent,
			rightWidth,
			rightBottomHeight,
			this.rightBottomScrollOffset,
			rightBottomStyle,
		);

		const rightLines = [...featuresPanel, ...logPanel];
		const maxRows = Math.max(leftPanel.length, rightLines.length);

		const output: string[] = [];
		const bgFn = this.style?.bgFn;

		const CONTENT_START_ROW = 4;
		this.layoutLeftWidth = leftWidth;
		this.layoutContentStartRow = CONTENT_START_ROW;
		this.layoutRightTopSplitRow = CONTENT_START_ROW + rightTopHeight;

		const titleLine = titleBar("Mission Control", width, this.style);
		output.push(bgFn ? applyBg(titleLine, width, bgFn) : titleLine);
		output.push(bgFn ? applyBg(statusLine, width, bgFn) : statusLine);
		output.push(bgFn ? applyBg("", width, bgFn) : "");

		for (let i = 0; i < maxRows; i++) {
			const left = leftPanel[i] ?? "";
			const right = rightLines[i] ?? "";
			const leftPadded = truncateToWidth(left, leftWidth);
			const leftPad = leftWidth - visibleWidth(leftPadded);
			output.push(`${leftPadded}${leftPad > 0 ? " ".repeat(leftPad) : ""}${truncateToWidth(right, rightWidth)}`);
		}

		const tabHint = "Tab: Switch pane";
		const baseShortcuts = this.viewingMissionDetail
			? "Esc: Back to list"
			: `P: Pause  R: Redirect  X: Reset  ${tabHint}  Esc: Close`;
		for (const line of footerBar(baseShortcuts, width, this.style)) {
			output.push(line);
		}

		return output;
	}

	invalidate(): void {
		this.cachedVersion = -1;
		if (this.theme) {
			this.style = themeFrameStyle(this.theme);
		}
	}

	dispose(): void {
		if (this.pollInterval !== null) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}
}
