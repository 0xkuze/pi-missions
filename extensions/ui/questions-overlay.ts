import type { Component, Focusable, TUI } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import type { Question, QuestionAnswer } from "../tools/ask-questions.js";
import type { FrameStyle } from "./frame.js";
import { footerBar, panel, themeFrameStyle, titleBar } from "./frame.js";

const NO_SELECTION = -2;
const CUSTOM_SELECTION = -1;

export interface QuestionsState {
	activeTab: number;
	selectedOption: number[];
	customText: string[];
	editingCustom: boolean;
	highlightedIndex: number;
}

export function createInitialState(questionCount: number): QuestionsState {
	return {
		activeTab: 0,
		selectedOption: new Array(questionCount).fill(NO_SELECTION) as number[],
		customText: new Array(questionCount).fill("") as string[],
		editingCustom: false,
		highlightedIndex: 0,
	};
}

export function renderTabBar(
	questions: Question[],
	activeTab: number,
	selectedOption: number[],
	style?: FrameStyle,
): string {
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const sf = style?.successFn ?? ((t: string) => t);

	const tabs: string[] = [];
	for (let i = 0; i < questions.length; i++) {
		const label = `Q${i + 1}`;
		const hasAnswer = selectedOption[i] !== NO_SELECTION;
		if (i === activeTab) {
			tabs.push(bf(af(`[${label}]`)));
		} else if (hasAnswer) {
			tabs.push(sf(`[${label}]`));
		} else {
			tabs.push(mf(`[${label}]`));
		}
	}
	return ` ${tabs.join("  ")}`;
}

export function renderQuestionsOverlay(
	questions: Question[],
	state: QuestionsState,
	width: number,
	height: number,
	style?: FrameStyle,
): string[] {
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);

	const output: string[] = [];

	output.push(titleBar("Questions", width, style));
	output.push(renderTabBar(questions, state.activeTab, state.selectedOption, style));
	output.push("");

	const q = questions[state.activeTab];
	if (!q) return output;

	const lines: string[] = [];
	lines.push(tf(q.question));
	lines.push("");

	for (let i = 0; i < q.options.length; i++) {
		const isSelected = state.selectedOption[state.activeTab] === i;
		const isHighlighted = state.highlightedIndex === i;
		const icon = isSelected ? "●" : "○";
		const recommended = q.recommended === i ? mf(" (recommended)") : "";
		const optionText = `${icon} ${q.options[i]}${recommended}`;
		if (isHighlighted) {
			lines.push(af(optionText));
		} else if (isSelected) {
			lines.push(af(optionText));
		} else {
			lines.push(tf(optionText));
		}
	}

	lines.push("");
	const isCustomSelected = state.selectedOption[state.activeTab] === CUSTOM_SELECTION;
	const isCustomHighlighted = state.highlightedIndex === q.options.length;
	const customIcon = isCustomSelected ? "●" : "○";
	let customLabel: string;
	if (state.editingCustom) {
		customLabel = `${customIcon} Your own answer: ${state.customText[state.activeTab]}▎`;
	} else if (state.customText[state.activeTab]) {
		customLabel = `${customIcon} Your own answer: ${state.customText[state.activeTab]}`;
	} else {
		customLabel = `${customIcon} Your own answer`;
	}

	if (isCustomHighlighted || isCustomSelected) {
		lines.push(af(customLabel));
	} else {
		lines.push(tf(customLabel));
	}

	const panelHeight = Math.max(5, height - 7);
	output.push(...panel("Question", lines, width, panelHeight, 0, style));

	const footer = state.editingCustom
		? "Type: enter text  Enter: confirm  Esc: cancel editing"
		: "Tab: Next Q  Shift+Tab: Prev Q  Up/Down: Navigate  Enter: Select  Esc: Cancel";
	output.push(...footerBar(footer, width, style));

	return output;
}

export type QuestionsOverlayAction =
	| { kind: "noop" }
	| { kind: "cancel" }
	| { kind: "done"; answers: QuestionAnswer[] };

function buildAnswers(questions: Question[], state: QuestionsState): QuestionAnswer[] {
	return questions.map((q, i) => {
		const sel = state.selectedOption[i];
		if (sel === CUSTOM_SELECTION) {
			return { question: q.question, answer: state.customText[i], isCustom: true };
		}
		return { question: q.question, answer: q.options[sel] ?? "", isCustom: false };
	});
}

function allAnswered(state: QuestionsState): boolean {
	return state.selectedOption.every((sel, i) => {
		if (sel === NO_SELECTION) return false;
		if (sel === CUSTOM_SELECTION && !state.customText[i].trim()) return false;
		return true;
	});
}

function advanceToNext(questions: Question[], state: QuestionsState): void {
	for (let i = 1; i <= questions.length; i++) {
		const idx = (state.activeTab + i) % questions.length;
		if (state.selectedOption[idx] === NO_SELECTION) {
			state.activeTab = idx;
			state.highlightedIndex = 0;
			return;
		}
	}
}

export function handleQuestionsKey(data: string, questions: Question[], state: QuestionsState): QuestionsOverlayAction {
	if (state.editingCustom) {
		if (matchesKey(data, "escape")) {
			state.editingCustom = false;
			return { kind: "noop" };
		}
		if (matchesKey(data, "return")) {
			state.editingCustom = false;
			if (state.customText[state.activeTab].trim()) {
				state.selectedOption[state.activeTab] = CUSTOM_SELECTION;
				if (allAnswered(state)) {
					return { kind: "done", answers: buildAnswers(questions, state) };
				}
				advanceToNext(questions, state);
			}
			return { kind: "noop" };
		}
		if (matchesKey(data, "backspace")) {
			const tab = state.activeTab;
			state.customText[tab] = state.customText[tab].slice(0, -1);
			return { kind: "noop" };
		}
		if (data.length === 1 && data >= " ") {
			const tab = state.activeTab;
			state.customText[tab] += data;
			return { kind: "noop" };
		}
		return { kind: "noop" };
	}

	if (data === "\t") {
		state.activeTab = (state.activeTab + 1) % questions.length;
		state.highlightedIndex = 0;
		return { kind: "noop" };
	}

	if (matchesKey(data, "shift+tab")) {
		state.activeTab = (state.activeTab - 1 + questions.length) % questions.length;
		state.highlightedIndex = 0;
		return { kind: "noop" };
	}

	if (matchesKey(data, "right")) {
		state.activeTab = Math.min(questions.length - 1, state.activeTab + 1);
		state.highlightedIndex = 0;
		return { kind: "noop" };
	}

	if (matchesKey(data, "left")) {
		state.activeTab = Math.max(0, state.activeTab - 1);
		state.highlightedIndex = 0;
		return { kind: "noop" };
	}

	const q = questions[state.activeTab];
	if (!q) return { kind: "noop" };
	const maxIndex = q.options.length;

	if (matchesKey(data, "up")) {
		state.highlightedIndex = Math.max(0, state.highlightedIndex - 1);
		return { kind: "noop" };
	}

	if (matchesKey(data, "down")) {
		state.highlightedIndex = Math.min(maxIndex, state.highlightedIndex + 1);
		return { kind: "noop" };
	}

	if (matchesKey(data, "return")) {
		if (state.highlightedIndex < q.options.length) {
			state.selectedOption[state.activeTab] = state.highlightedIndex;
			if (allAnswered(state)) {
				return { kind: "done", answers: buildAnswers(questions, state) };
			}
			advanceToNext(questions, state);
		} else {
			state.editingCustom = true;
		}
		return { kind: "noop" };
	}

	if (matchesKey(data, "escape")) {
		return { kind: "cancel" };
	}

	return { kind: "noop" };
}

export class QuestionsOverlayComponent implements Component, Focusable {
	focused = false;
	private state: QuestionsState;
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
		private done: (answers: QuestionAnswer[] | null) => void,
		private questions: Question[],
		theme?: { fg: (...args: any[]) => string; bg: (...args: any[]) => string; bold: (text: string) => string },
	) {
		this.theme = theme;
		this.state = createInitialState(questions.length);
		this.style = theme ? themeFrameStyle(theme) : undefined;
	}

	handleInput(data: string): void {
		const action = handleQuestionsKey(data, this.questions, this.state);
		if (action.kind === "done") {
			this.done(action.answers);
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
		const result = renderQuestionsOverlay(this.questions, this.state, width, height, this.style);
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
