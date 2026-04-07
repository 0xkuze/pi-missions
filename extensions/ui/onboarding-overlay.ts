import type { Component, Focusable, TUI } from "@mariozechner/pi-tui";
import { fuzzyFilter, matchesKey } from "@mariozechner/pi-tui";
import { DEFAULT_ORCHESTRATOR_MODEL, DEFAULT_VALIDATOR_MODEL, DEFAULT_WORKER_MODEL } from "../config.js";
import type { GlobalConfig, PromptingMode } from "../types.js";
import type { FrameStyle } from "./frame.js";
import { applyBg, footerBar, panel, themeFrameStyle, titleBar, wrapText } from "./frame.js";

export interface ModelPickerState {
	roleIndex: number;
	searchQuery: string;
	highlightedIndex: number;
}

export interface OnboardingState {
	step: 0 | 1 | 2;
	orchestratorModel: string;
	workerModel: string;
	validatorModel: string;
	modelHighlight: number;
	modelPicker: ModelPickerState | null;
	promptingMode: PromptingMode;
	promptingHighlight: number;
	spawnAndLearn: boolean;
	spawnHighlight: number;
}

export function createInitialOnboardingState(): OnboardingState {
	return {
		step: 0,
		orchestratorModel: DEFAULT_ORCHESTRATOR_MODEL,
		workerModel: DEFAULT_WORKER_MODEL,
		validatorModel: DEFAULT_VALIDATOR_MODEL,
		modelHighlight: 0,
		modelPicker: null,
		promptingMode: "caveman",
		promptingHighlight: 0,
		spawnAndLearn: true,
		spawnHighlight: 0,
	};
}

const MODEL_ROLES = ["Orchestrator", "Worker", "Reviewer"] as const;
const MAX_VISIBLE_MODELS = 10;

function modelForRole(state: OnboardingState, index: number): string {
	switch (index) {
		case 0:
			return state.orchestratorModel;
		case 1:
			return state.workerModel;
		case 2:
			return state.validatorModel;
		default:
			return "";
	}
}

function renderStepIndicator(step: number, style?: FrameStyle): string {
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const labels = ["Models", "Prompting", "Learn"];
	const parts: string[] = [];
	for (let i = 0; i < labels.length; i++) {
		if (i === step) {
			parts.push(af(`[${i + 1}. ${labels[i]}]`));
		} else if (i < step) {
			parts.push(mf(`\u2713 ${labels[i]}`));
		} else {
			parts.push(mf(`${i + 1}. ${labels[i]}`));
		}
	}
	return parts.join("  ");
}

function filterModels(models: string[], query: string): string[] {
	if (!query) return models;
	return fuzzyFilter(models, query, (m) => m);
}

function renderModelPicker(
	picker: ModelPickerState,
	availableModels: string[],
	_contentWidth: number,
	style?: FrameStyle,
): string[] {
	const tf = style?.textFn ?? ((t: string) => t);
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const lines: string[] = [];

	const role = MODEL_ROLES[picker.roleIndex];
	lines.push(bf(tf(`Select model for: ${role}`)));
	lines.push("");
	const cursor = picker.searchQuery || "";
	lines.push(`${mf("Search:")} ${tf(cursor)}${af("\u2588")}`);
	lines.push("");

	const filtered = filterModels(availableModels, picker.searchQuery);
	const visible = filtered.slice(0, MAX_VISIBLE_MODELS);
	for (let i = 0; i < visible.length; i++) {
		const pointer = i === picker.highlightedIndex ? af("\u25b8") : " ";
		const label = i === picker.highlightedIndex ? af(visible[i]) : tf(visible[i]);
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

	return lines;
}

function renderModelStep(state: OnboardingState, _contentWidth: number, style?: FrameStyle): string[] {
	const tf = style?.textFn ?? ((t: string) => t);
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const lines: string[] = [];

	lines.push(bf(tf("Select models for each role")));
	lines.push("");
	lines.push(mf("These defaults will apply to all future missions."));
	lines.push(mf("You can override per-mission later."));
	lines.push("");

	for (let i = 0; i < MODEL_ROLES.length; i++) {
		const role = MODEL_ROLES[i];
		const model = modelForRole(state, i);
		const isHighlighted = i === state.modelHighlight;
		const pointer = isHighlighted ? af("\u25b8") : " ";
		const label = isHighlighted ? af(`${role}: ${model}`) : tf(`${role}: ${model}`);
		lines.push(`${pointer} ${label}`);
	}

	lines.push("");
	lines.push(mf("Space: change model  \u2191\u2193: navigate  Enter: next"));
	return lines;
}

function renderPromptingStep(state: OnboardingState, _contentWidth: number, style?: FrameStyle): string[] {
	const tf = style?.textFn ?? ((t: string) => t);
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const lines: string[] = [];

	lines.push(bf(tf("Prompting style")));
	lines.push("");

	const options: Array<{ key: PromptingMode; label: string; desc: string }> = [
		{
			key: "caveman",
			label: "Caveman Micro",
			desc: "Compressed prompts + 1-line output rule (~30 tok).",
		},
		{
			key: "caveman-full",
			label: "Caveman Full",
			desc: "Compressed prompts + full official skill (~800 tok).",
		},
		{
			key: "default",
			label: "Default",
			desc: "Standard verbose prompts. No output compression.",
		},
	];

	for (let i = 0; i < options.length; i++) {
		const opt = options[i];
		const selected = state.promptingMode === opt.key;
		const highlighted = i === state.promptingHighlight;
		const radio = selected ? "\u25c9" : "\u25cb";
		const pointer = highlighted ? af("\u25b8") : " ";
		const styledRadio = selected ? af(radio) : highlighted ? tf(radio) : mf(radio);
		const styledLabel = highlighted ? af(opt.label) : tf(opt.label);
		const styledDesc = mf(opt.desc);
		lines.push(`${pointer} ${styledRadio} ${styledLabel}`);
		lines.push(`     ${styledDesc}`);
	}

	lines.push("");
	lines.push(mf("Space/Enter: select  \u2191\u2193: navigate"));
	return lines;
}

function renderSpawnLearnStep(state: OnboardingState, contentWidth: number, style?: FrameStyle): string[] {
	const tf = style?.textFn ?? ((t: string) => t);
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const wf = style?.warningFn ?? ((t: string) => t);
	const lines: string[] = [];

	lines.push(bf(tf("Spawn & Learn")));
	lines.push("");

	const descLines = wrapText(
		"Workers learn from completed tasks and persist knowledge across missions. Improves quality over time.",
		contentWidth - 2,
	);
	for (const dl of descLines) {
		lines.push(mf(dl));
	}
	lines.push("");
	lines.push(wf("\u26a0 Not yet implemented \u2014 this setting will take effect in a future update."));
	lines.push("");

	const options = [
		{ enabled: true, label: "Enabled", desc: "Workers learn and persist knowledge" },
		{ enabled: false, label: "Disabled", desc: "No cross-mission learning" },
	];

	for (let i = 0; i < options.length; i++) {
		const opt = options[i];
		const selected = state.spawnAndLearn === opt.enabled;
		const highlighted = i === state.spawnHighlight;
		const radio = selected ? "\u25c9" : "\u25cb";
		const pointer = highlighted ? af("\u25b8") : " ";
		const styledRadio = selected ? af(radio) : highlighted ? tf(radio) : mf(radio);
		const styledLabel = highlighted ? af(opt.label) : tf(opt.label);
		const styledDesc = mf(opt.desc);
		lines.push(`${pointer} ${styledRadio} ${styledLabel}`);
		lines.push(`     ${styledDesc}`);
	}

	lines.push("");
	lines.push(mf("Space/Enter: select  \u2191\u2193: navigate"));
	return lines;
}

export function renderOnboardingOverlay(
	state: OnboardingState,
	width: number,
	height: number,
	availableModels: string[],
	style?: FrameStyle,
): string[] {
	const contentWidth = width - 4;
	const bgFn = style?.bgFn;

	const stepLines: string[] = [];
	stepLines.push(renderStepIndicator(state.step, style));
	stepLines.push("");

	if (state.modelPicker) {
		stepLines.push(...renderModelPicker(state.modelPicker, availableModels, contentWidth, style));
	} else {
		switch (state.step) {
			case 0:
				stepLines.push(...renderModelStep(state, contentWidth, style));
				break;
			case 1:
				stepLines.push(...renderPromptingStep(state, contentWidth, style));
				break;
			case 2:
				stepLines.push(...renderSpawnLearnStep(state, contentWidth, style));
				break;
		}
	}

	const footerHeight = 3;
	const titleHeight = 1;
	const panelHeight = Math.max(5, height - footerHeight - titleHeight);

	const titleLine = titleBar("Mission Setup", width, style);
	const panelLines = panel("", stepLines, width, panelHeight, 0, style);

	let footerText: string;
	if (state.modelPicker) {
		footerText = "Type: filter  Enter: select  Esc: back";
	} else if (state.step === 2) {
		footerText = "Enter: finish setup  \u2190: back  Esc: cancel";
	} else if (state.step === 0) {
		footerText = "Space: change model  \u2191\u2193: navigate  Enter: next  Esc: cancel";
	} else {
		footerText = "Enter: next  \u2190: back  Esc: cancel";
	}
	const footerLines = footerBar(footerText, width, style);

	const styledTitle = bgFn ? applyBg(titleLine, width, bgFn) : titleLine;
	return [styledTitle, ...panelLines, ...footerLines];
}

export type OnboardingAction = { kind: "noop" } | { kind: "cancel" } | { kind: "done"; config: GlobalConfig };

function buildResult(state: OnboardingState): GlobalConfig {
	return {
		models: {
			orchestrator: state.orchestratorModel,
			worker: state.workerModel,
			validator: state.validatorModel,
		},
		promptingMode: state.promptingMode,
		spawnAndLearn: state.spawnAndLearn,
		onboardingCompleted: true,
	};
}

export function applyModelEdit(state: OnboardingState, roleIndex: number, value: string): void {
	const trimmed = value.trim();
	if (!trimmed) return;
	switch (roleIndex) {
		case 0:
			state.orchestratorModel = trimmed;
			break;
		case 1:
			state.workerModel = trimmed;
			break;
		case 2:
			state.validatorModel = trimmed;
			break;
	}
}

export function advanceFromModelStep(state: OnboardingState): void {
	state.step = 1;
	const modeToIndex: Record<PromptingMode, number> = { caveman: 0, "caveman-full": 1, default: 2 };
	state.promptingHighlight = modeToIndex[state.promptingMode] ?? 0;
}

function handleModelPickerKey(data: string, state: OnboardingState, availableModels: string[]): OnboardingAction {
	const picker = state.modelPicker!;

	if (matchesKey(data, "escape")) {
		state.modelPicker = null;
		return { kind: "noop" };
	}

	const filtered = filterModels(availableModels, picker.searchQuery);

	if (matchesKey(data, "return")) {
		const selected = filtered[picker.highlightedIndex];
		if (selected) {
			applyModelEdit(state, picker.roleIndex, selected);
			state.modelPicker = null;
		}
		return { kind: "noop" };
	}

	if (matchesKey(data, "up") || matchesKey(data, "k")) {
		picker.highlightedIndex = Math.max(0, picker.highlightedIndex - 1);
		return { kind: "noop" };
	}
	if (matchesKey(data, "down") || matchesKey(data, "j")) {
		const maxIdx = Math.min(filtered.length - 1, MAX_VISIBLE_MODELS - 1);
		picker.highlightedIndex = Math.min(Math.max(0, maxIdx), picker.highlightedIndex + 1);
		return { kind: "noop" };
	}

	if (matchesKey(data, "backspace")) {
		picker.searchQuery = picker.searchQuery.slice(0, -1);
		picker.highlightedIndex = 0;
		return { kind: "noop" };
	}

	if (data.length === 1 && data >= " ") {
		picker.searchQuery += data;
		picker.highlightedIndex = 0;
		return { kind: "noop" };
	}

	return { kind: "noop" };
}

function handleModelStepKey(data: string, state: OnboardingState): OnboardingAction {
	if (matchesKey(data, "up") || matchesKey(data, "k")) {
		state.modelHighlight = Math.max(0, state.modelHighlight - 1);
		return { kind: "noop" };
	}
	if (matchesKey(data, "down") || matchesKey(data, "j")) {
		state.modelHighlight = Math.min(2, state.modelHighlight + 1);
		return { kind: "noop" };
	}
	if (data === " ") {
		state.modelPicker = {
			roleIndex: state.modelHighlight,
			searchQuery: "",
			highlightedIndex: 0,
		};
		return { kind: "noop" };
	}
	if (matchesKey(data, "return")) {
		advanceFromModelStep(state);
		return { kind: "noop" };
	}
	return { kind: "noop" };
}

function handlePromptingStepKey(data: string, state: OnboardingState): OnboardingAction {
	if (matchesKey(data, "up") || matchesKey(data, "k")) {
		state.promptingHighlight = Math.max(0, state.promptingHighlight - 1);
		return { kind: "noop" };
	}
	if (matchesKey(data, "down") || matchesKey(data, "j")) {
		state.promptingHighlight = Math.min(2, state.promptingHighlight + 1);
		return { kind: "noop" };
	}
	if (data === " " || matchesKey(data, "return")) {
		const modes: PromptingMode[] = ["caveman", "caveman-full", "default"];
		state.promptingMode = modes[state.promptingHighlight] ?? "caveman";
		if (matchesKey(data, "return")) {
			state.step = 2;
			state.spawnHighlight = state.spawnAndLearn ? 0 : 1;
		}
		return { kind: "noop" };
	}
	return { kind: "noop" };
}

function handleSpawnLearnStepKey(data: string, state: OnboardingState): OnboardingAction {
	if (matchesKey(data, "up") || matchesKey(data, "k")) {
		state.spawnHighlight = Math.max(0, state.spawnHighlight - 1);
		return { kind: "noop" };
	}
	if (matchesKey(data, "down") || matchesKey(data, "j")) {
		state.spawnHighlight = Math.min(1, state.spawnHighlight + 1);
		return { kind: "noop" };
	}
	if (data === " ") {
		state.spawnAndLearn = state.spawnHighlight === 0;
		return { kind: "noop" };
	}
	if (matchesKey(data, "return")) {
		state.spawnAndLearn = state.spawnHighlight === 0;
		return { kind: "done", config: buildResult(state) };
	}
	return { kind: "noop" };
}

export function handleOnboardingKey(data: string, state: OnboardingState, availableModels: string[]): OnboardingAction {
	if (state.modelPicker) {
		return handleModelPickerKey(data, state, availableModels);
	}

	if (matchesKey(data, "escape")) {
		return { kind: "cancel" };
	}

	if (matchesKey(data, "left") && state.step > 0) {
		state.step = (state.step - 1) as 0 | 1;
		return { kind: "noop" };
	}

	switch (state.step) {
		case 0:
			return handleModelStepKey(data, state);
		case 1:
			return handlePromptingStepKey(data, state);
		case 2:
			return handleSpawnLearnStepKey(data, state);
	}
	return { kind: "noop" };
}

export class OnboardingOverlayComponent implements Component, Focusable {
	focused = false;
	private state: OnboardingState;
	private style: FrameStyle | undefined;
	private theme:
		| { fg: (...args: any[]) => string; bg: (...args: any[]) => string; bold: (text: string) => string }
		| undefined;
	private cachedWidth = 0;
	private cachedLines: string[] = [];
	private version = 0;
	private cachedVersion = -1;

	constructor(
		private tui: TUI,
		private done: (config: GlobalConfig | null) => void,
		private availableModels: string[],
		theme?: { fg: (...args: any[]) => string; bg: (...args: any[]) => string; bold: (text: string) => string },
	) {
		this.theme = theme;
		this.state = createInitialOnboardingState();
		this.style = theme ? themeFrameStyle(theme) : undefined;
	}

	handleInput(data: string): void {
		const action = handleOnboardingKey(data, this.state, this.availableModels);

		if (action.kind === "done") {
			this.done(action.config);
			return;
		}
		if (action.kind === "cancel") {
			this.done(null);
			return;
		}

		this.version++;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (width === this.cachedWidth && this.version === this.cachedVersion) return this.cachedLines;
		const height = this.tui.terminal.rows;
		const result = renderOnboardingOverlay(this.state, width, height, this.availableModels, this.style);
		this.cachedWidth = width;
		this.cachedLines = result;
		this.cachedVersion = this.version;
		return result;
	}

	invalidate(): void {
		this.cachedVersion = -1;
		if (this.theme) {
			this.style = themeFrameStyle(this.theme);
		}
	}

	dispose(): void {}
}
