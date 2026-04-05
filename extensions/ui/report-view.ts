import { join } from "node:path";
import { matchesKey } from "@mariozechner/pi-tui";
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
}

const ROLE_NAMES = ["orchestrator", "worker", "validator"] as const;
type RoleName = (typeof ROLE_NAMES)[number];

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
): string[] {
	const tf = style?.textFn ?? ((t: string) => t);
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const lines: string[] = [];

	if (viewState.selectedRoleIndex === null) {
		lines.push(tf("Select a role to change its model:"));
		lines.push("");
		for (let i = 0; i < ROLE_NAMES.length; i++) {
			const role = ROLE_NAMES[i];
			const model = resolveRoleModel(role, config, plan);
			lines.push(`${tf(`${i + 1}.`)} ${tf(`${capitalize(role)}:`)} ${af(model)}`);
		}
	} else {
		const role = ROLE_NAMES[viewState.selectedRoleIndex];
		lines.push(tf(`Changing model for: ${capitalize(role)}`));
		lines.push("");
		lines.push(tf("Available models:"));
		lines.push(mf("(select via number when models are listed)"));
	}

	return frame("Model Assignment", lines, width, "Esc: back", style);
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
	if (viewState.selectedRoleIndex !== null) {
		if (matchesKey(key, "escape")) {
			return {
				action: { kind: "noop" },
				nextViewState: { selectedRoleIndex: null },
			};
		}

		const digit = Number.parseInt(key, 10);
		if (!Number.isNaN(digit) && digit >= 1 && digit <= availableModels.length) {
			const model = availableModels[digit - 1];
			return {
				action: { kind: "select_model", roleIndex: viewState.selectedRoleIndex, model },
				nextViewState: { selectedRoleIndex: null },
			};
		}

		return {
			action: { kind: "noop" },
			nextViewState: viewState,
		};
	}

	if (matchesKey(key, "escape")) {
		return {
			action: { kind: "close" },
			nextViewState: viewState,
		};
	}

	const digit = Number.parseInt(key, 10);
	if (!Number.isNaN(digit) && digit >= 1 && digit <= ROLE_NAMES.length) {
		return {
			action: { kind: "noop" },
			nextViewState: { selectedRoleIndex: digit - 1 },
		};
	}

	return {
		action: { kind: "noop" },
		nextViewState: viewState,
	};
}
