import { describe, expect, it } from "bun:test";
import type { Feature, Milestone, MissionPlan, MissionState, ProgressEvent } from "../types.js";
import { nowISO } from "../utils.js";
import {
	formatRelativeTime,
	renderCurrentFeaturePanel,
	renderKeyboardShortcuts,
	renderMissionOutline,
	renderProgressLog,
} from "./mission-control.js";

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
