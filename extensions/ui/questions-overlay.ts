import type { Component, Focusable, TUI } from "@mariozechner/pi-tui";
import { matchesKey } from "@mariozechner/pi-tui";
import type { Question, QuestionAnswer } from "../tools/ask-questions.js";
import type { FrameStyle } from "./frame.js";
import { applyBg, footerBar, panel, themeFrameStyle, titleBar, wrapText } from "./frame.js";

export interface QuestionsState {
	activeTab: number;
	selectedOptions: Set<number>[];
	customText: string[];
	editingCustom: boolean;
	highlightedIndex: number;
}

export function createInitialState(questionCount: number): QuestionsState {
	const selectedOptions: Set<number>[] = [];
	for (let i = 0; i < questionCount; i++) {
		selectedOptions.push(new Set());
	}
	return {
		activeTab: 0,
		selectedOptions,
		customText: new Array(questionCount).fill("") as string[],
		editingCustom: false,
		highlightedIndex: 0,
	};
}

function hasAnswer(state: QuestionsState, tabIndex: number): boolean {
	const selected = state.selectedOptions[tabIndex];
	if (selected && selected.size > 0) return true;
	if (state.customText[tabIndex]?.trim()) return true;
	return false;
}

export function renderTabBar(
	questions: Question[],
	activeTab: number,
	state: QuestionsState,
	_contentWidth: number,
	style?: FrameStyle,
): string {
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const sf = style?.successFn ?? ((t: string) => t);

	const tabs: string[] = [];
	for (let i = 0; i < questions.length; i++) {
		const label = `Q${i + 1}`;
		const answered = hasAnswer(state, i);
		if (i === activeTab) {
			tabs.push(bf(af(`[${label}]`)));
		} else if (answered) {
			tabs.push(sf(`[${label}]`));
		} else {
			tabs.push(mf(`[${label}]`));
		}
	}
	return tabs.join("  ");
}

function renderOptionLines(q: Question, state: QuestionsState, contentWidth: number, style?: FrameStyle): string[] {
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);
	const lines: string[] = [];
	const maxOptionWidth = contentWidth - 4;

	for (let i = 0; i < q.options.length; i++) {
		const selected = state.selectedOptions[state.activeTab];
		const isSelected = selected?.has(i) ?? false;
		const isHighlighted = state.highlightedIndex === i;
		const checkbox = isSelected ? "\u25a0" : "\u25a1";
		const recommended = q.recommended === i ? " (recommended)" : "";

		const pointer = isHighlighted ? af("\u25b8") : " ";
		const rawText = `${q.options[i]}${recommended}`;
		const wrapped = wrapText(rawText, maxOptionWidth);

		for (let wi = 0; wi < wrapped.length; wi++) {
			const wl = wrapped[wi];
			if (wi === 0) {
				const styledCb = isSelected ? af(checkbox) : isHighlighted ? tf(checkbox) : mf(checkbox);
				const styledText = isSelected || isHighlighted ? af(wl) : tf(wl);
				lines.push(`${pointer} ${styledCb} ${styledText}`);
			} else {
				const indent = "     ";
				const styledText = isSelected || isHighlighted ? af(wl) : tf(wl);
				lines.push(`${indent}${styledText}`);
			}
		}
	}

	return lines;
}

export function renderQuestionsOverlay(
	questions: Question[],
	state: QuestionsState,
	width: number,
	height: number,
	style?: FrameStyle,
): string[] {
	const contentWidth = width - 4;
	const af = style?.accentFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const tf = style?.textFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const bgFn = style?.bgFn;

	const q = questions[state.activeTab];
	if (!q) return [];

	const lines: string[] = [];

	const tabBar = renderTabBar(questions, state.activeTab, state, contentWidth, style);
	lines.push(tabBar);
	lines.push("");

	const wrappedQuestion = wrapText(q.question, contentWidth);
	for (const wl of wrappedQuestion) {
		lines.push(bf(tf(wl)));
	}
	lines.push("");

	lines.push(...renderOptionLines(q, state, contentWidth, style));

	lines.push("");
	const isCustomHighlighted = state.highlightedIndex === q.options.length;
	const isCustomActive = state.customText[state.activeTab]?.trim().length > 0;
	const customCheckbox = isCustomActive ? "\u25a0" : "\u25a1";
	const customPointer = isCustomHighlighted ? af("\u25b8") : " ";

	if (state.editingCustom) {
		const cursor = state.customText[state.activeTab] || "";
		lines.push(`${customPointer} ${af(customCheckbox)} ${af("Custom:")} ${tf(cursor)}${af("\u2588")}`);
	} else if (isCustomActive) {
		const wrappedCustom = wrapText(state.customText[state.activeTab], contentWidth - 12);
		for (let ci = 0; ci < wrappedCustom.length; ci++) {
			if (ci === 0) {
				lines.push(`${customPointer} ${af(customCheckbox)} ${af("Custom:")} ${tf(wrappedCustom[ci])}`);
			} else {
				lines.push(`              ${tf(wrappedCustom[ci])}`);
			}
		}
	} else {
		const label = isCustomHighlighted ? af("Custom answer") : tf("Custom answer");
		lines.push(`${customPointer} ${isCustomHighlighted ? tf(customCheckbox) : mf(customCheckbox)} ${label}`);
	}

	const footerHeight = 3;
	const titleHeight = 1;
	const panelHeight = Math.max(5, height - footerHeight - titleHeight);

	const titleLine = titleBar("Questions", width, style);
	const panelLines = panel("", lines, width, panelHeight, 0, style);

	const footer = state.editingCustom
		? "Enter: confirm text   Esc: cancel"
		: "Space: toggle   Enter: confirm   Tab: next Q   Esc: cancel";
	const footerLines = footerBar(footer, width, style);

	const styledTitle = bgFn ? applyBg(titleLine, width, bgFn) : titleLine;
	return [styledTitle, ...panelLines, ...footerLines];
}

export type QuestionsOverlayAction =
	| { kind: "noop" }
	| { kind: "cancel" }
	| { kind: "done"; answers: QuestionAnswer[] };

function buildAnswers(questions: Question[], state: QuestionsState): QuestionAnswer[] {
	return questions.map((q, i) => {
		const selected = state.selectedOptions[i];
		const customText = state.customText[i]?.trim() ?? "";
		const parts: string[] = [];

		if (selected) {
			for (const idx of selected) {
				if (q.options[idx]) parts.push(q.options[idx]);
			}
		}
		if (customText) parts.push(customText);

		if (parts.length === 0) {
			return { question: q.question, answer: "(skipped)", isCustom: false };
		}
		return {
			question: q.question,
			answer: parts.join("; "),
			isCustom: customText.length > 0,
		};
	});
}

function allAnswered(state: QuestionsState): boolean {
	return state.selectedOptions.every((sel, i) => {
		if (sel.size > 0) return true;
		if (state.customText[i]?.trim()) return true;
		return false;
	});
}

function advanceToNext(questions: Question[], state: QuestionsState): void {
	for (let i = 1; i <= questions.length; i++) {
		const idx = (state.activeTab + i) % questions.length;
		if (!hasAnswer(state, idx)) {
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
			if (state.customText[state.activeTab]?.trim()) {
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

	if (matchesKey(data, "escape")) {
		return { kind: "cancel" };
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

	if (matchesKey(data, "up") || matchesKey(data, "k")) {
		state.highlightedIndex = Math.max(0, state.highlightedIndex - 1);
		return { kind: "noop" };
	}

	if (matchesKey(data, "down") || matchesKey(data, "j")) {
		state.highlightedIndex = Math.min(maxIndex, state.highlightedIndex + 1);
		return { kind: "noop" };
	}

	if (data === " ") {
		if (state.highlightedIndex < q.options.length) {
			const selected = state.selectedOptions[state.activeTab]!;
			if (selected.has(state.highlightedIndex)) {
				selected.delete(state.highlightedIndex);
			} else {
				selected.add(state.highlightedIndex);
			}
		} else {
			state.editingCustom = true;
		}
		return { kind: "noop" };
	}

	if (matchesKey(data, "return")) {
		const selected = state.selectedOptions[state.activeTab]!;
		if (state.highlightedIndex === q.options.length) {
			state.editingCustom = true;
			return { kind: "noop" };
		}
		if (selected.size === 0) {
			selected.add(state.highlightedIndex);
		}
		if (allAnswered(state)) {
			return { kind: "done", answers: buildAnswers(questions, state) };
		}
		advanceToNext(questions, state);
		return { kind: "noop" };
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
