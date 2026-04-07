import { describe, expect, it } from "bun:test";
import type { Feature, Milestone, MissionConfig, MissionPlan, MissionState } from "../../extensions/types.js";
import {
	handleModelViewKey,
	handleReportViewKey,
	type ModelViewState,
	type ReportViewAction,
	renderModelView,
	renderReportView,
} from "../../extensions/ui/report-view.js";
import { nowISO } from "../../extensions/utils.js";
import { makeFeature as _sf, makeMilestone as _sm, makePlan as _sp, makeState as _ss } from "../helpers/index.js";

function makeFeature(id: string, status: Feature["status"], name?: string, overrides: Partial<Feature> = {}): Feature {
	return _sf({ id, name: name ?? `Feature ${id}`, status, ...overrides });
}

function makeMilestone(id: string, features: Feature[], status: Milestone["status"] = "pending"): Milestone {
	return _sm({ id, name: `Milestone ${id}`, features, status });
}

function makePlan(milestones: Milestone[]): MissionPlan {
	return _sp({ milestones });
}

function makeState(overrides: Partial<MissionState> = {}): MissionState {
	return _ss({ status: "completed", startedAt: new Date(Date.now() - 60_000).toISOString(), ...overrides });
}

describe("renderReportView (VAL-UI-010)", () => {
	describe("mission goal", () => {
		it("shows plan description as goal", () => {
			const plan = makePlan([]);
			plan.description = "Build an authentication system";
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Build an authentication system");
		});

		it("shows a 'Mission' or 'Goal' heading", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toMatch(/Mission|Goal/i);
		});
	});

	describe("duration", () => {
		it("shows formatted duration", () => {
			const plan = makePlan([]);
			const startedAt = new Date(Date.now() - 3661_000).toISOString();
			const completedAt = nowISO();
			const state = makeState({ startedAt, completedAt });
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toMatch(/1h|duration/i);
		});

		it("shows duration with minutes", () => {
			const plan = makePlan([]);
			const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
			const completedAt = nowISO();
			const state = makeState({ startedAt, completedAt });
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toMatch(/5m|5 min/i);
		});
	});

	describe("feature counts", () => {
		it("shows completed feature count", () => {
			const plan = makePlan([]);
			const state = makeState({ totalFeaturesCompleted: 5 });
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("5");
		});

		it("shows skipped feature count when non-zero", () => {
			const plan = makePlan([]);
			const state = makeState({ totalFeaturesSkipped: 2 });
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("2");
		});

		it("shows fix feature count when non-zero", () => {
			const plan = makePlan([]);
			const state = makeState({ totalFixFeaturesCreated: 1 });
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("1");
		});

		it("shows counts in a summary line or labeled section", () => {
			const plan = makePlan([]);
			const state = makeState({
				totalFeaturesCompleted: 4,
				totalFeaturesSkipped: 1,
				totalFixFeaturesCreated: 2,
			});
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("4");
			expect(text).toContain("1");
			expect(text).toContain("2");
		});
	});

	describe("validation summary", () => {
		it("shows validation summary with milestone counts", () => {
			const plan = makePlan([
				makeMilestone("m1", [makeFeature("f1", "done")], "done"),
				makeMilestone("m2", [makeFeature("f2", "done")], "done"),
			]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toMatch(/2|milestone/i);
		});

		it("shows milestone pass count", () => {
			const plan = makePlan([makeMilestone("m1", [], "done"), makeMilestone("m2", [], "pending")]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toMatch(/1.*2|milestone/i);
		});
	});

	describe("output artifact paths", () => {
		it("shows path to report.md", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("report.md");
		});

		it("includes the basePath in artifact path", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/my/custom/path", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("/my/custom/path");
		});
	});

	describe("keyboard hints", () => {
		it("shows O key hint for opening report", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toMatch(/O.*report|O.*open/i);
		});

		it("shows Esc key hint for closing", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Esc");
		});
	});

	describe("overall output", () => {
		it("returns a non-empty array of strings", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});

		it("returns strings, not nested arrays", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions", 80, undefined, 40);
			for (const line of lines) {
				expect(typeof line).toBe("string");
			}
		});
	});
});

describe("handleReportViewKey (VAL-UI-010)", () => {
	it("returns close action for Esc key", () => {
		const action: ReportViewAction = handleReportViewKey("\x1B");
		expect(action.kind).toBe("close");
	});

	it("returns open_report action for O key (lowercase)", () => {
		const action: ReportViewAction = handleReportViewKey("o");
		expect(action.kind).toBe("open_report");
	});

	it("returns open_report action for O key (uppercase)", () => {
		const action: ReportViewAction = handleReportViewKey("O");
		expect(action.kind).toBe("open_report");
	});

	it("returns noop for unrecognized keys", () => {
		const action: ReportViewAction = handleReportViewKey("x");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for Enter key", () => {
		const action: ReportViewAction = handleReportViewKey("\r");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for numeric keys", () => {
		const action: ReportViewAction = handleReportViewKey("1");
		expect(action.kind).toBe("noop");
	});
});

describe("renderModelView (VAL-UI-011)", () => {
	const roles = ["orchestrator", "worker", "validator"] as const;

	describe("showing current assignments", () => {
		it("shows all three roles", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n");
			expect(text.toLowerCase()).toContain("orchestrator");
			expect(text.toLowerCase()).toContain("worker");
			expect(text.toLowerCase()).toContain("validator");
		});

		it("shows current orchestrator model when assigned", () => {
			const config: MissionConfig = { models: { orchestrator: "claude-opus" } };
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n");
			expect(text).toContain("claude-opus");
		});

		it("shows current worker model from plan.modelAssignment when not in config", () => {
			const config: MissionConfig = {};
			const plan = {
				...makePlan([]),
				modelAssignment: { worker: "gpt-4o" },
			};
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n");
			expect(text).toContain("gpt-4o");
		});

		it("shows default model names when no explicit model configured", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n");
			expect(text).toContain("opus-4.6");
			expect(text).toContain("opencode-go/glm-5");
			expect(text).toContain("openaicodex/gpt-5.4");
		});
	});

	describe("role selection state", () => {
		it("shows selection indicator for highlighted role", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n");
			expect(text).toContain(">");
		});

		it("shows search prompt when role is selected", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: 0, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, ["model-a"], 40);
			const text = lines.join("\n");
			expect(text).toMatch(/search/i);
		});

		it("shows all roles when none selected (role selection mode)", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n");
			for (const role of roles) {
				expect(text.toLowerCase()).toContain(role);
			}
		});
	});

	describe("keyboard hints", () => {
		it("shows Esc hint", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n");
			expect(text).toContain("Esc");
		});
	});

	describe("edge cases", () => {
		it("returns non-empty array", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});
	});
});

describe("handleModelViewKey (VAL-UI-011)", () => {
	describe("Esc closes model view", () => {
		it("returns close action for Esc", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("\x1B", viewState, []);
			expect(result.action.kind).toBe("close");
		});
	});

	describe("role selection (no role selected)", () => {
		it("pressing 1 selects first role (index 0)", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("1", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBe(0);
			expect(result.action.kind).toBe("noop");
		});

		it("pressing 2 selects second role (index 1)", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("2", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBe(1);
			expect(result.action.kind).toBe("noop");
		});

		it("pressing 3 selects third role (index 2)", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("3", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBe(2);
			expect(result.action.kind).toBe("noop");
		});

		it("pressing out-of-range number returns noop", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("9", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBeNull();
			expect(result.action.kind).toBe("noop");
		});
	});

	describe("model selection (role selected)", () => {
		it("Enter selects the highlighted model", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0, searchQuery: "", highlightedIndex: 0 };
			const models = ["claude-opus", "claude-sonnet"];
			const result = handleModelViewKey("\r", viewState, models);
			expect(result.action.kind).toBe("select_model");
			if (result.action.kind === "select_model") {
				expect(result.action.roleIndex).toBe(0);
				expect(result.action.model).toBe("claude-opus");
			}
		});

		it("arrow down then Enter selects second model", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 1, searchQuery: "", highlightedIndex: 1 };
			const models = ["model-a", "model-b", "model-c"];
			const result = handleModelViewKey("\r", viewState, models);
			expect(result.action.kind).toBe("select_model");
			if (result.action.kind === "select_model") {
				expect(result.action.roleIndex).toBe(1);
				expect(result.action.model).toBe("model-b");
			}
		});

		it("typing adds to search query", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0, searchQuery: "", highlightedIndex: 0 };
			const models = ["model-a"];
			const result = handleModelViewKey("m", viewState, models);
			expect(result.action.kind).toBe("noop");
			expect(result.nextViewState.searchQuery).toBe("m");
		});

		it("backspace removes from search query", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0, searchQuery: "cl", highlightedIndex: 0 };
			const result = handleModelViewKey("\x7F", viewState, []);
			expect(result.nextViewState.searchQuery).toBe("c");
		});

		it("after model selection view state resets selectedRoleIndex to null", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0, searchQuery: "", highlightedIndex: 0 };
			const models = ["claude-opus"];
			const result = handleModelViewKey("\r", viewState, models);
			expect(result.nextViewState.selectedRoleIndex).toBeNull();
		});

		it("pressing Esc when role is selected goes back to role selection", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("\x1B", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBeNull();
			expect(result.action.kind).toBe("noop");
		});

		it("Enter on empty filtered list is noop", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0, searchQuery: "zzz", highlightedIndex: 0 };
			const result = handleModelViewKey("\r", viewState, ["model-a"]);
			expect(result.action.kind).toBe("noop");
		});
	});

	describe("arrow navigation in role selection", () => {
		it("down arrow moves highlight down", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("\x1B[B", viewState, []);
			expect(result.nextViewState.highlightedIndex).toBe(1);
		});

		it("up arrow does not go below 0", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("\x1B[A", viewState, []);
			expect(result.nextViewState.highlightedIndex).toBe(0);
		});

		it("Enter on highlighted role opens model selection", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 1 };
			const result = handleModelViewKey("\r", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBe(1);
		});
	});

	describe("unknown keys", () => {
		it("returns noop for letter keys when in role selection", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("a", viewState, []);
			expect(result.action.kind).toBe("noop");
		});
	});
});
