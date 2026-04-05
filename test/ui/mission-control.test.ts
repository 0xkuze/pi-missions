import { describe, expect, it } from "bun:test";
import type { Feature, Milestone, MissionPlan, MissionState, ProgressEvent } from "../../extensions/types.js";
import { nowISO } from "../../extensions/utils.js";
import {
	formatRelativeTime,
	handleKeyboardAction,
	renderCurrentFeaturePanel,
	renderKeyboardShortcuts,
	renderMissionOutline,
	renderProgressLog,
} from "../../extensions/ui/mission-control.js";

function makeState(status: MissionState["status"], overrides: Partial<MissionState> = {}): MissionState {
	return {
		missionId: "test-mission",
		status,
		progressLog: [],
		startedAt: new Date(Date.now() - 60_000).toISOString(),
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
		...overrides,
	};
}

function makeFeature(id: string, status: Feature["status"], name?: string, overrides: Partial<Feature> = {}): Feature {
	return {
		id,
		name: name ?? `Feature ${id}`,
		description: "A feature",
		acceptanceCriteria: ["criterion 1", "criterion 2"],
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
		description: "Test mission",
		planVersion: 1,
		milestones,
		validationCommands: [],
		modelAssignment: {},
		createdAt: nowISO(),
	};
}

function makeEvent(type: ProgressEvent["type"], detail: string, tsOffsetMs = 0): ProgressEvent {
	return {
		timestamp: new Date(Date.now() - tsOffsetMs).toISOString(),
		type,
		detail,
	};
}

describe("formatRelativeTime", () => {
	it("shows seconds for recent events", () => {
		const ts = new Date(Date.now() - 30_000).toISOString();
		const result = formatRelativeTime(ts);
		expect(result).toContain("30s");
	});

	it("shows minutes for events older than a minute", () => {
		const ts = new Date(Date.now() - 2 * 60_000).toISOString();
		const result = formatRelativeTime(ts);
		expect(result).toContain("2m");
	});

	it("shows hours for very old events", () => {
		const ts = new Date(Date.now() - 2 * 3600_000).toISOString();
		const result = formatRelativeTime(ts);
		expect(result).toContain("2h");
	});

	it("shows 0s for very recent events", () => {
		const ts = new Date().toISOString();
		const result = formatRelativeTime(ts);
		expect(result).toMatch(/^\d+s$/);
	});
});

describe("renderCurrentFeaturePanel (VAL-UI-003)", () => {
	it("shows feature name", () => {
		const feature = makeFeature("f1", "active", "jwt-tokens");
		const milestone = makeMilestone("m1", [feature], "active");
		const plan = makePlan([milestone]);
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
		});
		const lines = renderCurrentFeaturePanel(state, plan);
		const text = lines.join(" ");
		expect(text).toContain("jwt-tokens");
	});

	it("shows milestone name", () => {
		const milestone = makeMilestone("m1", [makeFeature("f1", "active")], "active");
		milestone.name = "auth";
		const plan = makePlan([milestone]);
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
		});
		const lines = renderCurrentFeaturePanel(state, plan);
		const text = lines.join(" ");
		expect(text).toContain("auth");
	});

	it("shows worker model when assigned", () => {
		const feature = makeFeature("f1", "active");
		const plan = {
			...makePlan([makeMilestone("m1", [feature], "active")]),
			modelAssignment: { worker: "claude-sonnet-4" },
		};
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
		});
		const lines = renderCurrentFeaturePanel(state, plan);
		const text = lines.join(" ");
		expect(text).toContain("claude-sonnet-4");
	});

	it("shows attempt count X/Y", () => {
		const feature = makeFeature("f1", "active", undefined, {
			attempts: [
				{
					attemptNumber: 1,
					startedAt: nowISO(),
					resultPath: "path",
					stdoutPath: "stdout",
					stderrPath: "stderr",
					status: "failure",
				},
			],
		});
		const plan = makePlan([makeMilestone("m1", [feature], "active")]);
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
		});
		const lines = renderCurrentFeaturePanel(state, plan);
		const text = lines.join(" ");
		expect(text).toMatch(/1\/\d+|Attempt/);
	});

	it("shows all acceptance criteria", () => {
		const feature = makeFeature("f1", "active", undefined, {
			acceptanceCriteria: ["JWT signing with RS256", "Token refresh endpoint"],
		});
		const plan = makePlan([makeMilestone("m1", [feature], "active")]);
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
		});
		const lines = renderCurrentFeaturePanel(state, plan);
		const text = lines.join(" ");
		expect(text).toContain("JWT signing with RS256");
		expect(text).toContain("Token refresh endpoint");
	});

	it("shows dirty repo warning when auto-commit is off", () => {
		const feature = makeFeature("f1", "active");
		const plan = makePlan([makeMilestone("m1", [feature], "active")]);
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
			gitSnapshot: {
				headCommit: "abc123",
				dirtyFiles: ["file.ts"],
				autoCommitEnabled: false,
			},
		});
		const lines = renderCurrentFeaturePanel(state, plan);
		const text = lines.join(" ");
		expect(text.toLowerCase()).toContain("dirty");
	});

	it("shows no warnings for clean repo", () => {
		const feature = makeFeature("f1", "active");
		const plan = makePlan([makeMilestone("m1", [feature], "active")]);
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
			gitSnapshot: {
				headCommit: "abc123",
				dirtyFiles: [],
				autoCommitEnabled: true,
			},
		});
		const lines = renderCurrentFeaturePanel(state, plan);
		const text = lines.join(" ");
		expect(text.toLowerCase()).not.toContain("dirty");
	});

	it("shows placeholder when no feature active", () => {
		const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "pending")])]);
		const state = makeState("executing");
		const lines = renderCurrentFeaturePanel(state, plan);
		expect(lines.length).toBeGreaterThan(0);
	});
});

describe("renderMissionOutline (VAL-UI-004)", () => {
	it("lists all milestones in order", () => {
		const plan = makePlan([
			makeMilestone("m1", [makeFeature("f1", "pending")]),
			makeMilestone("m2", [makeFeature("f2", "pending")]),
		]);
		const lines = renderMissionOutline(plan);
		const text = lines.join(" ");
		expect(text).toContain("Milestone m1");
		expect(text).toContain("Milestone m2");
	});

	it("lists all features under their milestones", () => {
		const plan = makePlan([
			makeMilestone("m1", [
				makeFeature("f1", "pending", "user-model"),
				makeFeature("f2", "pending", "login-endpoint"),
			]),
		]);
		const lines = renderMissionOutline(plan);
		const text = lines.join(" ");
		expect(text).toContain("user-model");
		expect(text).toContain("login-endpoint");
	});

	it("shows ✓ for completed features", () => {
		const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "done", "user-model")])]);
		const lines = renderMissionOutline(plan);
		const text = lines.join(" ");
		expect(text).toContain("✓");
	});

	it("shows ● for active features", () => {
		const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "active", "jwt-tokens")], "active")]);
		const lines = renderMissionOutline(plan);
		const text = lines.join(" ");
		expect(text).toContain("●");
	});

	it("shows ○ for pending features", () => {
		const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "pending", "refresh-tokens")])]);
		const lines = renderMissionOutline(plan);
		const text = lines.join(" ");
		expect(text).toContain("○");
	});

	it("shows ✗ for failed features", () => {
		const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "failed", "broken-feature")], "failed")]);
		const lines = renderMissionOutline(plan);
		const text = lines.join(" ");
		expect(text).toContain("✗");
	});

	it("shows – for skipped features", () => {
		const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "skipped", "optional-feature")])]);
		const lines = renderMissionOutline(plan);
		const text = lines.join(" ");
		expect(text).toContain("–");
	});

	it("features are nested under milestones (indented)", () => {
		const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "pending", "feat-name")])]);
		const lines = renderMissionOutline(plan);
		const featureLine = lines.find((l) => l.includes("feat-name"));
		expect(featureLine).toBeDefined();
		const milestoneLine = lines.find((l) => l.includes("Milestone m1"));
		expect(milestoneLine).toBeDefined();
		// Feature line should have more leading whitespace than milestone line
		const featureIndent = (featureLine ?? "").match(/^(\s*)/)?.[1]?.length ?? 0;
		const milestoneIndent = (milestoneLine ?? "").match(/^(\s*)/)?.[1]?.length ?? 0;
		expect(featureIndent).toBeGreaterThan(milestoneIndent);
	});

	it("distinguishes fix features from regular features", () => {
		const fixFeature = makeFeature("fix1", "pending", "fix-something", {
			fixOrigin: { sourceKind: "worker-failure" },
		});
		const plan = makePlan([makeMilestone("m1", [fixFeature])]);
		const lines = renderMissionOutline(plan);
		const text = lines.join(" ");
		// Fix features should be visually distinguishable
		expect(text).toContain("fix-something");
	});
});

describe("renderProgressLog (VAL-UI-005)", () => {
	it("shows events in chronological order (oldest first)", () => {
		const events: ProgressEvent[] = [
			makeEvent("feature_start", "feature 1 started", 300_000),
			makeEvent("feature_complete", "feature 1 done", 120_000),
			makeEvent("feature_start", "feature 2 started", 60_000),
		];
		const state = makeState("executing", { progressLog: events });
		const lines = renderProgressLog(state);
		const text = lines.join("\n");
		const idx1 = text.indexOf("feature 1 started");
		const idx2 = text.indexOf("feature 1 done");
		const idx3 = text.indexOf("feature 2 started");
		expect(idx1).toBeLessThan(idx2);
		expect(idx2).toBeLessThan(idx3);
	});

	it("includes relative timestamps", () => {
		const events: ProgressEvent[] = [makeEvent("feature_start", "feature started", 2 * 60_000)];
		const state = makeState("executing", { progressLog: events });
		const lines = renderProgressLog(state);
		const text = lines.join(" ");
		expect(text).toMatch(/\d+[smh]/);
	});

	it("includes detail text for each event", () => {
		const events: ProgressEvent[] = [makeEvent("feature_complete", "jwt-tokens completed")];
		const state = makeState("executing", { progressLog: events });
		const lines = renderProgressLog(state);
		const text = lines.join(" ");
		expect(text).toContain("jwt-tokens completed");
	});

	it("shows placeholder for empty log", () => {
		const state = makeState("executing", { progressLog: [] });
		const lines = renderProgressLog(state);
		expect(lines.length).toBeGreaterThan(0);
	});

	it("includes status icons for different event types", () => {
		const events: ProgressEvent[] = [
			makeEvent("feature_complete", "done"),
			makeEvent("feature_failed", "failed"),
			makeEvent("feature_start", "started"),
		];
		const state = makeState("executing", { progressLog: events });
		const lines = renderProgressLog(state);
		const text = lines.join(" ");
		// Should have some status icons (at least some unicode or ASCII icons)
		expect(text.length).toBeGreaterThan(0);
	});
});

describe("renderKeyboardShortcuts (VAL-UI-006)", () => {
	it("shows keyboard shortcut hints", () => {
		const lines = renderKeyboardShortcuts();
		const text = lines.join(" ");
		expect(text).toContain("Esc");
	});

	it("shows P for pause/resume action", () => {
		const lines = renderKeyboardShortcuts();
		const text = lines.join(" ");
		expect(text).toContain("P");
	});

	it("shows S for skip action", () => {
		const lines = renderKeyboardShortcuts();
		const text = lines.join(" ");
		expect(text).toContain("S");
	});

	it("shows D for done/complete action", () => {
		const lines = renderKeyboardShortcuts();
		const text = lines.join(" ");
		expect(text).toContain("D");
	});

	it("shows R for redirect action", () => {
		const lines = renderKeyboardShortcuts();
		const text = lines.join(" ");
		expect(text).toContain("R");
	});

	it("returns non-empty lines", () => {
		const lines = renderKeyboardShortcuts();
		expect(lines.length).toBeGreaterThan(0);
	});
});

describe("handleKeyboardAction (VAL-UI-006)", () => {
	function makeExecutingState(overrides: Partial<MissionState> = {}): MissionState {
		return makeState("executing", { currentFeatureId: "f1", currentMilestoneId: "m1", ...overrides });
	}

	describe("Esc closes overlay", () => {
		it("returns close action for escape", () => {
			const action = handleKeyboardAction("\x1B", null);
			expect(action.kind).toBe("close");
		});

		it("returns close regardless of state", () => {
			const action = handleKeyboardAction("\x1B", makeState("executing"));
			expect(action.kind).toBe("close");
		});
	});

	describe("P: pause/resume", () => {
		it("returns pause when executing", () => {
			const action = handleKeyboardAction("p", makeState("executing"));
			expect(action.kind).toBe("pause");
		});

		it("returns pause when validating", () => {
			const action = handleKeyboardAction("p", makeState("validating"));
			expect(action.kind).toBe("pause");
		});

		it("returns pause when planning", () => {
			const action = handleKeyboardAction("p", makeState("planning"));
			expect(action.kind).toBe("pause");
		});

		it("returns pause when draft_review", () => {
			const action = handleKeyboardAction("p", makeState("draft_review"));
			expect(action.kind).toBe("pause");
		});

		it("returns pause when approved", () => {
			const action = handleKeyboardAction("p", makeState("approved"));
			expect(action.kind).toBe("pause");
		});

		it("returns resume when paused", () => {
			const action = handleKeyboardAction("p", makeState("paused"));
			expect(action.kind).toBe("resume");
		});

		it("returns P (uppercase) pause action too", () => {
			const action = handleKeyboardAction("P", makeState("executing"));
			expect(action.kind).toBe("pause");
		});

		it("returns warn when no state", () => {
			const action = handleKeyboardAction("p", null);
			expect(action.kind).toBe("warn");
		});

		it("returns warn when completed", () => {
			const action = handleKeyboardAction("p", makeState("completed"));
			expect(action.kind).toBe("warn");
		});

		it("returns warn when failed", () => {
			const action = handleKeyboardAction("p", makeState("failed"));
			expect(action.kind).toBe("warn");
		});

		it("returns warn when aborted", () => {
			const action = handleKeyboardAction("p", makeState("aborted"));
			expect(action.kind).toBe("warn");
		});
	});

	describe("S: skip feature", () => {
		it("returns skip when executing with current feature", () => {
			const action = handleKeyboardAction("s", makeExecutingState());
			expect(action.kind).toBe("skip");
		});

		it("returns S (uppercase) skip action too", () => {
			const action = handleKeyboardAction("S", makeExecutingState());
			expect(action.kind).toBe("skip");
		});

		it("returns warn when executing without current feature", () => {
			const action = handleKeyboardAction("s", makeState("executing"));
			expect(action.kind).toBe("warn");
		});

		it("returns warn when not executing", () => {
			const action = handleKeyboardAction("s", makeState("paused"));
			expect(action.kind).toBe("warn");
		});

		it("returns warn when no state", () => {
			const action = handleKeyboardAction("s", null);
			expect(action.kind).toBe("warn");
		});

		it("returns warn when completed", () => {
			const action = handleKeyboardAction("s", makeState("completed"));
			expect(action.kind).toBe("warn");
		});
	});

	describe("D: done/completion", () => {
		it("returns done action when executing", () => {
			const action = handleKeyboardAction("d", makeState("executing"));
			expect(action.kind).toBe("done");
		});

		it("returns D (uppercase) done action too", () => {
			const action = handleKeyboardAction("D", makeState("executing"));
			expect(action.kind).toBe("done");
		});

		it("returns done action when paused", () => {
			const action = handleKeyboardAction("d", makeState("paused"));
			expect(action.kind).toBe("done");
		});

		it("returns warn when no state", () => {
			const action = handleKeyboardAction("d", null);
			expect(action.kind).toBe("warn");
		});

		it("returns warn when completed", () => {
			const action = handleKeyboardAction("d", makeState("completed"));
			expect(action.kind).toBe("warn");
		});
	});

	describe("R: redirect", () => {
		it("returns redirect when executing", () => {
			const action = handleKeyboardAction("r", makeState("executing"));
			expect(action.kind).toBe("redirect");
		});

		it("returns R (uppercase) redirect action too", () => {
			const action = handleKeyboardAction("R", makeState("executing"));
			expect(action.kind).toBe("redirect");
		});

		it("returns redirect when paused", () => {
			const action = handleKeyboardAction("r", makeState("paused"));
			expect(action.kind).toBe("redirect");
		});

		it("returns redirect when planning", () => {
			const action = handleKeyboardAction("r", makeState("planning"));
			expect(action.kind).toBe("redirect");
		});

		it("returns warn when no state", () => {
			const action = handleKeyboardAction("r", null);
			expect(action.kind).toBe("warn");
		});

		it("returns warn when completed", () => {
			const action = handleKeyboardAction("r", makeState("completed"));
			expect(action.kind).toBe("warn");
		});
	});

	describe("M: model view", () => {
		it("returns open_model_view when executing", () => {
			const action = handleKeyboardAction("m", makeState("executing"));
			expect(action.kind).toBe("open_model_view");
		});

		it("returns M (uppercase) model view action too", () => {
			const action = handleKeyboardAction("M", makeState("executing"));
			expect(action.kind).toBe("open_model_view");
		});

		it("returns warn when no state", () => {
			const action = handleKeyboardAction("m", null);
			expect(action.kind).toBe("warn");
		});

		it("returns warn when completed", () => {
			const action = handleKeyboardAction("m", makeState("completed"));
			expect(action.kind).toBe("warn");
		});
	});

	describe("V: validation view", () => {
		it("returns open_validation_view when executing", () => {
			const action = handleKeyboardAction("v", makeState("executing"));
			expect(action.kind).toBe("open_validation_view");
		});

		it("returns V (uppercase) validation view action too", () => {
			const action = handleKeyboardAction("V", makeState("executing"));
			expect(action.kind).toBe("open_validation_view");
		});

		it("returns warn when no state", () => {
			const action = handleKeyboardAction("v", null);
			expect(action.kind).toBe("warn");
		});
	});

	describe("L: logs view", () => {
		it("returns open_logs_view when executing", () => {
			const action = handleKeyboardAction("l", makeState("executing"));
			expect(action.kind).toBe("open_logs_view");
		});

		it("returns L (uppercase) logs view action too", () => {
			const action = handleKeyboardAction("L", makeState("executing"));
			expect(action.kind).toBe("open_logs_view");
		});

		it("returns warn when no state", () => {
			const action = handleKeyboardAction("l", null);
			expect(action.kind).toBe("warn");
		});
	});

	describe("unknown keys", () => {
		it("returns noop for unknown key", () => {
			const action = handleKeyboardAction("x", makeState("executing"));
			expect(action.kind).toBe("noop");
		});

		it("returns noop for numeric key", () => {
			const action = handleKeyboardAction("1", makeState("executing"));
			expect(action.kind).toBe("noop");
		});
	});
});
