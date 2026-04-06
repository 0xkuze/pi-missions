import { describe, expect, it } from "bun:test";
import type {
	Feature,
	Milestone,
	MissionConfig,
	MissionPlan,
	MissionState,
	WorkerAttempt,
} from "../../extensions/types.js";
import { handleBlockedViewKey, renderBlockedView } from "../../extensions/ui/blocked-view.js";
import { handleDraftReviewKey, renderDraftReview } from "../../extensions/ui/draft-review.js";
import {
	handleKeyboardAction,
	renderCurrentFeaturePanel,
	renderKeyboardShortcuts,
	renderMissionOutline,
	renderProgressLog,
} from "../../extensions/ui/mission-control.js";
import {
	handleModelViewKey,
	handleReportViewKey,
	type ModelViewState,
	renderModelView,
	renderReportView,
} from "../../extensions/ui/report-view.js";
import {
	type CommandDisplayEntry,
	handleValidationViewKey,
	renderValidationView,
} from "../../extensions/ui/validation-view.js";
import { nowISO } from "../../extensions/utils.js";
import { makeFeature as _sf, makeMilestone as _sm, makePlan as _sp, makeState as _ss } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function makeAttempt(n: number, status: WorkerAttempt["status"] = "failure"): WorkerAttempt {
	return {
		attemptNumber: n,
		startedAt: new Date(Date.now() - 60_000 * n).toISOString(),
		completedAt: nowISO(),
		resultPath: `runtime/f1/${n}/result.json`,
		stdoutPath: `runtime/f1/${n}/stdout.log`,
		stderrPath: `runtime/f1/${n}/stderr.log`,
		status,
	};
}

function makeFeature(id: string, status: Feature["status"] = "pending", overrides: Partial<Feature> = {}): Feature {
	return _sf({
		id,
		name: `Feature ${id}`,
		status,
		acceptanceCriteria: ["Works correctly", "Tests pass"],
		relevantFiles: ["src/index.ts"],
		...overrides,
	});
}

function makeMilestone(id: string, features: Feature[], status: Milestone["status"] = "pending"): Milestone {
	return _sm({ id, name: `Milestone ${id}`, features, status });
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return _sp({
		description: "Build a multi-tenant auth system",
		milestones: [
			makeMilestone("m1", [makeFeature("f1"), makeFeature("f2")]),
			makeMilestone("m2", [makeFeature("f3")]),
		],
		validationCommands: ["bun test", "npx tsc --noEmit"],
		modelAssignment: { worker: "claude-sonnet-4", orchestrator: "claude-opus" },
		...overrides,
	});
}

function makeState(status: MissionState["status"] = "executing", overrides: Partial<MissionState> = {}): MissionState {
	return _ss({ status, startedAt: new Date(Date.now() - 60_000).toISOString(), ...overrides });
}

// ---------------------------------------------------------------------------
// Integration: Draft Review View (VAL-UI-007)
// ---------------------------------------------------------------------------

describe("integration: draft review view", () => {
	describe("renders correctly in draft_review state", () => {
		it("shows plan description as mission goal", () => {
			const plan = makePlan({ description: "Build a multi-tenant auth system" });
			const lines = renderDraftReview(plan, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Build a multi-tenant auth system");
		});

		it("shows all milestones with feature counts", () => {
			const plan = makePlan();
			const lines = renderDraftReview(plan, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Milestone m1");
			expect(text).toContain("Milestone m2");
			expect(text).toContain("2 feature");
		});

		it("shows all features with names and descriptions", () => {
			const plan = makePlan();
			const lines = renderDraftReview(plan, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Feature f1");
			expect(text).toContain("Feature f2");
			expect(text).toContain("Feature f3");
		});

		it("shows validation commands", () => {
			const plan = makePlan();
			const lines = renderDraftReview(plan, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("bun test");
			expect(text).toContain("npx tsc --noEmit");
		});

		it("shows model assignments", () => {
			const plan = makePlan();
			const lines = renderDraftReview(plan, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("claude-sonnet-4");
			expect(text).toContain("claude-opus");
		});

		it("shows estimated runs formula", () => {
			const plan = makePlan();
			const lines = renderDraftReview(plan, 80, undefined, 40);
			const text = lines.join("\n");
			// 3 features + 4 validations (2 milestones * 2) = 7
			expect(text).toContain("Estimated runs");
			expect(text).toMatch(/features.*validations/i);
		});

		it("shows A key to approve and Esc to return to chat", () => {
			const plan = makePlan();
			const lines = renderDraftReview(plan, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("A:");
			expect(text).toContain("Esc");
		});
	});

	describe("keyboard navigation for draft review", () => {
		it("A key triggers approve action", () => {
			const action = handleDraftReviewKey("a");
			expect(action.kind).toBe("approve");
		});

		it("uppercase A also triggers approve", () => {
			const action = handleDraftReviewKey("A");
			expect(action.kind).toBe("approve");
		});

		it("Esc triggers close action", () => {
			const action = handleDraftReviewKey("\x1B");
			expect(action.kind).toBe("close");
		});

		it("other keys return noop", () => {
			for (const key of ["b", "c", "1", "\r"]) {
				const action = handleDraftReviewKey(key);
				expect(action.kind).toBe("noop");
			}
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: Blocked Mission View (VAL-UI-009)
// ---------------------------------------------------------------------------

describe("integration: blocked mission view", () => {
	describe("renders correctly when feature exhausts retries", () => {
		it("shows blocked feature name and attempt count", () => {
			const feature = makeFeature("f1", "blocked", {
				name: "refresh-tokens",
				attempts: [makeAttempt(1), makeAttempt(2), makeAttempt(3)],
			});
			const lines = renderBlockedView(feature, 3, undefined, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("refresh-tokens");
			expect(text).toContain("3/3");
		});

		it("shows last failure error message when available", () => {
			const feature = makeFeature("f1", "blocked", {
				name: "jwt-tokens",
				attempts: [makeAttempt(1), makeAttempt(2)],
			});
			const lastFailure = {
				errorMessage: "auth.refresh.spec.ts failed",
				details: "token expiry logic inconsistent with session store",
			};
			const lines = renderBlockedView(feature, 3, lastFailure, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("auth.refresh.spec.ts failed");
			expect(text).toContain("token expiry logic inconsistent");
		});

		it("shows guidance text about available actions", () => {
			const feature = makeFeature("f1", "blocked", { attempts: [makeAttempt(1)] });
			const lines = renderBlockedView(feature, 3, undefined, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text.toLowerCase()).toMatch(/retry|skip|chat/);
		});

		it("shows R, S, and Esc keyboard hints", () => {
			const feature = makeFeature("f1", "blocked", { attempts: [makeAttempt(1)] });
			const lines = renderBlockedView(feature, 3, undefined, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("R:");
			expect(text).toContain("S:");
			expect(text).toContain("Esc");
		});

		it("renders without failure details when none provided", () => {
			const feature = makeFeature("f1", "blocked", {
				attempts: [makeAttempt(1), makeAttempt(2), makeAttempt(3)],
			});
			const lines = renderBlockedView(feature, 3, undefined, 80, undefined, 40);
			expect(lines.length).toBeGreaterThan(0);
		});
	});

	describe("keyboard navigation for blocked view", () => {
		it("R key triggers retry action", () => {
			const action = handleBlockedViewKey("r");
			expect(action.kind).toBe("retry");
		});

		it("uppercase R also triggers retry", () => {
			const action = handleBlockedViewKey("R");
			expect(action.kind).toBe("retry");
		});

		it("S key triggers skip action", () => {
			const action = handleBlockedViewKey("s");
			expect(action.kind).toBe("skip");
		});

		it("uppercase S also triggers skip", () => {
			const action = handleBlockedViewKey("S");
			expect(action.kind).toBe("skip");
		});

		it("Esc triggers close action", () => {
			const action = handleBlockedViewKey("\x1B");
			expect(action.kind).toBe("close");
		});

		it("other keys return noop", () => {
			for (const key of ["a", "b", "1", "\r"]) {
				const action = handleBlockedViewKey(key);
				expect(action.kind).toBe("noop");
			}
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: Completion Report View (VAL-UI-010)
// ---------------------------------------------------------------------------

describe("integration: completion report view", () => {
	describe("renders correctly on mission complete", () => {
		it("shows mission goal from plan description", () => {
			const plan = makePlan({ description: "Build a multi-tenant auth system" });
			const state = makeState("completed", {
				completedAt: nowISO(),
				totalFeaturesCompleted: 3,
			});
			const lines = renderReportView(state, plan, "/project/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Build a multi-tenant auth system");
		});

		it("shows formatted duration", () => {
			const plan = makePlan();
			const state = makeState("completed", {
				completedAt: nowISO(),
				totalFeaturesCompleted: 3,
			});
			const lines = renderReportView(state, plan, "/project/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			// startedAt was set to 1 hour ago in makeState
			expect(text).toMatch(/duration|1h/i);
		});

		it("shows feature counts including completed and skipped", () => {
			const plan = makePlan();
			const state = makeState("completed", {
				completedAt: nowISO(),
				totalFeaturesCompleted: 5,
				totalFeaturesSkipped: 1,
				totalFixFeaturesCreated: 2,
			});
			const lines = renderReportView(state, plan, "/project/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("5");
			expect(text).toContain("1");
			expect(text).toContain("2");
		});

		it("shows validation summary with milestone pass/fail counts", () => {
			const plan = makePlan({
				milestones: [
					makeMilestone("m1", [makeFeature("f1", "done")], "done"),
					makeMilestone("m2", [makeFeature("f2", "done")], "done"),
					makeMilestone("m3", [makeFeature("f3", "pending")], "pending"),
				],
			});
			const state = makeState("completed", { completedAt: nowISO() });
			const lines = renderReportView(state, plan, "/project/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			// 2 out of 3 milestones done
			expect(text).toMatch(/2.*3|milestone/i);
		});

		it("shows path to output report.md file", () => {
			const plan = makePlan();
			const state = makeState("completed", { completedAt: nowISO() });
			const lines = renderReportView(state, plan, "/project/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("report.md");
			expect(text).toContain("/project/.pi/missions");
		});

		it("shows O key and Esc key hints", () => {
			const plan = makePlan();
			const state = makeState("completed", { completedAt: nowISO() });
			const lines = renderReportView(state, plan, "/project/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toMatch(/O.*report/i);
			expect(text).toContain("Esc");
		});
	});

	describe("keyboard navigation for completion view", () => {
		it("O key triggers open_report action", () => {
			const action = handleReportViewKey("o");
			expect(action.kind).toBe("open_report");
		});

		it("uppercase O also triggers open_report", () => {
			const action = handleReportViewKey("O");
			expect(action.kind).toBe("open_report");
		});

		it("Esc triggers close action", () => {
			const action = handleReportViewKey("\x1B");
			expect(action.kind).toBe("close");
		});

		it("other keys return noop", () => {
			for (const key of ["a", "b", "1", "\r"]) {
				const action = handleReportViewKey(key);
				expect(action.kind).toBe("noop");
			}
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: Validation View (VAL-UI-008)
// ---------------------------------------------------------------------------

describe("integration: validation view", () => {
	describe("renders validation command statuses", () => {
		it("shows milestone name in header", () => {
			const commands: CommandDisplayEntry[] = [];
			const lines = renderValidationView("Auth Flows", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Auth Flows");
		});

		it("shows checkmark for passed commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "typecheck", status: "passed", durationMs: 2100 }];
			const lines = renderValidationView("Foundation", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("\u2713");
			expect(text).toContain("typecheck");
		});

		it("shows bullet for running commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "test", status: "running" }];
			const lines = renderValidationView("Foundation", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("\u25cf");
			expect(text).toContain("test");
		});

		it("shows circle for pending commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "build", status: "pending" }];
			const lines = renderValidationView("Foundation", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("\u25cb");
			expect(text).toContain("build");
		});

		it("shows x mark for failed commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "test", status: "failed", durationMs: 5000 }];
			const lines = renderValidationView("Foundation", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("\u2717");
		});

		it("shows duration for completed commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "typecheck", status: "passed", durationMs: 2100 }];
			const lines = renderValidationView("Foundation", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toMatch(/2s|2\.1s|2100/);
		});

		it("shows all commands regardless of status", () => {
			const commands: CommandDisplayEntry[] = [
				{ label: "typecheck", status: "passed", durationMs: 1000 },
				{ label: "test", status: "running" },
				{ label: "build", status: "pending" },
			];
			const lines = renderValidationView("Foundation", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("typecheck");
			expect(text).toContain("test");
			expect(text).toContain("build");
		});

		it("shows fix feature info when validation has failed", () => {
			const commands: CommandDisplayEntry[] = [{ label: "test", status: "failed", durationMs: 3000 }];
			const lines = renderValidationView("Foundation", commands, true, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text.toLowerCase()).toMatch(/fix|failure/);
		});

		it("does not show fix feature info when all pass", () => {
			const commands: CommandDisplayEntry[] = [{ label: "test", status: "passed", durationMs: 3000 }];
			const lines = renderValidationView("Foundation", commands, false, 80, undefined, 40);
			expect(lines.find((l) => l.toLowerCase().includes("fix feature"))).toBeUndefined();
		});

		it("shows Esc key hint", () => {
			const lines = renderValidationView("Foundation", [], false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Esc");
		});
	});

	describe("keyboard navigation for validation view", () => {
		it("Esc triggers close action", () => {
			const action = handleValidationViewKey("\x1B");
			expect(action.kind).toBe("close");
		});

		it("other keys return noop", () => {
			for (const key of ["a", "v", "1", "\r"]) {
				const action = handleValidationViewKey(key);
				expect(action.kind).toBe("noop");
			}
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: Mission Control Overlay (VAL-UI-013, VAL-UI-006)
// ---------------------------------------------------------------------------

describe("integration: mission control overlay navigation", () => {
	describe("Ctrl+Shift+M opens Mission Control", () => {
		it("shortcut key renders the overlay keyboard hint for Esc close", () => {
			const lines = renderKeyboardShortcuts();
			const text = lines.join(" ");
			expect(text).toContain("Esc");
			expect(text).toContain("Close");
		});

		it("mission control layout renders with state and plan", () => {
			const plan = makePlan();
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
			});
			const currentFeatureLines = renderCurrentFeaturePanel(state, plan);
			const outlineLines = renderMissionOutline(plan);
			const logLines = renderProgressLog(state);
			// All panels produce output
			expect(currentFeatureLines.length).toBeGreaterThan(0);
			expect(outlineLines.length).toBeGreaterThan(0);
			expect(logLines.length).toBeGreaterThan(0);
		});

		it("overlay renders idle state without error when no mission", () => {
			const plan = makePlan();
			const state = makeState("planning");
			const currentFeatureLines = renderCurrentFeaturePanel(state, plan);
			expect(currentFeatureLines.join(" ")).toContain("No Active Feature");
		});
	});

	describe("keyboard action dispatch from Mission Control (VAL-UI-006)", () => {
		it("Esc closes the overlay regardless of state", () => {
			for (const status of ["executing", "planning", "paused", "completed"] as const) {
				const state = makeState(status);
				const action = handleKeyboardAction("\x1B", state);
				expect(action.kind).toBe("close");
			}
			const action = handleKeyboardAction("\x1B", null);
			expect(action.kind).toBe("close");
		});

		it("P pauses executing mission, not completed", () => {
			const pauseAction = handleKeyboardAction("p", makeState("executing"));
			expect(pauseAction.kind).toBe("pause");

			const warnAction = handleKeyboardAction("p", makeState("completed"));
			expect(warnAction.kind).toBe("warn");
		});

		it("P resumes paused mission", () => {
			const action = handleKeyboardAction("p", makeState("paused"));
			expect(action.kind).toBe("resume");
		});

		it("S skips current feature when executing with active feature", () => {
			const state = makeState("executing", { currentFeatureId: "f1" });
			const action = handleKeyboardAction("s", state);
			expect(action.kind).toBe("skip");
		});

		it("S warns when executing without current feature", () => {
			const state = makeState("executing");
			const action = handleKeyboardAction("s", state);
			expect(action.kind).toBe("warn");
		});

		it("D triggers done action for active mission", () => {
			for (const status of ["executing", "paused", "planning"] as const) {
				const action = handleKeyboardAction("d", makeState(status));
				expect(action.kind).toBe("done");
			}
		});

		it("R opens redirect input for active mission", () => {
			const action = handleKeyboardAction("r", makeState("executing"));
			expect(action.kind).toBe("redirect");
		});

		it("M opens model view for active mission", () => {
			const action = handleKeyboardAction("m", makeState("executing"));
			expect(action.kind).toBe("open_model_view");
		});

		it("V opens validation view for active mission", () => {
			const action = handleKeyboardAction("v", makeState("executing"));
			expect(action.kind).toBe("open_validation_view");
		});

		it("L opens logs view for active mission", () => {
			const action = handleKeyboardAction("l", makeState("executing"));
			expect(action.kind).toBe("open_logs_view");
		});

		it("disallowed actions in terminal state return warn", () => {
			const state = makeState("completed");
			for (const key of ["p", "s", "d", "r", "m", "v", "l"]) {
				const action = handleKeyboardAction(key, state);
				if (key === "d") {
					// D returns warn when completed (no active mission)
					expect(action.kind).toBe("warn");
				} else {
					expect(action.kind).toBe("warn");
				}
			}
		});

		it("unknown keys return noop", () => {
			const state = makeState("executing");
			for (const key of ["z", "q", "1", "2"]) {
				const action = handleKeyboardAction(key, state);
				expect(action.kind).toBe("noop");
			}
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: Model Switching View (VAL-UI-011)
// ---------------------------------------------------------------------------

describe("integration: model switching view", () => {
	describe("renders current model assignments", () => {
		it("shows all three roles", () => {
			const config: MissionConfig = {};
			const plan = makePlan();
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n").toLowerCase();
			expect(text).toContain("orchestrator");
			expect(text).toContain("worker");
			expect(text).toContain("validator");
		});

		it("shows model assigned in plan.modelAssignment", () => {
			const config: MissionConfig = {};
			const plan = makePlan({ modelAssignment: { worker: "claude-sonnet-4" } });
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n");
			expect(text).toContain("claude-sonnet-4");
		});

		it("config model overrides plan.modelAssignment", () => {
			const config: MissionConfig = { models: { worker: "gpt-4o" } };
			const plan = makePlan({ modelAssignment: { worker: "claude-sonnet-4" } });
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n");
			expect(text).toContain("gpt-4o");
			expect(text).not.toContain("claude-sonnet-4");
		});

		it("shows default placeholder when no model configured", () => {
			const config: MissionConfig = {};
			const plan = makePlan({ modelAssignment: {} });
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			const text = lines.join("\n");
			expect(text).toMatch(/default|session|none|unassigned/i);
		});
	});

	describe("role selection and model assignment flow", () => {
		it("pressing 1 enters orchestrator model selection", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("1", viewState, ["model-a", "model-b"]);
			expect(result.nextViewState.selectedRoleIndex).toBe(0);
		});

		it("pressing 2 enters worker model selection", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("2", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBe(1);
		});

		it("pressing 3 enters validator model selection", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("3", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBe(2);
		});

		it("model selection returns select_model action with correct role and model", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 1, searchQuery: "", highlightedIndex: 1 };
			const models = ["claude-opus", "claude-sonnet-4", "gpt-4o"];
			const result = handleModelViewKey("\r", viewState, models);
			expect(result.action.kind).toBe("select_model");
			if (result.action.kind === "select_model") {
				expect(result.action.roleIndex).toBe(1);
				expect(result.action.model).toBe("claude-sonnet-4");
			}
			expect(result.nextViewState.selectedRoleIndex).toBeNull();
		});

		it("Esc during model selection goes back to role selection", () => {
			const viewState: ModelViewState = { selectedRoleIndex: 0, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("\x1B", viewState, []);
			expect(result.nextViewState.selectedRoleIndex).toBeNull();
			expect(result.action.kind).toBe("noop");
		});

		it("Esc at role selection level closes model view", () => {
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const result = handleModelViewKey("\x1B", viewState, []);
			expect(result.action.kind).toBe("close");
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: State-triggered view transitions
// ---------------------------------------------------------------------------

describe("integration: state-triggered view transitions", () => {
	describe("draft review state triggers draft review view content", () => {
		it("draft_review state renders draft review content correctly", () => {
			const plan = makePlan();
			// draft_review state → render draft review view
			const lines = renderDraftReview(plan, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Draft Mission Plan");
			expect(text).toContain("A: approve");
		});
	});

	describe("blocked feature triggers blocked view content", () => {
		it("blocked feature with exhausted retries renders blocked view", () => {
			const feature = makeFeature("f1", "blocked", {
				name: "auth-endpoint",
				attempts: [makeAttempt(1), makeAttempt(2), makeAttempt(3)],
			});
			const lines = renderBlockedView(
				feature,
				3,
				{
					errorMessage: "tests failed",
				},
				80,
				undefined,
				40,
			);
			const text = lines.join("\n");
			expect(text).toContain("auth-endpoint");
			expect(text).toContain("Blocked");
			expect(text).toContain("3/3");
		});
	});

	describe("completed state triggers completion report view", () => {
		it("completed state renders completion view with all key information", () => {
			const plan = makePlan();
			const state = makeState("completed", {
				completedAt: nowISO(),
				totalFeaturesCompleted: 3,
			});
			const lines = renderReportView(state, plan, "/project/.pi/missions", 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Mission Complete");
			expect(text).toContain("report.md");
			expect(text).toContain("O:");
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: All views reachable via navigation (VAL-UI-006)
// ---------------------------------------------------------------------------

describe("integration: all views reachable via navigation", () => {
	describe("keyboard shortcuts reach each view from Mission Control", () => {
		it("V key dispatches open_validation_view action", () => {
			const state = makeState("validating");
			const action = handleKeyboardAction("v", state);
			expect(action.kind).toBe("open_validation_view");
		});

		it("M key dispatches open_model_view action", () => {
			const state = makeState("executing");
			const action = handleKeyboardAction("m", state);
			expect(action.kind).toBe("open_model_view");
		});

		it("L key dispatches open_logs_view action", () => {
			const state = makeState("executing");
			const action = handleKeyboardAction("l", state);
			expect(action.kind).toBe("open_logs_view");
		});

		it("draft review view accessible when state is draft_review", () => {
			const plan = makePlan();
			const lines = renderDraftReview(plan, 80, undefined, 40);
			expect(lines.length).toBeGreaterThan(0);
			expect(lines.join("\n")).toContain("A: approve");
		});

		it("blocked view accessible when feature is blocked", () => {
			const feature = makeFeature("f1", "blocked", { attempts: [makeAttempt(1)] });
			const lines = renderBlockedView(feature, 3, undefined, 80, undefined, 40);
			expect(lines.length).toBeGreaterThan(0);
			expect(lines.join("\n")).toContain("R:");
		});

		it("completion view accessible when mission is complete", () => {
			const plan = makePlan();
			const state = makeState("completed", { completedAt: nowISO() });
			const lines = renderReportView(state, plan, "/project/.pi/missions", 80, undefined, 40);
			expect(lines.length).toBeGreaterThan(0);
			expect(lines.join("\n")).toContain("O:");
		});

		it("validation view accessible during validating state", () => {
			const commands: CommandDisplayEntry[] = [
				{ label: "typecheck", status: "passed", durationMs: 1000 },
				{ label: "test", status: "running" },
			];
			const lines = renderValidationView("Auth Milestone", commands, false, 80, undefined, 40);
			expect(lines.length).toBeGreaterThan(0);
			expect(lines.join("\n")).toContain("Auth Milestone");
		});

		it("model view accessible from executing state via M key", () => {
			const state = makeState("executing");
			const action = handleKeyboardAction("m", state);
			expect(action.kind).toBe("open_model_view");
			// And the model view itself renders
			const config: MissionConfig = {};
			const plan = makePlan();
			const viewState: ModelViewState = { selectedRoleIndex: null, searchQuery: "", highlightedIndex: 0 };
			const lines = renderModelView(config, plan, viewState, 80, undefined, [], 40);
			expect(lines.length).toBeGreaterThan(0);
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: Mission Control polls state (VAL-UI-013)
// ---------------------------------------------------------------------------

describe("integration: mission control state polling", () => {
	it("progress log shows events as they appear in state", () => {
		const events = [
			{
				timestamp: new Date(Date.now() - 300_000).toISOString(),
				type: "feature_start" as const,
				detail: "Feature f1 started",
			},
			{
				timestamp: new Date(Date.now() - 180_000).toISOString(),
				type: "feature_complete" as const,
				detail: "Feature f1 completed",
			},
			{
				timestamp: new Date(Date.now() - 60_000).toISOString(),
				type: "feature_start" as const,
				detail: "Feature f2 started",
			},
		];
		const state = makeState("executing", { progressLog: events });
		const lines = renderProgressLog(state);
		const text = lines.join("\n");
		// Events should appear in reverse chronological order (newest first)
		const idx1 = text.indexOf("Feature f1 started");
		const idx2 = text.indexOf("Feature f1 completed");
		const idx3 = text.indexOf("Feature f2 started");
		expect(idx3).toBeLessThan(idx2);
		expect(idx2).toBeLessThan(idx1);
	});

	it("mission outline updates to reflect latest feature statuses", () => {
		// Simulates state after two features complete and one is active
		const plan = makePlan({
			milestones: [
				makeMilestone("m1", [
					makeFeature("f1", "done"),
					makeFeature("f2", "done"),
					makeFeature("f3", "active"),
					makeFeature("f4", "pending"),
				]),
			],
		});
		const lines = renderMissionOutline(plan);
		const text = lines.join("\n");
		expect(text).toContain("\u2713"); // ✓ for done features
		expect(text).toContain("\u25cf"); // ● for active feature
		expect(text).toContain("\u00b7"); // · for pending feature
	});

	it("current feature panel updates with latest state", () => {
		const plan = makePlan();
		// State says f2 is now active (after f1 completed)
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
		});
		const lines = renderCurrentFeaturePanel(state, plan);
		const text = lines.join("\n");
		expect(text).toContain("Feature f2");
	});
});

// ---------------------------------------------------------------------------
// Integration: Edge cases and robustness
// ---------------------------------------------------------------------------

describe("integration: edge cases and robustness", () => {
	it("all views handle empty/minimal data without throwing", () => {
		const minimalPlan = makePlan({ milestones: [makeMilestone("m1", [makeFeature("f1")])] });
		const minimalState = makeState("executing");
		const blockedFeature = makeFeature("f1", "blocked");
		const completedState = makeState("completed", { completedAt: nowISO() });

		expect(() => renderDraftReview(minimalPlan, 80, undefined, 40)).not.toThrow();
		expect(() => renderBlockedView(blockedFeature, 3, undefined, 80, undefined, 40)).not.toThrow();
		expect(() => renderReportView(completedState, minimalPlan, "/path", 80, undefined, 40)).not.toThrow();
		expect(() => renderValidationView("m1", [], false, 80, undefined, 40)).not.toThrow();
		expect(() => renderCurrentFeaturePanel(minimalState, minimalPlan)).not.toThrow();
		expect(() => renderMissionOutline(minimalPlan)).not.toThrow();
		expect(() => renderProgressLog(minimalState)).not.toThrow();
		expect(() => renderKeyboardShortcuts()).not.toThrow();
	});

	it("all views return non-empty string arrays", () => {
		const plan = makePlan();
		const state = makeState("executing");
		const blockedFeature = makeFeature("f1", "blocked");
		const completedState = makeState("completed", { completedAt: nowISO() });

		expect(renderDraftReview(plan, 80, undefined, 40).length).toBeGreaterThan(0);
		expect(renderBlockedView(blockedFeature, 3, undefined, 80, undefined, 40).length).toBeGreaterThan(0);
		expect(renderReportView(completedState, plan, "/path", 80, undefined, 40).length).toBeGreaterThan(0);
		expect(renderValidationView("m1", [], false, 80, undefined, 40).length).toBeGreaterThan(0);
		expect(renderCurrentFeaturePanel(state, plan).length).toBeGreaterThan(0);
		expect(renderMissionOutline(plan).length).toBeGreaterThan(0);
		expect(renderProgressLog(state).length).toBeGreaterThan(0);
		expect(renderKeyboardShortcuts().length).toBeGreaterThan(0);
	});

	it("handle null state gracefully in keyboard actions", () => {
		for (const key of ["p", "s", "d", "r", "m", "v", "l"]) {
			const action = handleKeyboardAction(key, null);
			expect(action.kind).toBe("warn");
		}
		const escAction = handleKeyboardAction("\x1B", null);
		expect(escAction.kind).toBe("close");
	});
});
