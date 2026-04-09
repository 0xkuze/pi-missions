import { describe, expect, it } from "bun:test";
import { DEFAULT_ORCHESTRATOR_MODEL, DEFAULT_VALIDATOR_MODEL, DEFAULT_WORKER_MODEL } from "../../extensions/config.js";
import {
	advanceFromModelStep,
	applyModelEdit,
	createInitialOnboardingState,
	handleOnboardingKey,
	type OnboardingState,
	renderOnboardingOverlay,
} from "../../extensions/ui/onboarding-overlay.js";

const MODELS = [
	"anthropic/claude-opus-4-6",
	"opencode-go/glm-5",
	"anthropic/claude-opus-4-6",
	"claude-sonnet-4",
	"gpt-4o",
	"gemini-pro",
];

function makeState(overrides: Partial<OnboardingState> = {}): OnboardingState {
	return { ...createInitialOnboardingState(), ...overrides };
}

function key(data: string, state: OnboardingState): ReturnType<typeof handleOnboardingKey> {
	return handleOnboardingKey(data, state, MODELS);
}

describe("createInitialOnboardingState", () => {
	it("starts at step 0", () => {
		const state = createInitialOnboardingState();
		expect(state.step).toBe(0);
	});

	it("has default models", () => {
		const state = createInitialOnboardingState();
		expect(state.orchestratorModel).toBe(DEFAULT_ORCHESTRATOR_MODEL);
		expect(state.workerModel).toBe(DEFAULT_WORKER_MODEL);
		expect(state.validatorModel).toBe(DEFAULT_VALIDATOR_MODEL);
	});

	it("defaults to caveman prompting mode", () => {
		const state = createInitialOnboardingState();
		expect(state.promptingMode).toBe("caveman");
	});

	it("defaults to spawn and learn enabled", () => {
		const state = createInitialOnboardingState();
		expect(state.spawnAndLearn).toBe(true);
	});

	it("model picker starts as null", () => {
		const state = createInitialOnboardingState();
		expect(state.modelPicker).toBeNull();
	});
});

describe("renderOnboardingOverlay", () => {
	it("renders without crashing for all steps", () => {
		for (const step of [0, 1, 2] as const) {
			const state = makeState({ step });
			const lines = renderOnboardingOverlay(state, 80, 30, MODELS);
			expect(lines.length).toBeGreaterThan(0);
		}
	});

	it("step 0 shows model roles", () => {
		const state = makeState({ step: 0 });
		const text = renderOnboardingOverlay(state, 80, 30, MODELS).join("\n");
		expect(text).toContain("Orchestrator");
		expect(text).toContain("Worker");
		expect(text).toContain("Reviewer");
	});

	it("step 0 shows default model values", () => {
		const state = makeState({ step: 0 });
		const text = renderOnboardingOverlay(state, 80, 30, MODELS).join("\n");
		expect(text).toContain(DEFAULT_ORCHESTRATOR_MODEL);
		expect(text).toContain(DEFAULT_WORKER_MODEL);
		expect(text).toContain(DEFAULT_VALIDATOR_MODEL);
	});

	it("step 1 shows prompting options", () => {
		const state = makeState({ step: 1 });
		const text = renderOnboardingOverlay(state, 80, 30, MODELS).join("\n");
		expect(text).toContain("Caveman");
		expect(text).toContain("Default");
	});

	it("step 2 shows spawn and learn options", () => {
		const state = makeState({ step: 2 });
		const text = renderOnboardingOverlay(state, 80, 30, MODELS).join("\n");
		expect(text).toContain("Enabled");
		expect(text).toContain("Disabled");
		expect(text).toContain("Not yet implemented");
	});

	it("shows step indicator", () => {
		const state = makeState({ step: 0 });
		const text = renderOnboardingOverlay(state, 80, 30, MODELS).join("\n");
		expect(text).toContain("Models");
		expect(text).toContain("Prompting");
		expect(text).toContain("Learn");
	});

	it("shows Mission Setup title", () => {
		const state = makeState({ step: 0 });
		const text = renderOnboardingOverlay(state, 80, 30, MODELS).join("\n");
		expect(text).toContain("Mission Setup");
	});

	it("shows model picker when modelPicker is active", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 0, searchQuery: "", highlightedIndex: 0 },
		});
		const text = renderOnboardingOverlay(state, 80, 30, MODELS).join("\n");
		expect(text).toContain("Select model for: Orchestrator");
		expect(text).toContain("Search:");
		expect(text).toContain("anthropic/claude-opus-4-6");
	});

	it("model picker shows filtered results", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 1, searchQuery: "gpt", highlightedIndex: 0 },
		});
		const text = renderOnboardingOverlay(state, 80, 30, MODELS).join("\n");
		expect(text).toContain("gpt");
		expect(text).toContain("Select model for: Worker");
	});
});

describe("handleOnboardingKey — step 0 (models)", () => {
	it("escape cancels", () => {
		const state = makeState({ step: 0 });
		const action = key("\x1b", state);
		expect(action.kind).toBe("cancel");
	});

	it("down moves highlight", () => {
		const state = makeState({ step: 0, modelHighlight: 0 });
		key("\x1b[B", state);
		expect(state.modelHighlight).toBe(1);
	});

	it("up moves highlight", () => {
		const state = makeState({ step: 0, modelHighlight: 2 });
		key("\x1b[A", state);
		expect(state.modelHighlight).toBe(1);
	});

	it("highlight does not go below 0", () => {
		const state = makeState({ step: 0, modelHighlight: 0 });
		key("\x1b[A", state);
		expect(state.modelHighlight).toBe(0);
	});

	it("highlight does not go above 2", () => {
		const state = makeState({ step: 0, modelHighlight: 2 });
		key("\x1b[B", state);
		expect(state.modelHighlight).toBe(2);
	});

	it("enter advances to step 1", () => {
		const state = makeState({ step: 0 });
		const action = key("\r", state);
		expect(action.kind).toBe("noop");
		expect(state.step).toBe(1);
	});

	it("space opens model picker for highlighted role", () => {
		const state = makeState({ step: 0, modelHighlight: 1 });
		const action = key(" ", state);
		expect(action.kind).toBe("noop");
		expect(state.modelPicker).not.toBeNull();
		expect(state.modelPicker!.roleIndex).toBe(1);
		expect(state.modelPicker!.searchQuery).toBe("");
		expect(state.modelPicker!.highlightedIndex).toBe(0);
	});
});

describe("handleOnboardingKey — model picker", () => {
	it("escape closes picker without applying", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 0, searchQuery: "test", highlightedIndex: 0 },
		});
		const action = key("\x1b", state);
		expect(action.kind).toBe("noop");
		expect(state.modelPicker).toBeNull();
		expect(state.orchestratorModel).toBe(DEFAULT_ORCHESTRATOR_MODEL);
	});

	it("escape in picker does NOT cancel the whole overlay", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 0, searchQuery: "", highlightedIndex: 0 },
		});
		const action = key("\x1b", state);
		expect(action.kind).toBe("noop");
	});

	it("typing appends to search query", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 0, searchQuery: "", highlightedIndex: 0 },
		});
		key("g", state);
		expect(state.modelPicker!.searchQuery).toBe("g");
		key("p", state);
		expect(state.modelPicker!.searchQuery).toBe("gp");
		key("t", state);
		expect(state.modelPicker!.searchQuery).toBe("gpt");
	});

	it("typing resets highlightedIndex to 0", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 0, searchQuery: "", highlightedIndex: 3 },
		});
		key("a", state);
		expect(state.modelPicker!.highlightedIndex).toBe(0);
	});

	it("backspace removes last char from search query", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 0, searchQuery: "gpt", highlightedIndex: 0 },
		});
		key("\x7f", state);
		expect(state.modelPicker!.searchQuery).toBe("gp");
	});

	it("down moves highlight in picker", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 0, searchQuery: "", highlightedIndex: 0 },
		});
		key("\x1b[B", state);
		expect(state.modelPicker!.highlightedIndex).toBe(1);
	});

	it("up moves highlight in picker", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 0, searchQuery: "", highlightedIndex: 2 },
		});
		key("\x1b[A", state);
		expect(state.modelPicker!.highlightedIndex).toBe(1);
	});

	it("enter selects highlighted model and closes picker", () => {
		const state = makeState({
			step: 0,
			modelHighlight: 0,
			modelPicker: { roleIndex: 0, searchQuery: "", highlightedIndex: 2 },
		});
		const action = key("\r", state);
		expect(action.kind).toBe("noop");
		expect(state.modelPicker).toBeNull();
		expect(state.orchestratorModel).toBe(MODELS[2]);
	});

	it("enter applies to correct role (worker)", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 1, searchQuery: "", highlightedIndex: 0 },
		});
		key("\r", state);
		expect(state.workerModel).toBe(MODELS[0]);
	});

	it("enter applies to correct role (validator)", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 2, searchQuery: "", highlightedIndex: 1 },
		});
		key("\r", state);
		expect(state.validatorModel).toBe(MODELS[1]);
	});

	it("enter with no filtered results does nothing", () => {
		const state = makeState({
			step: 0,
			modelPicker: { roleIndex: 0, searchQuery: "zzzznonexistent", highlightedIndex: 0 },
		});
		key("\r", state);
		expect(state.modelPicker).not.toBeNull();
		expect(state.orchestratorModel).toBe(DEFAULT_ORCHESTRATOR_MODEL);
	});
});

describe("handleOnboardingKey — step 1 (prompting)", () => {
	it("down moves highlight", () => {
		const state = makeState({ step: 1, promptingHighlight: 0 });
		key("\x1b[B", state);
		expect(state.promptingHighlight).toBe(1);
	});

	it("space selects option without advancing", () => {
		const state = makeState({ step: 1, promptingHighlight: 2 });
		key(" ", state);
		expect(state.promptingMode).toBe("default");
		expect(state.step).toBe(1);
	});

	it("space on caveman-full selects it", () => {
		const state = makeState({ step: 1, promptingHighlight: 1 });
		key(" ", state);
		expect(state.promptingMode).toBe("caveman-full");
		expect(state.step).toBe(1);
	});

	it("enter selects and advances to step 2", () => {
		const state = makeState({ step: 1, promptingHighlight: 0 });
		key("\r", state);
		expect(state.promptingMode).toBe("caveman");
		expect(state.step).toBe(2);
	});

	it("left arrow goes back to step 0", () => {
		const state = makeState({ step: 1 });
		key("\x1b[D", state);
		expect(state.step).toBe(0);
	});
});

describe("handleOnboardingKey — step 2 (spawn & learn)", () => {
	it("space toggles selection without finishing", () => {
		const state = makeState({ step: 2, spawnHighlight: 1 });
		key(" ", state);
		expect(state.spawnAndLearn).toBe(false);
		expect(state.step).toBe(2);
	});

	it("enter selects and returns done", () => {
		const state = makeState({ step: 2, spawnHighlight: 0 });
		const action = key("\r", state);
		expect(action.kind).toBe("done");
		if (action.kind === "done") {
			expect(action.config.spawnAndLearn).toBe(true);
			expect(action.config.onboardingCompleted).toBe(true);
			expect(action.config.promptingMode).toBe("caveman");
		}
	});

	it("enter on disabled returns done with spawnAndLearn false", () => {
		const state = makeState({ step: 2, spawnHighlight: 1 });
		const action = key("\r", state);
		expect(action.kind).toBe("done");
		if (action.kind === "done") {
			expect(action.config.spawnAndLearn).toBe(false);
		}
	});

	it("done config includes model selections", () => {
		const state = makeState({ step: 2, orchestratorModel: "custom-orch", workerModel: "custom-work" });
		const action = key("\r", state);
		if (action.kind === "done") {
			expect(action.config.models!.orchestrator).toBe("custom-orch");
			expect(action.config.models!.worker).toBe("custom-work");
		}
	});

	it("left arrow goes back to step 1", () => {
		const state = makeState({ step: 2 });
		key("\x1b[D", state);
		expect(state.step).toBe(1);
	});
});

describe("applyModelEdit", () => {
	it("updates orchestrator model", () => {
		const state = makeState();
		applyModelEdit(state, 0, "new-orch");
		expect(state.orchestratorModel).toBe("new-orch");
	});

	it("updates worker model", () => {
		const state = makeState();
		applyModelEdit(state, 1, "new-worker");
		expect(state.workerModel).toBe("new-worker");
	});

	it("updates validator model", () => {
		const state = makeState();
		applyModelEdit(state, 2, "new-val");
		expect(state.validatorModel).toBe("new-val");
	});

	it("trims whitespace", () => {
		const state = makeState();
		applyModelEdit(state, 0, "  spaced  ");
		expect(state.orchestratorModel).toBe("spaced");
	});

	it("ignores empty string", () => {
		const state = makeState();
		applyModelEdit(state, 0, "");
		expect(state.orchestratorModel).toBe(DEFAULT_ORCHESTRATOR_MODEL);
	});

	it("ignores whitespace-only string", () => {
		const state = makeState();
		applyModelEdit(state, 0, "   ");
		expect(state.orchestratorModel).toBe(DEFAULT_ORCHESTRATOR_MODEL);
	});
});

describe("advanceFromModelStep", () => {
	it("moves to step 1", () => {
		const state = makeState({ step: 0 });
		advanceFromModelStep(state);
		expect(state.step).toBe(1);
	});

	it("sets prompting highlight to match current mode (caveman = 0)", () => {
		const state = makeState({ step: 0, promptingMode: "caveman" });
		advanceFromModelStep(state);
		expect(state.promptingHighlight).toBe(0);
	});

	it("sets prompting highlight to match current mode (default = 2)", () => {
		const state = makeState({ step: 0, promptingMode: "default" });
		advanceFromModelStep(state);
		expect(state.promptingHighlight).toBe(2);
	});

	it("sets prompting highlight to match current mode (caveman-full = 1)", () => {
		const state = makeState({ step: 0, promptingMode: "caveman-full" });
		advanceFromModelStep(state);
		expect(state.promptingHighlight).toBe(1);
	});
});

describe("full flow", () => {
	it("step 0 -> pick model via space -> enter to advance -> step 1 -> step 2 -> finish", () => {
		const state = makeState();

		// Step 0: space opens model picker for orchestrator (highlight 0)
		key(" ", state);
		expect(state.modelPicker).not.toBeNull();
		expect(state.modelPicker!.roleIndex).toBe(0);

		// Navigate to 3rd model and select
		key("\x1b[B", state);
		key("\x1b[B", state);
		key("\r", state);
		expect(state.modelPicker).toBeNull();
		expect(state.orchestratorModel).toBe(MODELS[2]);

		// Enter advances to step 1
		key("\r", state);
		expect(state.step).toBe(1);

		// Step 1: select caveman (already default), press enter to advance
		key("\r", state);
		expect(state.step).toBe(2);

		// Step 2: finish
		const action = key("\r", state);
		expect(action.kind).toBe("done");
		if (action.kind === "done") {
			expect(action.config.models!.orchestrator).toBe(MODELS[2]);
			expect(action.config.promptingMode).toBe("caveman");
			expect(action.config.spawnAndLearn).toBe(true);
			expect(action.config.onboardingCompleted).toBe(true);
		}
	});

	it("can go back through all steps", () => {
		const state = makeState();

		// Advance to step 1
		key("\r", state);
		expect(state.step).toBe(1);

		// Advance to step 2
		key("\r", state);
		expect(state.step).toBe(2);

		// Go back to step 1
		key("\x1b[D", state);
		expect(state.step).toBe(1);

		// Go back to step 0
		key("\x1b[D", state);
		expect(state.step).toBe(0);
	});
});
