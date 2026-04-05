import { join } from "node:path";
import { fuzzyFilter, matchesKey } from "@mariozechner/pi-tui";
import { resolveModel } from "../config.js";
import type { MissionConfig, MissionPlan, MissionState } from "../types.js";
import { formatDuration } from "../utils.js";
import type { FrameStyle } from "./frame.js";
import { frame, section } from "./frame.js";

export type ReportViewAction = { kind: "close" } | { kind: "open_report" } | { kind: "noop" };

export type ModelViewAction =
	| { kind: "close" }
	| { kind: "noop" }
	| { kind: "select_model"; roleIndex: number; model: string };

export interface ModelViewState {
	selectedRoleIndex: number | null;
	searchQuery: string;
	highlightedIndex: number;
}

const ROLE_NAMES = ["orchestrator", "worker", "validator"] as const;
type RoleName = (typeof ROLE_NAMES)[number];

const MAX_VISIBLE_MODELS = 8;

function filterModels(models: string[], query: string): string[] {
	if (!query) return models;
	return fuzzyFilter(models, query, (m) => m);
}

function computeDurationMs(state: MissionState): number {
	const start = new Date(state.startedAt).getTime();
	const end = state.completedAt ? new Date(state.completedAt).getTime() : Date.now();
	return Math.max(0, end - start);
}

function countMilestonePassed(plan: MissionPlan): { passed: number; total: number } {
	const total = plan.milestones.length;
	const passed = plan.milestones.filter((m) => m.status === "done").length;
	return { passed, total };
}

export function renderReportView(
	state: MissionState,
	plan: MissionPlan,
	basePath: string,
	width = 80,
	style?: FrameStyle,
): string[] {
	const contentWidth = width - 4;
	const tf = style?.textFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const sf = style?.successFn ?? ((t: string) => t);
	const ef = style?.errorFn ?? ((t: string) => t);
	const lines: string[] = [];

	lines.push(bf(tf(`Goal: ${plan.description}`)));
	lines.push("");

	const durationMs = computeDurationMs(state);
	lines.push(mf(`Duration: ${formatDuration(durationMs)}`));
	lines.push("");

	lines.push(section("Features", contentWidth, style));
	lines.push(`${mf("Completed:")} ${tf(`${state.totalFeaturesCompleted}`)}`);
	if (state.totalFeaturesSkipped > 0) {
		lines.push(`${mf("Skipped:")} ${tf(`${state.totalFeaturesSkipped}`)}`);
	}
	if (state.totalFixFeaturesCreated > 0) {
		lines.push(`${mf("Fix features:")} ${tf(`${state.totalFixFeaturesCreated}`)}`);
	}
	lines.push("");

	const { passed, total } = countMilestonePassed(plan);
	if (total > 0) {
		const validationFn = passed === total ? sf : ef;
		lines.push(`${mf("Validation:")} ${validationFn(`${passed}/${total} milestones passed`)}`);
		lines.push("");
	}

	const reportPath = join(basePath, "report.md");
	lines.push(section("Output", contentWidth, style));
	lines.push(mf(`Report: ${reportPath}`));

	return frame("Mission Complete", lines, width, "O: open report   Esc: close", style);
}

export function handleReportViewKey(key: string): ReportViewAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	if (key.toUpperCase() === "O") return { kind: "open_report" };
	return { kind: "noop" };
}

function resolveRoleModel(role: RoleName, config: MissionConfig, plan: MissionPlan): string {
	const model = resolveModel(role, config, plan);
	return model ?? "(current session default)";
}

export function renderModelView(
	config: MissionConfig,
	plan: MissionPlan,
	viewState: ModelViewState,
	width = 80,
	style?: FrameStyle,
	availableModels: string[] = [],
): string[] {
	const tf = style?.textFn ?? ((t: string) => t);
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const lines: string[] = [];

	if (viewState.selectedRoleIndex === null) {
		lines.push(tf("Model Assignment"));
		lines.push("");
		for (let i = 0; i < ROLE_NAMES.length; i++) {
			const role = ROLE_NAMES[i];
			const model = resolveRoleModel(role, config, plan);
			const pointer = i === viewState.highlightedIndex ? af(">") : " ";
			const label =
				i === viewState.highlightedIndex
					? af(`${i + 1}. ${capitalize(role)}: ${model}`)
					: tf(`${i + 1}. ${capitalize(role)}: ${model}`);
			lines.push(`${pointer} ${label}`);
		}
		lines.push("");
		lines.push(mf("Use arrow keys or 1-3 to select a role."));
	} else {
		const role = ROLE_NAMES[viewState.selectedRoleIndex];
		lines.push(tf(`Select model for: ${capitalize(role)}`));
		lines.push("");
		const cursor = viewState.searchQuery ? viewState.searchQuery : "";
		lines.push(`${mf("Search:")} ${tf(cursor)}${af("_")}`);
		lines.push("");
		const filtered = filterModels(availableModels, viewState.searchQuery);
		const visible = filtered.slice(0, MAX_VISIBLE_MODELS);
		for (let i = 0; i < visible.length; i++) {
			const pointer = i === viewState.highlightedIndex ? af(">") : " ";
			const label = i === viewState.highlightedIndex ? af(visible[i]) : tf(visible[i]);
			lines.push(`${pointer} ${label}`);
		}
		const remaining = filtered.length - MAX_VISIBLE_MODELS;
		if (remaining > 0) {
			lines.push("");
			lines.push(mf(`+${remaining} more`));
		}
		if (filtered.length === 0) {
			lines.push(mf("No matching models"));
		}
		lines.push("");
		lines.push(mf("Type to filter \u00b7 Enter: select \u00b7 Esc: back"));
	}

	const footer = viewState.selectedRoleIndex === null ? "Esc: close" : "Esc: back";
	return frame("Model Assignment", lines, width, footer, style);
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface ModelViewKeyResult {
	action: ModelViewAction;
	nextViewState: ModelViewState;
}

export function handleModelViewKey(
	key: string,
	viewState: ModelViewState,
	availableModels: string[],
): ModelViewKeyResult {
	if (viewState.selectedRoleIndex === null) {
		if (matchesKey(key, "escape")) {
			return { action: { kind: "close" }, nextViewState: viewState };
		}
		if (matchesKey(key, "return")) {
			return {
				action: { kind: "noop" },
				nextViewState: { selectedRoleIndex: viewState.highlightedIndex, searchQuery: "", highlightedIndex: 0 },
			};
		}
		if (matchesKey(key, "up") || matchesKey(key, "k")) {
			return {
				action: { kind: "noop" },
				nextViewState: { ...viewState, highlightedIndex: Math.max(0, viewState.highlightedIndex - 1) },
			};
		}
		if (matchesKey(key, "down") || matchesKey(key, "j")) {
			return {
				action: { kind: "noop" },
				nextViewState: { ...viewState, highlightedIndex: Math.min(2, viewState.highlightedIndex + 1) },
			};
		}
		const digit = Number.parseInt(key, 10);
		if (digit >= 1 && digit <= 3) {
			return {
				action: { kind: "noop" },
				nextViewState: { selectedRoleIndex: digit - 1, searchQuery: "", highlightedIndex: 0 },
			};
		}
		return { action: { kind: "noop" }, nextViewState: viewState };
	}

	if (matchesKey(key, "escape")) {
		return {
			action: { kind: "noop" },
			nextViewState: { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 },
		};
	}

	const filtered = filterModels(availableModels, viewState.searchQuery);

	if (matchesKey(key, "return")) {
		const selected = filtered[viewState.highlightedIndex];
		if (selected) {
			return {
				action: { kind: "select_model", roleIndex: viewState.selectedRoleIndex, model: selected },
				nextViewState: { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 },
			};
		}
		return { action: { kind: "noop" }, nextViewState: viewState };
	}

	if (matchesKey(key, "up") || matchesKey(key, "k")) {
		return {
			action: { kind: "noop" },
			nextViewState: { ...viewState, highlightedIndex: Math.max(0, viewState.highlightedIndex - 1) },
		};
	}
	if (matchesKey(key, "down") || matchesKey(key, "j")) {
		const maxIdx = Math.min(filtered.length - 1, MAX_VISIBLE_MODELS - 1);
		return {
			action: { kind: "noop" },
			nextViewState: {
				...viewState,
				highlightedIndex: Math.min(Math.max(0, maxIdx), viewState.highlightedIndex + 1),
			},
		};
	}

	if (matchesKey(key, "backspace")) {
		const newQuery = viewState.searchQuery.slice(0, -1);
		return {
			action: { kind: "noop" },
			nextViewState: { ...viewState, searchQuery: newQuery, highlightedIndex: 0 },
		};
	}

	if (key.length === 1 && key >= " ") {
		const newQuery = viewState.searchQuery + key;
		return {
			action: { kind: "noop" },
			nextViewState: { ...viewState, searchQuery: newQuery, highlightedIndex: 0 },
		};
	}

	return { action: { kind: "noop" }, nextViewState: viewState };
}
