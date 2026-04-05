import { describe, expect, it } from "bun:test";
import type { Question } from "../../extensions/tools/ask-questions.js";
import {
	createInitialState,
	handleQuestionsKey,
	type QuestionsState,
	renderQuestionsOverlay,
	renderTabBar,
} from "../../extensions/ui/questions-overlay.js";

function makeQuestions(count = 3): Question[] {
	const qs: Question[] = [];
	for (let i = 0; i < count; i++) {
		qs.push({
			question: `Question ${i + 1}?`,
			options: [`Option A${i}`, `Option B${i}`, `Option C${i}`],
			recommended: 0,
		});
	}
	return qs;
}

function makeState(questionCount = 3): QuestionsState {
	return createInitialState(questionCount);
}

describe("renderQuestionsOverlay", () => {
	describe("basic rendering", () => {
		it("returns array of strings", () => {
			const lines = renderQuestionsOverlay(makeQuestions(), makeState(), 80, 40);
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});

		it("shows title bar with Questions", () => {
			const lines = renderQuestionsOverlay(makeQuestions(), makeState(), 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("Questions");
		});

		it("shows question text", () => {
			const lines = renderQuestionsOverlay(makeQuestions(), makeState(), 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("Question 1?");
		});

		it("shows answer options", () => {
			const lines = renderQuestionsOverlay(makeQuestions(), makeState(), 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("Option A0");
			expect(text).toContain("Option B0");
			expect(text).toContain("Option C0");
		});

		it("shows recommended marker", () => {
			const lines = renderQuestionsOverlay(makeQuestions(), makeState(), 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("recommended");
		});

		it("shows custom answer option", () => {
			const lines = renderQuestionsOverlay(makeQuestions(), makeState(), 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("Your own answer");
		});

		it("shows footer with shortcuts", () => {
			const lines = renderQuestionsOverlay(makeQuestions(), makeState(), 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("Tab");
			expect(text).toContain("Enter");
			expect(text).toContain("Esc");
		});

		it("shows editing footer when editing custom", () => {
			const state = makeState();
			state.editingCustom = true;
			state.highlightedIndex = 3;
			const lines = renderQuestionsOverlay(makeQuestions(), state, 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("Type");
		});

		it("shows radio buttons", () => {
			const lines = renderQuestionsOverlay(makeQuestions(), makeState(), 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("\u25cb");
		});

		it("shows filled radio for selected option", () => {
			const state = makeState();
			state.selectedOption[0] = 1;
			const lines = renderQuestionsOverlay(makeQuestions(), state, 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("\u25cf");
		});
	});

	describe("active tab content", () => {
		it("shows second question when activeTab is 1", () => {
			const state = makeState();
			state.activeTab = 1;
			const lines = renderQuestionsOverlay(makeQuestions(), state, 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("Question 2?");
			expect(text).toContain("Option A1");
		});
	});

	describe("custom text input", () => {
		it("shows cursor when editing custom", () => {
			const state = makeState();
			state.editingCustom = true;
			state.highlightedIndex = 3;
			const lines = renderQuestionsOverlay(makeQuestions(), state, 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("\u258e");
		});

		it("shows custom text content", () => {
			const state = makeState();
			state.customText[0] = "My custom";
			const lines = renderQuestionsOverlay(makeQuestions(), state, 80, 40);
			const text = lines.join(" ");
			expect(text).toContain("My custom");
		});
	});
});

describe("renderTabBar", () => {
	it("shows tab labels", () => {
		const qs = makeQuestions();
		const selectedOption = [-2, -2, -2];
		const result = renderTabBar(qs, 0, selectedOption);
		expect(result).toContain("Q1");
		expect(result).toContain("Q2");
		expect(result).toContain("Q3");
	});

	it("uses brackets around labels", () => {
		const qs = makeQuestions(2);
		const selectedOption = [-2, -2];
		const result = renderTabBar(qs, 0, selectedOption);
		expect(result).toContain("[Q1]");
		expect(result).toContain("[Q2]");
	});
});

describe("createInitialState", () => {
	it("creates state with correct number of questions", () => {
		const state = createInitialState(4);
		expect(state.selectedOption).toHaveLength(4);
		expect(state.customText).toHaveLength(4);
		expect(state.activeTab).toBe(0);
		expect(state.editingCustom).toBe(false);
		expect(state.highlightedIndex).toBe(0);
	});

	it("initializes all options to no selection", () => {
		const state = createInitialState(3);
		for (const sel of state.selectedOption) {
			expect(sel).toBe(-2);
		}
	});

	it("initializes all custom text to empty", () => {
		const state = createInitialState(3);
		for (const text of state.customText) {
			expect(text).toBe("");
		}
	});
});

describe("handleQuestionsKey", () => {
	describe("tab navigation", () => {
		it("Tab advances to next question", () => {
			const state = makeState();
			handleQuestionsKey("\t", makeQuestions(), state);
			expect(state.activeTab).toBe(1);
		});

		it("Tab wraps around", () => {
			const state = makeState();
			state.activeTab = 2;
			handleQuestionsKey("\t", makeQuestions(), state);
			expect(state.activeTab).toBe(0);
		});

		it("Shift+Tab goes to previous question", () => {
			const state = makeState();
			state.activeTab = 1;
			handleQuestionsKey("\x1B[Z", makeQuestions(), state);
			expect(state.activeTab).toBe(0);
		});

		it("Shift+Tab wraps around", () => {
			const state = makeState();
			state.activeTab = 0;
			handleQuestionsKey("\x1B[Z", makeQuestions(), state);
			expect(state.activeTab).toBe(2);
		});

		it("Right arrow advances tab", () => {
			const state = makeState();
			handleQuestionsKey("\x1B[C", makeQuestions(), state);
			expect(state.activeTab).toBe(1);
		});

		it("Right arrow does not go past last tab", () => {
			const state = makeState();
			state.activeTab = 2;
			handleQuestionsKey("\x1B[C", makeQuestions(), state);
			expect(state.activeTab).toBe(2);
		});

		it("Left arrow goes to previous tab", () => {
			const state = makeState();
			state.activeTab = 2;
			handleQuestionsKey("\x1B[D", makeQuestions(), state);
			expect(state.activeTab).toBe(1);
		});

		it("Left arrow does not go below 0", () => {
			const state = makeState();
			state.activeTab = 0;
			handleQuestionsKey("\x1B[D", makeQuestions(), state);
			expect(state.activeTab).toBe(0);
		});

		it("tab navigation resets highlighted index", () => {
			const state = makeState();
			state.highlightedIndex = 2;
			handleQuestionsKey("\t", makeQuestions(), state);
			expect(state.highlightedIndex).toBe(0);
		});
	});

	describe("option navigation", () => {
		it("Down arrow moves to next option", () => {
			const state = makeState();
			handleQuestionsKey("\x1B[B", makeQuestions(), state);
			expect(state.highlightedIndex).toBe(1);
		});

		it("Down arrow stops at custom option", () => {
			const qs = makeQuestions();
			const state = makeState();
			state.highlightedIndex = qs[0].options.length;
			handleQuestionsKey("\x1B[B", qs, state);
			expect(state.highlightedIndex).toBe(qs[0].options.length);
		});

		it("Up arrow moves to previous option", () => {
			const state = makeState();
			state.highlightedIndex = 2;
			handleQuestionsKey("\x1B[A", makeQuestions(), state);
			expect(state.highlightedIndex).toBe(1);
		});

		it("Up arrow does not go below 0", () => {
			const state = makeState();
			state.highlightedIndex = 0;
			handleQuestionsKey("\x1B[A", makeQuestions(), state);
			expect(state.highlightedIndex).toBe(0);
		});
	});

	describe("option selection", () => {
		it("Enter selects pre-defined option", () => {
			const state = makeState();
			state.highlightedIndex = 1;
			handleQuestionsKey("\r", makeQuestions(), state);
			expect(state.selectedOption[0]).toBe(1);
		});

		it("Enter on custom option starts editing", () => {
			const qs = makeQuestions();
			const state = makeState();
			state.highlightedIndex = qs[0].options.length;
			handleQuestionsKey("\r", qs, state);
			expect(state.editingCustom).toBe(true);
		});

		it("selecting an option auto-advances to next unanswered question", () => {
			const state = makeState();
			state.highlightedIndex = 0;
			handleQuestionsKey("\r", makeQuestions(), state);
			expect(state.activeTab).toBe(1);
		});

		it("does not auto-advance when all questions answered", () => {
			const qs = makeQuestions(1);
			const state = createInitialState(1);
			state.highlightedIndex = 0;
			const action = handleQuestionsKey("\r", qs, state);
			expect(action.kind).toBe("done");
		});
	});

	describe("custom answer editing", () => {
		it("typing appends to custom text", () => {
			const state = makeState();
			state.editingCustom = true;
			handleQuestionsKey("a", makeQuestions(), state);
			expect(state.customText[0]).toBe("a");
		});

		it("backspace removes last character", () => {
			const state = makeState();
			state.editingCustom = true;
			state.customText[0] = "abc";
			handleQuestionsKey("\x7F", makeQuestions(), state);
			expect(state.customText[0]).toBe("ab");
		});

		it("Escape stops editing", () => {
			const state = makeState();
			state.editingCustom = true;
			handleQuestionsKey("\x1B", makeQuestions(), state);
			expect(state.editingCustom).toBe(false);
		});

		it("Enter confirms custom answer and selects it", () => {
			const state = makeState();
			state.editingCustom = true;
			state.customText[0] = "My answer";
			handleQuestionsKey("\r", makeQuestions(), state);
			expect(state.editingCustom).toBe(false);
			expect(state.selectedOption[0]).toBe(-1);
		});

		it("Enter on empty custom does not select", () => {
			const state = makeState();
			state.editingCustom = true;
			state.customText[0] = "";
			handleQuestionsKey("\r", makeQuestions(), state);
			expect(state.editingCustom).toBe(false);
			expect(state.selectedOption[0]).toBe(-2);
		});

		it("Enter on whitespace-only custom does not select", () => {
			const state = makeState();
			state.editingCustom = true;
			state.customText[0] = "   ";
			handleQuestionsKey("\r", makeQuestions(), state);
			expect(state.selectedOption[0]).toBe(-2);
		});
	});

	describe("completion", () => {
		it("returns done when all questions are answered", () => {
			const qs = makeQuestions(2);
			const state = createInitialState(2);
			state.selectedOption[0] = 0;
			state.activeTab = 1;
			state.highlightedIndex = 1;
			const action = handleQuestionsKey("\r", qs, state);
			expect(action.kind).toBe("done");
			if (action.kind === "done") {
				expect(action.answers).toHaveLength(2);
				expect(action.answers[0].answer).toBe("Option A0");
				expect(action.answers[0].isCustom).toBe(false);
				expect(action.answers[1].answer).toBe("Option B1");
			}
		});

		it("returns done with custom answers", () => {
			const qs = makeQuestions(1);
			const state = createInitialState(1);
			state.editingCustom = true;
			state.customText[0] = "My custom";
			const action = handleQuestionsKey("\r", qs, state);
			expect(action.kind).toBe("done");
			if (action.kind === "done") {
				expect(action.answers[0].answer).toBe("My custom");
				expect(action.answers[0].isCustom).toBe(true);
			}
		});
	});

	describe("cancel", () => {
		it("Escape returns cancel when not editing", () => {
			const state = makeState();
			const action = handleQuestionsKey("\x1B", makeQuestions(), state);
			expect(action.kind).toBe("cancel");
		});

		it("Escape while editing stops editing instead of cancelling", () => {
			const state = makeState();
			state.editingCustom = true;
			const action = handleQuestionsKey("\x1B", makeQuestions(), state);
			expect(action.kind).toBe("noop");
			expect(state.editingCustom).toBe(false);
		});
	});

	describe("returns noop for unhandled keys", () => {
		it("random character returns noop", () => {
			const action = handleQuestionsKey("x", makeQuestions(), makeState());
			expect(action.kind).toBe("noop");
		});
	});
});
