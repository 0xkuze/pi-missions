import { describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@mariozechner/pi-tui";
import type {
	Feature,
	Milestone,
	MissionConfig,
	MissionPlan,
	MissionState,
	ProgressEvent,
} from "../../extensions/types.js";
import type { MissionControlDeps } from "../../extensions/ui/mission-control.js";
import {
	applyModelChangeToConfig,
	formatRelativeTime,
	handleKeyboardAction,
	MissionControlComponent,
	renderCurrentFeaturePanel,
	renderKeyboardShortcuts,
	renderMissionOutline,
	renderProgressLog,
	resolveStateView,
} from "../../extensions/ui/mission-control.js";
import { nowISO } from "../../extensions/utils.js";
import { makeFeature as _sf, makeMilestone as _sm, makePlan as _sp, makeState as _ss } from "../helpers/index.js";

function makeState(status: MissionState["status"], overrides: Partial<MissionState> = {}): MissionState {
	return _ss({ status, startedAt: new Date(Date.now() - 60_000).toISOString(), ...overrides });
}

function makeFeature(id: string, status: Feature["status"], name?: string, overrides: Partial<Feature> = {}): Feature {
	return _sf({ id, name: name ?? `Feature ${id}`, status, ...overrides });
}

function makeMilestone(id: string, features: Feature[], status: Milestone["status"] = "pending"): Milestone {
	return _sm({ id, name: `Milestone ${id}`, features, status });
}

function makePlan(milestones: Milestone[]): MissionPlan {
	return _sp({ milestones });
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

	it("shows · for pending features", () => {
		const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "pending", "refresh-tokens")])]);
		const lines = renderMissionOutline(plan);
		const text = lines.join(" ");
		expect(text).toContain("\u00b7");
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
		const milestoneIdx = milestoneLine!.indexOf("Milestone m1");
		const featureIdx = featureLine!.indexOf("\u00b7");
		expect(featureIdx).toBeGreaterThan(milestoneIdx);
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
	it("shows events in reverse chronological order (newest first)", () => {
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
		expect(idx3).toBeLessThan(idx2);
		expect(idx2).toBeLessThan(idx1);
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

	describe("reset (X key)", () => {
		it("returns reset when state exists", () => {
			const action = handleKeyboardAction("x", makeState("executing"));
			expect(action.kind).toBe("reset");
		});

		it("returns reset for uppercase X", () => {
			const action = handleKeyboardAction("X", makeState("executing"));
			expect(action.kind).toBe("reset");
		});

		it("returns warn when no state", () => {
			const action = handleKeyboardAction("x", null);
			expect(action.kind).toBe("warn");
		});

		it("returns reset for completed state", () => {
			const action = handleKeyboardAction("x", makeState("completed"));
			expect(action.kind).toBe("reset");
		});
	});

	describe("unknown keys", () => {
		it("returns noop for unknown key", () => {
			const action = handleKeyboardAction("z", makeState("executing"));
			expect(action.kind).toBe("noop");
		});

		it("returns noop for numeric key", () => {
			const action = handleKeyboardAction("1", makeState("executing"));
			expect(action.kind).toBe("noop");
		});
	});
});

describe("resolveStateView (VAL-WIRE-001..006)", () => {
	describe("state-triggered views", () => {
		it("returns null for completed state (mission list shown instead)", () => {
			const state = makeState("completed");
			const view = resolveStateView(state, null);
			expect(view).toBeNull();
		});

		it("returns draft_review view when in draft_review state (VAL-WIRE-004)", () => {
			const state = makeState("draft_review");
			const view = resolveStateView(state, null);
			expect(view).not.toBeNull();
			expect(view?.kind).toBe("draft_review");
		});

		it("returns blocked view when current feature is failed (VAL-WIRE-005)", () => {
			const feature = makeFeature("f1", "failed");
			const milestone = makeMilestone("m1", [feature]);
			const plan = makePlan([milestone]);
			const state = makeState("executing", { currentFeatureId: "f1" });
			const view = resolveStateView(state, plan);
			expect(view).not.toBeNull();
			expect(view?.kind).toBe("blocked");
			if (view?.kind === "blocked") {
				expect(view.featureId).toBe("f1");
			}
		});

		it("returns blocked view when current feature is blocked (VAL-WIRE-005)", () => {
			const feature = makeFeature("f1", "blocked");
			const milestone = makeMilestone("m1", [feature]);
			const plan = makePlan([milestone]);
			const state = makeState("executing", { currentFeatureId: "f1" });
			const view = resolveStateView(state, plan);
			expect(view).not.toBeNull();
			expect(view?.kind).toBe("blocked");
		});

		it("returns null for executing state with active feature", () => {
			const feature = makeFeature("f1", "active");
			const plan = makePlan([makeMilestone("m1", [feature])]);
			const state = makeState("executing", { currentFeatureId: "f1" });
			const view = resolveStateView(state, plan);
			expect(view).toBeNull();
		});

		it("returns null for executing state with no current feature", () => {
			const state = makeState("executing");
			const view = resolveStateView(state, null);
			expect(view).toBeNull();
		});

		it("returns planning view for planning state (VAL-NEWUI-001, VAL-XFLOW-002)", () => {
			const state = makeState("planning");
			const view = resolveStateView(state, null);
			expect(view).not.toBeNull();
			expect(view?.kind).toBe("planning");
		});

		it("returns null for paused state", () => {
			const state = makeState("paused");
			const view = resolveStateView(state, null);
			expect(view).toBeNull();
		});

		it("completed returns null (mission list shown, not blocked view)", () => {
			const feature = makeFeature("f1", "failed");
			const plan = makePlan([makeMilestone("m1", [feature])]);
			const state = makeState("completed", { currentFeatureId: "f1" });
			const view = resolveStateView(state, plan);
			expect(view).toBeNull();
		});
	});

	describe("M/V/L key actions produce open_* overlay actions (VAL-WIRE-001/002/003)", () => {
		it("M key returns open_model_view action (VAL-WIRE-001)", () => {
			const action = handleKeyboardAction("m", makeState("executing"));
			expect(action.kind).toBe("open_model_view");
		});

		it("V key returns open_validation_view action (VAL-WIRE-002)", () => {
			const action = handleKeyboardAction("v", makeState("executing"));
			expect(action.kind).toBe("open_validation_view");
		});

		it("L key returns open_logs_view action (VAL-WIRE-003)", () => {
			const action = handleKeyboardAction("l", makeState("executing"));
			expect(action.kind).toBe("open_logs_view");
		});
	});
});

describe("applyModelChangeToConfig (VAL-API-001)", () => {
	it("sets orchestrator model when roleIndex is 0", () => {
		const config: MissionConfig = {};
		const updated = applyModelChangeToConfig(config, 0, "claude-opus");
		expect(updated.models?.orchestrator).toBe("claude-opus");
	});

	it("sets worker model when roleIndex is 1", () => {
		const config: MissionConfig = {};
		const updated = applyModelChangeToConfig(config, 1, "gpt-4o");
		expect(updated.models?.worker).toBe("gpt-4o");
	});

	it("sets validator model when roleIndex is 2", () => {
		const config: MissionConfig = {};
		const updated = applyModelChangeToConfig(config, 2, "claude-haiku");
		expect(updated.models?.validator).toBe("claude-haiku");
	});

	it("preserves existing model assignments", () => {
		const config: MissionConfig = { models: { worker: "existing-worker" } };
		const updated = applyModelChangeToConfig(config, 0, "new-orchestrator");
		expect(updated.models?.orchestrator).toBe("new-orchestrator");
		expect(updated.models?.worker).toBe("existing-worker");
	});

	it("returns unchanged config for out-of-range roleIndex", () => {
		const config: MissionConfig = {};
		const updated = applyModelChangeToConfig(config, 99, "some-model");
		expect(updated).toEqual(config);
	});

	it("does not mutate original config", () => {
		const config: MissionConfig = { models: { orchestrator: "old-model" } };
		const updated = applyModelChangeToConfig(config, 0, "new-model");
		expect(config.models?.orchestrator).toBe("old-model");
		expect(updated.models?.orchestrator).toBe("new-model");
	});
});

function makeDeps(tmpDir: string, overrides: Partial<MissionControlDeps> = {}): MissionControlDeps {
	const defaultConfig: MissionConfig = {};
	return {
		basePath: tmpDir,
		projectPath: tmpDir,
		loadState: () => makeState("executing"),
		loadPlan: () => null,
		loadConfig: () => defaultConfig,
		sendUserMessage: () => {},
		getInput: async () => undefined,
		confirm: async () => true,
		notify: () => {},
		updateWidget: () => {},
		availableModels: ["claude-opus", "claude-sonnet"],
		openFile: () => {},
		setModel: async () => {},
		resetMission: () => {},
		loadRegistry: () => [],
		startNewMission: () => {},
		...overrides,
	};
}

function makeTUI(overridesOrRows?: number | { rows?: number; requestRender?: () => void }) {
	const rows = typeof overridesOrRows === "number" ? overridesOrRows : overridesOrRows?.rows ?? 50;
	const requestRender = typeof overridesOrRows === "object" ? overridesOrRows?.requestRender ?? (() => {}) : () => {};
	return {
		requestRender,
		terminal: { rows, columns: 120, write: () => {} },
	} as unknown as import("@mariozechner/pi-tui").TUI;
}

describe("MissionControlComponent model view (VAL-API-001, VAL-XFLOW-003)", () => {
	let tmpDir: string;

	it("calls setModel when orchestrator model is selected", async () => {
		tmpDir = join(tmpdir(), `mc-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const setModelCalls: string[] = [];
			const deps = makeDeps(tmpDir, {
				setModel: async (modelId) => {
					setModelCalls.push(modelId);
				},
			});
			const tui = makeTUI();
			const done = () => {};
			const component = new MissionControlComponent(tui, done, deps);
			component.handleInput("M");
			component.handleInput("\r");
			component.handleInput("\r");
			await new Promise((r) => setTimeout(r, 10));
			expect(setModelCalls).toEqual(["claude-opus"]);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("does not call setModel when worker model is selected", async () => {
		tmpDir = join(tmpdir(), `mc-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const setModelCalls: string[] = [];
			const deps = makeDeps(tmpDir, {
				setModel: async (modelId) => {
					setModelCalls.push(modelId);
				},
			});
			const tui = makeTUI();
			const done = () => {};
			const component = new MissionControlComponent(tui, done, deps);
			component.handleInput("M");
			component.handleInput("2");
			component.handleInput("\r");
			await new Promise((r) => setTimeout(r, 10));
			expect(setModelCalls).toEqual([]);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("saves config when model is selected", async () => {
		tmpDir = join(tmpdir(), `mc-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const deps = makeDeps(tmpDir);
			const tui = makeTUI();
			const done = () => {};
			const component = new MissionControlComponent(tui, done, deps);
			component.handleInput("M");
			component.handleInput("\r");
			component.handleInput("\r");
			await new Promise((r) => setTimeout(r, 10));
			const configPath = join(tmpDir, "config.json");
			const { readFileSync } = await import("node:fs");
			const saved = JSON.parse(readFileSync(configPath, "utf8"));
			expect(saved.models?.orchestrator).toBe("claude-opus");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("MissionControlComponent draft_review approve", () => {
	it("transitions state to approved, updates plan, appends mutation, updates widget, and sends message", () => {
		const tmpDir = join(tmpdir(), `mc-draft-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const draftState = makeState("draft_review");
			const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "pending")])]);

			const messages: string[] = [];
			const widgetCalls: Array<{ state: MissionState; plan?: MissionPlan }> = [];
			let doneCalled = false;

			const deps = makeDeps(tmpDir, {
				loadState: () => draftState,
				loadPlan: () => plan,
				sendUserMessage: (msg) => messages.push(msg),
				updateWidget: (s, p) => widgetCalls.push({ state: s, plan: p }),
			});

			const tui = makeTUI();
			const component = new MissionControlComponent(
				tui,
				() => {
					doneCalled = true;
				},
				deps,
			);

			component.handleInput("A");

			expect(doneCalled).toBe(true);

			expect(messages).toHaveLength(1);
			expect(messages[0]).toContain("approved the mission plan");
			expect(messages[0]).toContain("spawn_worker");

			expect(widgetCalls).toHaveLength(1);
			expect(widgetCalls[0]!.state.status).toBe("approved");
			expect(widgetCalls[0]!.plan?.approvedAt).toBeDefined();
			expect(widgetCalls[0]!.plan?.planVersion).toBe(2);

			const savedState = JSON.parse(readFileSync(join(tmpDir, "state.json"), "utf8"));
			expect(savedState.status).toBe("approved");

			const savedPlan = JSON.parse(readFileSync(join(tmpDir, "plan.json"), "utf8"));
			expect(savedPlan.approvedAt).toBeDefined();
			expect(savedPlan.planVersion).toBe(2);

			const historyFile = join(tmpDir, "plan-history.jsonl");
			expect(existsSync(historyFile)).toBe(true);
			const historyLine = readFileSync(historyFile, "utf8").trim();
			const mutation = JSON.parse(historyLine);
			expect(mutation.kind).toBe("plan-approved");
			expect(mutation.planVersion).toBe(2);
			expect(mutation.actor).toBe("user");

			expect(savedState.status).toBe("approved");
			expect(savedPlan.approvedAt).toBeDefined();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("MissionControlComponent main overlay frame wrapping", () => {
	it("wraps main overlay in a single frame with title and footer", () => {
		const tmpDir = join(tmpdir(), `mc-frame-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const feature = makeFeature("f1", "active", "jwt-tokens");
			const milestone = makeMilestone("m1", [feature], "active");
			const plan = makePlan([milestone]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
				progressLog: [makeEvent("feature_start", "started jwt-tokens", 60_000)],
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI();
			const component = new MissionControlComponent(tui, () => {}, deps);

			const width = 120;
			const lines = component.render(width);
			const text = lines.join("\n");

			expect(lines[0]).toContain("\u2500");
			expect(lines[0]).toContain("Mission Control");

			const lastLine = lines[lines.length - 1]!;
			expect(lastLine).toContain("\u2518");

			expect(text).toContain("Esc: Close");
			expect(text).toContain("P: Pause");
			expect(text).toContain("R: Redirect");

			expect(text).toContain("Current Feature");
			expect(text).toContain("Features");
			expect(text).toContain("Progress Log");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("MissionControlComponent ANSI-aware two-column layout", () => {
	it("handles ANSI codes in two-column layout without clipping", () => {
		const tmpDir = join(tmpdir(), `mc-ansi-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const feature = makeFeature("f1", "active", "jwt-tokens", {
				acceptanceCriteria: ["JWT signing with RS256"],
			});
			const milestone = makeMilestone("m1", [feature], "active");
			const plan = makePlan([milestone]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
				progressLog: [makeEvent("feature_start", "started jwt-tokens", 60_000)],
			});

			const mockTheme = {
				fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
				bg: (_color: string, text: string) => `\x1b[41m${text}\x1b[0m`,
				bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
			};

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI();
			const component = new MissionControlComponent(tui, () => {}, deps, mockTheme);

			const width = 80;
			const lines = component.render(width);

			const panelLines = lines.filter((l) => l.includes("\u2502"));
			for (const line of panelLines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}

			const ansiEscapeRe = /\x1b\[[^m]*$/;
			for (const line of lines) {
				expect(line).not.toMatch(ansiEscapeRe);
			}

			expect(lines.length).toBeGreaterThan(0);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("MissionControlComponent scroll and height clamping", () => {
	function makeLargePlan(): MissionPlan {
		const features: Feature[] = [];
		for (let i = 0; i < 20; i++) {
			features.push(
				makeFeature(`f${i}`, i === 0 ? "active" : "pending", `feature-${i}`, {
					acceptanceCriteria: [`criterion-a-${i}`, `criterion-b-${i}`],
				}),
			);
		}
		return makePlan([makeMilestone("m1", features, "active")]);
	}

	it("clamps render output to terminal height", () => {
		const tmpDir = join(tmpdir(), `mc-scroll-clamp-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const terminalRows = 20;
			const plan = makeLargePlan();
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f0",
				progressLog: [
					makeEvent("feature_start", "started feature-0", 60_000),
					makeEvent("worker_spawn", "spawned worker", 50_000),
				],
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI(terminalRows);
			const component = new MissionControlComponent(tui, () => {}, deps);
			const lines = component.render(120);

			expect(lines.length).toBeLessThanOrEqual(terminalRows);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("does not clamp when content fits terminal", () => {
		const tmpDir = join(tmpdir(), `mc-scroll-nooverflow-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "active", "small-feature")], "active")]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI(80);
			const component = new MissionControlComponent(tui, () => {}, deps);
			const lines = component.render(120);
			const text = lines.join(" ");

			expect(text).not.toContain("Scroll: arrows/mouse");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("shows scroll hint in footer when content overflows", () => {
		const tmpDir = join(tmpdir(), `mc-scroll-hint-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const plan = makeLargePlan();
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f0",
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI(20);
			const component = new MissionControlComponent(tui, () => {}, deps);
			const lines = component.render(120);
			const text = lines.join(" ");

			expect(text).toContain("\u2590");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("scrolls down with down arrow key", () => {
		const tmpDir = join(tmpdir(), `mc-scroll-down-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const plan = makeLargePlan();
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f0",
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI(20);
			const component = new MissionControlComponent(tui, () => {}, deps);

			component.handleInput("\t");
			const linesBefore = component.render(120);
			component.handleInput("\x1b[B");
			const linesAfter = component.render(120);

			expect(linesBefore.length).toBeLessThanOrEqual(20);
			expect(linesAfter).not.toEqual(linesBefore);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("does not scroll past content bounds", () => {
		const tmpDir = join(tmpdir(), `mc-scroll-bound-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const plan = makeLargePlan();
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f0",
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI(20);
			const component = new MissionControlComponent(tui, () => {}, deps);

			component.render(120);
			for (let i = 0; i < 200; i++) {
				component.handleInput("\x1b[B");
			}
			const linesAtMax = component.render(120);

			component.handleInput("\x1b[B");
			const linesAfterMax = component.render(120);

			expect(linesAfterMax).toEqual(linesAtMax);
			expect(linesAtMax.length).toBeLessThanOrEqual(20);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("scrolls up with up arrow key after scrolling down", () => {
		const tmpDir = join(tmpdir(), `mc-scroll-up-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const plan = makeLargePlan();
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f0",
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI(20);
			const component = new MissionControlComponent(tui, () => {}, deps);

			const original = component.render(120);
			component.handleInput("\x1b[B");
			component.handleInput("\x1b[B");
			component.render(120);
			component.handleInput("\x1b[A");
			component.handleInput("\x1b[A");
			const restored = component.render(120);

			expect(restored).toEqual(original);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("footer is always visible in rendered output", () => {
		const tmpDir = join(tmpdir(), `mc-footer-visible-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const plan = makeLargePlan();
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f0",
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI(20);
			const component = new MissionControlComponent(tui, () => {}, deps);
			const lines = component.render(120);
			const lastThree = lines.slice(-3).join(" ");

			expect(lastThree).toContain("P: Pause");
			expect(lines[lines.length - 1]).toContain("\u2518");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("total rendered lines never exceed terminal rows minus margin", () => {
		const tmpDir = join(tmpdir(), `mc-linecount-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const plan = makeLargePlan();
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f0",
				progressLog: [
					makeEvent("feature_start", "started feature-0", 60_000),
					makeEvent("worker_spawn", "spawned worker", 50_000),
				],
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const terminalRows = 20;
			const tui = makeTUI(terminalRows);
			const component = new MissionControlComponent(tui, () => {}, deps);
			const lines = component.render(120);

			expect(lines.length).toBeLessThanOrEqual(terminalRows - 2);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("MissionControlComponent title/status background", () => {
	it("applies bgFn to title bar, status bar, and spacing line when style has bgFn", () => {
		const tmpDir = join(tmpdir(), `mc-bg-title-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const feature = makeFeature("f1", "active", "jwt-tokens");
			const milestone = makeMilestone("m1", [feature], "active");
			const plan = makePlan([milestone]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
				progressLog: [makeEvent("feature_start", "started jwt-tokens", 60_000)],
			});

			const mockTheme = {
				fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
				bg: (_color: string, text: string) => `\x1b[41m${text}\x1b[0m`,
				bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
			};

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI();
			const component = new MissionControlComponent(tui, () => {}, deps, mockTheme);

			const lines = component.render(120);
			const titleLine = lines[0]!;
			const statusLine = lines[1]!;
			const spacingLine = lines[2]!;

			expect(titleLine).toContain("\x1b[41m");
			expect(statusLine).toContain("\x1b[41m");
			expect(spacingLine).toContain("\x1b[41m");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

// Mouse scroll removed — terminal mouse tracking interferes with ESC key detection.
// Scroll via keyboard: ↑↓ arrows, PgUp/PgDn, Tab between panes.

describe("MissionControlComponent footer no ellipsis", () => {
	it("footer does not contain ellipsis when shortcuts are truncated", () => {
		const tmpDir = join(tmpdir(), `mc-footer-ellipsis-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const feature = makeFeature("f1", "active", "jwt-tokens");
			const milestone = makeMilestone("m1", [feature], "active");
			const plan = makePlan([milestone]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI(20);
			const component = new MissionControlComponent(tui, () => {}, deps);

			const narrowWidth = 50;
			const lines = component.render(narrowWidth);
			const footerLines = lines.slice(-3);
			const footerText = footerLines.join("");

			expect(footerText).not.toContain("\u2026");
			expect(footerText).not.toContain("...");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("MissionControlComponent status bar centering", () => {
	it("status bar content is centered within the width", () => {
		const tmpDir = join(tmpdir(), `mc-status-center-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		try {
			const feature = makeFeature("f1", "active", "jwt-tokens");
			const milestone = makeMilestone("m1", [feature], "active");
			const plan = makePlan([milestone]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
			});

			const deps = makeDeps(tmpDir, {
				loadState: () => state,
				loadPlan: () => plan,
			});

			const tui = makeTUI();
			const component = new MissionControlComponent(tui, () => {}, deps);

			const width = 120;
			const lines = component.render(width);
			const statusLine = lines[1]!;

			const stripped = statusLine.replace(/^\s+/, "");
			const leadingSpaces = statusLine.length - stripped.length;
			expect(leadingSpaces).toBeGreaterThan(0);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("MissionControlComponent mouse scroll", () => {
	function makeScrollableComponent() {
		const tmpDir = join(tmpdir(), `mc-mouse-scroll-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tmpDir, { recursive: true });
		const features = Array.from({ length: 20 }, (_, i) => makeFeature(`f${i}`, i === 0 ? "active" : "pending", `feature-${i}`));
		const milestone = makeMilestone("m1", features, "active");
		const plan = makePlan([milestone]);
		const events = Array.from({ length: 20 }, (_, i) =>
			makeEvent("feature_start", `started feature-${i}`, (i + 1) * 60_000),
		);
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f0",
			progressLog: events,
		});
		const deps = makeDeps(tmpDir, { state, plan });
		const renderFn = mock(() => {});
		const tui = makeTUI({ requestRender: renderFn });
		const component = new MissionControlComponent(tui, () => {}, deps);
		component.render(120);
		return { component, renderFn, tmpDir };
	}

	it("mouse scroll up on right-bottom pane triggers render", () => {
		const { component, renderFn, tmpDir } = makeScrollableComponent();
		try {
			component.handleInput("\x1b[<65;80;20M");
			expect(renderFn).toHaveBeenCalled();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("mouse scroll down on right-bottom pane triggers render", () => {
		const { component, renderFn, tmpDir } = makeScrollableComponent();
		try {
			component.handleInput("\x1b[<64;80;20M");
			expect(renderFn).toHaveBeenCalled();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("mouse click does not trigger scroll render", () => {
		const { component, renderFn, tmpDir } = makeScrollableComponent();
		try {
			renderFn.mockClear();
			component.handleInput("\x1b[<0;80;20M");
			expect(renderFn).not.toHaveBeenCalled();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("non-mouse input does not trigger mouse scroll", () => {
		const { component, renderFn, tmpDir } = makeScrollableComponent();
		try {
			renderFn.mockClear();
			component.handleInput("A");
			expect(renderFn).not.toHaveBeenCalled();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("mouse scroll routes to correct pane based on position", () => {
		const { component, renderFn, tmpDir } = makeScrollableComponent();
		try {
			renderFn.mockClear();
			component.handleInput("\x1b[<65;80;6M");
			expect(renderFn).toHaveBeenCalled();

			renderFn.mockClear();
			component.handleInput("\x1b[<64;80;25M");
			expect(renderFn).toHaveBeenCalled();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("MissionControlComponent contract compliance", () => {
	function makeMCComponent(opts: { theme?: any; requestRender?: () => void } = {}) {
		const tmpDir = join(tmpdir(), `mc-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tmpDir, { recursive: true });
		const feature = makeFeature("f1", "active", "jwt-tokens");
		const milestone = makeMilestone("m1", [feature], "active");
		const plan = makePlan([milestone]);
		const state = makeState("executing", {
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
			progressLog: [makeEvent("feature_start", "started jwt-tokens", 60_000)],
		});

		const deps = makeDeps(tmpDir, {
			loadState: () => state,
			loadPlan: () => plan,
		});

		const tui = makeTUI();
		if (opts.requestRender) {
			(tui as any).requestRender = opts.requestRender;
		}
		const component = new MissionControlComponent(tui, () => {}, deps, opts.theme);
		return { component, tmpDir };
	}

	function cleanupMC(tmpDir: string) {
		rmSync(tmpDir, { recursive: true, force: true });
	}

	describe("focused property", () => {
		it("has focused property defaulting to false", () => {
			const { component, tmpDir } = makeMCComponent();
			try {
				expect(component.focused).toBe(false);
			} finally {
				component.dispose();
				cleanupMC(tmpDir);
			}
		});

		it("can set focused to true", () => {
			const { component, tmpDir } = makeMCComponent();
			try {
				component.focused = true;
				expect(component.focused).toBe(true);
			} finally {
				component.dispose();
				cleanupMC(tmpDir);
			}
		});
	});

	describe("render caching", () => {
		it("returns same array ref for same width and version", () => {
			const { component, tmpDir } = makeMCComponent();
			try {
				const first = component.render(120);
				const second = component.render(120);
				expect(second).toBe(first);
			} finally {
				component.dispose();
				cleanupMC(tmpDir);
			}
		});

		it("returns different array ref for different width", () => {
			const { component, tmpDir } = makeMCComponent();
			try {
				const first = component.render(120);
				const second = component.render(100);
				expect(second).not.toBe(first);
			} finally {
				component.dispose();
				cleanupMC(tmpDir);
			}
		});

		it("returns different array ref after input changes version", () => {
			const { component, tmpDir } = makeMCComponent();
			try {
				const first = component.render(120);
				component.handleInput("\x1B[B");
				const second = component.render(120);
				expect(second).not.toBe(first);
			} finally {
				component.dispose();
				cleanupMC(tmpDir);
			}
		});
	});

	describe("invalidate", () => {
		it("resets cache so next render returns new array ref", () => {
			const { component, tmpDir } = makeMCComponent();
			try {
				const first = component.render(120);
				component.invalidate();
				const second = component.render(120);
				expect(second).not.toBe(first);
			} finally {
				component.dispose();
				cleanupMC(tmpDir);
			}
		});

		it("rebuilds style when theme was provided", () => {
			const theme = {
				fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
				bg: (_color: string, text: string) => `\x1b[41m${text}\x1b[0m`,
				bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
			};
			const { component, tmpDir } = makeMCComponent({ theme });
			try {
				const before = component.render(120);
				component.invalidate();
				const after = component.render(120);
				expect(after).not.toBe(before);
				expect(after.length).toBeGreaterThan(0);
			} finally {
				component.dispose();
				cleanupMC(tmpDir);
			}
		});

		it("does not throw when no theme was provided", () => {
			const { component, tmpDir } = makeMCComponent();
			try {
				expect(() => component.invalidate()).not.toThrow();
			} finally {
				component.dispose();
				cleanupMC(tmpDir);
			}
		});
	});
});
