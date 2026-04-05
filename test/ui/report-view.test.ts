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

function makeFeature(id: string, status: Feature["status"], name?: string, overrides: Partial<Feature> = {}): Feature {
	return {
		id,
		name: name ?? `Feature ${id}`,
		description: "A feature",
		acceptanceCriteria: ["criterion 1"],
		relevantFiles: [],
		dependencies: [],
		estimatedComplexity: "low",
		status,
		attempts: [],
		...overrides,
	};
}

function makeMilestone(id: string, features: Feature[], status: Milestone["status"] = "pending"): Milestone {
	return {
		id,
		name: `Milestone ${id}`,
		description: "A milestone",
		features,
		status,
	};
}

function makePlan(milestones: Milestone[]): MissionPlan {
	return {
		id: "plan-1",
		description: "Build an authentication system",
		planVersion: 1,
		milestones,
		validationCommands: [],
		modelAssignment: {},
		createdAt: nowISO(),
	};
}

function makeState(overrides: Partial<MissionState> = {}): MissionState {
	const startedAt = new Date(Date.now() - 3600_000).toISOString();
	return {
		missionId: "mission-1",
		status: "completed",
		progressLog: [],
		startedAt,
		completedAt: nowISO(),
		totalFeaturesCompleted: 3,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 1,
		totalFixFeaturesCreated: 0,
		...overrides,
	};
}

describe("renderReportView (VAL-UI-010)", () => {
	describe("mission goal", () => {
		it("shows plan description as goal", () => {
			const plan = makePlan([]);
			plan.description = "Build an authentication system";
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			const text = lines.join("\n");
			expect(text).toContain("Build an authentication system");
		});

		it("shows a 'Mission' or 'Goal' heading", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
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
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			const text = lines.join("\n");
			expect(text).toMatch(/1h|duration/i);
		});

		it("shows duration with minutes", () => {
			const plan = makePlan([]);
			const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
			const completedAt = nowISO();
			const state = makeState({ startedAt, completedAt });
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			const text = lines.join("\n");
			expect(text).toMatch(/5m|5 min/i);
		});
	});

	describe("feature counts", () => {
		it("shows completed feature count", () => {
			const plan = makePlan([]);
			const state = makeState({ totalFeaturesCompleted: 5 });
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			const text = lines.join("\n");
			expect(text).toContain("5");
		});

		it("shows skipped feature count when non-zero", () => {
			const plan = makePlan([]);
			const state = makeState({ totalFeaturesSkipped: 2 });
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			const text = lines.join("\n");
			expect(text).toContain("2");
		});

		it("shows fix feature count when non-zero", () => {
			const plan = makePlan([]);
			const state = makeState({ totalFixFeaturesCreated: 1 });
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
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
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
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
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			const text = lines.join("\n");
			expect(text).toMatch(/2|milestone/i);
		});

		it("shows milestone pass count", () => {
			const plan = makePlan([makeMilestone("m1", [], "done"), makeMilestone("m2", [], "pending")]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			const text = lines.join("\n");
			expect(text).toMatch(/1.*2|milestone/i);
		});
	});

	describe("output artifact paths", () => {
		it("shows path to report.md", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			const text = lines.join("\n");
			expect(text).toContain("report.md");
		});

		it("includes the basePath in artifact path", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/my/custom/path");
			const text = lines.join("\n");
			expect(text).toContain("/my/custom/path");
		});
	});

	describe("keyboard hints", () => {
		it("shows O key hint for opening report", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			const text = lines.join("\n");
			expect(text).toMatch(/O.*report|O.*open/i);
		});

		it("shows Esc key hint for closing", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			const text = lines.join("\n");
			expect(text).toContain("Esc");
		});
	});

	describe("overall output", () => {
		it("returns a non-empty array of strings", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});

		it("returns strings, not nested arrays", () => {
			const plan = makePlan([]);
			const state = makeState();
			const lines = renderReportView(state, plan, "/repo/.pi/missions");
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
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const lines = renderModelView(config, plan, viewState);
			const text = lines.join("\n");
			expect(text.toLowerCase()).toContain("orchestrator");
			expect(text.toLowerCase()).toContain("worker");
			expect(text.toLowerCase()).toContain("validator");
		});

		it("shows current orchestrator model when assigned", () => {
			const config: MissionConfig = { models: { orchestrator: "claude-opus" } };
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const lines = renderModelView(config, plan, viewState);
			const text = lines.join("\n");
			expect(text).toContain("claude-opus");
		});

		it("shows current worker model from plan.modelAssignment when not in config", () => {
			const config: MissionConfig = {};
			const plan = {
				...makePlan([]),
				modelAssignment: { worker: "gpt-4o" },
			};
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const lines = renderModelView(config, plan, viewState);
			const text = lines.join("\n");
			expect(text).toContain("gpt-4o");
		});

		it("shows unassigned placeholder when no model configured", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const lines = renderModelView(config, plan, viewState);
			const text = lines.join("\n");
			expect(text).toMatch(/unassigned|\(none\)|\(current\)|default/i);
		});
	});

	describe("role selection state", () => {
		it("shows selection indicator when role is selected", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: 0 };
			const lines = renderModelView(config, plan, viewState);
			const text = lines.join("\n");
			expect(text).toMatch(/>|\*|\[|select/i);
		});

		it("shows all roles when none selected (role selection mode)", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const lines = renderModelView(config, plan, viewState);
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
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const lines = renderModelView(config, plan, viewState);
			const text = lines.join("\n");
			expect(text).toContain("Esc");
		});
	});

	describe("edge cases", () => {
		it("returns non-empty array", () => {
			const config: MissionConfig = {};
			const plan = makePlan([]);
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const lines = renderModelView(config, plan, viewState);
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});
	});
});

describe("handleModelViewKey (VAL-UI-011)", () => {
	describe("Esc closes model view", () => {
		it("returns close action for Esc", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const result = handleModelViewKey("\x1B", viewState, []);
			expect(result.action.kind).toBe("close");
		});
	});

	describe("role selection (no role selected)", () => {
		it("pressing 1 selects first role (index 0)", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const result = handleModelViewKey("1", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBe(0);
			expect(result.action.kind).toBe("noop");
		});

		it("pressing 2 selects second role (index 1)", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const result = handleModelViewKey("2", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBe(1);
			expect(result.action.kind).toBe("noop");
		});

		it("pressing 3 selects third role (index 2)", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const result = handleModelViewKey("3", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBe(2);
			expect(result.action.kind).toBe("noop");
		});

		it("pressing out-of-range number returns noop", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const result = handleModelViewKey("9", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBeNull();
			expect(result.action.kind).toBe("noop");
		});
	});

	describe("model selection (role selected)", () => {
		it("pressing 1 selects the first available model", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0 };
			const models = ["claude-opus", "claude-sonnet"];
			const result = handleModelViewKey("1", viewState, models);
			expect(result.action.kind).toBe("select_model");
			if (result.action.kind === "select_model") {
				expect(result.action.roleIndex).toBe(0);
				expect(result.action.model).toBe("claude-opus");
			}
		});

		it("pressing 2 selects the second available model", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 1 };
			const models = ["model-a", "model-b", "model-c"];
			const result = handleModelViewKey("2", viewState, models);
			expect(result.action.kind).toBe("select_model");
			if (result.action.kind === "select_model") {
				expect(result.action.roleIndex).toBe(1);
				expect(result.action.model).toBe("model-b");
			}
		});

		it("pressing out-of-range number returns noop", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0 };
			const models = ["model-a"];
			const result = handleModelViewKey("5", viewState, models);
			expect(result.action.kind).toBe("noop");
		});

		it("after model selection view state resets selectedRoleIndex to null", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0 };
			const models = ["claude-opus"];
			const result = handleModelViewKey("1", viewState, models);
			expect(result.nextViewState.selectedRoleIndex).toBeNull();
		});

		it("pressing Esc when role is selected goes back to role selection", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0 };
			const result = handleModelViewKey("\x1B", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBeNull();
			expect(result.action.kind).toBe("noop");
		});
	});

	describe("unknown keys", () => {
		it("returns noop for letter keys when in role selection", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null };
			const result = handleModelViewKey("a", viewState, []);
			expect(result.action.kind).toBe("noop");
		});
	});
});
