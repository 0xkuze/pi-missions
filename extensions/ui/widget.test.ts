import { describe, expect, it } from "bun:test";
import type { Feature, Milestone, MissionPlan, MissionState } from "../types.js";
import { nowISO } from "../utils.js";
import { buildWidgetLines } from "./widget.js";

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

function makeFeature(id: string, status: Feature["status"], name?: string): Feature {
	return {
		id,
		name: name ?? `Feature ${id}`,
		description: "A feature",
		acceptanceCriteria: ["criterion"],
		relevantFiles: [],
		dependencies: [],
		estimatedComplexity: "low",
		status,
		attempts: [],
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

describe("buildWidgetLines", () => {
	describe("idle / no-mission states", () => {
		it("returns empty array for aborted state (VAL-UI-012)", () => {
			const state = makeState("aborted");
			const lines = buildWidgetLines(state);
			expect(lines).toBeArray();
			expect(lines.length).toBe(0);
		});

		it("returns non-empty lines for planning state (VAL-UI-012)", () => {
			const state = makeState("planning");
			const lines = buildWidgetLines(state);
			expect(lines).toBeArray();
			expect(lines.length).toBeGreaterThan(0);
		});
	});

	describe("planning state (VAL-UI-001)", () => {
		it("shows planning indicator with analyzing codebase text", () => {
			const state = makeState("planning");
			const lines = buildWidgetLines(state);
			expect(lines.length).toBeGreaterThan(0);
			const line = lines.join(" ");
			expect(line).toContain("Planning");
			expect(line).toContain("analyzing codebase");
		});

		it("shows planning emoji ⏳", () => {
			const state = makeState("planning");
			const lines = buildWidgetLines(state);
			const line = lines.join(" ");
			expect(line).toContain("⏳");
		});
	});

	describe("draft_review state (VAL-UI-001)", () => {
		it("shows draft indicator with milestone/feature counts and awaiting approval", () => {
			const milestones = [
				makeMilestone("m1", [makeFeature("f1", "pending"), makeFeature("f2", "pending")]),
				makeMilestone("m2", [makeFeature("f3", "pending")]),
			];
			const plan = makePlan(milestones);
			const state = makeState("draft_review");
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("Draft");
			expect(line).toContain("2");
			expect(line).toContain("3");
			expect(line).toContain("awaiting approval");
		});

		it("shows draft emoji 📋", () => {
			const state = makeState("draft_review");
			const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "pending")])]);
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("📋");
		});

		it("shows counts without plan", () => {
			const state = makeState("draft_review");
			const lines = buildWidgetLines(state);
			expect(lines.length).toBeGreaterThan(0);
			const line = lines.join(" ");
			expect(line).toContain("Draft");
		});
	});

	describe("approved state (VAL-UI-012, VAL-UI-014)", () => {
		it("shows approved indicator with starting execution text", () => {
			const state = makeState("approved");
			const lines = buildWidgetLines(state);
			expect(lines.length).toBeGreaterThan(0);
			const line = lines.join(" ");
			expect(line).toContain("Approved");
		});

		it("does not throw or return empty for approved state", () => {
			const state = makeState("approved");
			const plan = makePlan([makeMilestone("m1", [makeFeature("f1", "pending")])]);
			const lines = buildWidgetLines(state, plan);
			expect(lines.length).toBeGreaterThan(0);
		});
	});

	describe("executing state (VAL-UI-001)", () => {
		it("shows running indicator with progress bar", () => {
			const features = [makeFeature("f1", "done"), makeFeature("f2", "active"), makeFeature("f3", "pending")];
			const plan = makePlan([makeMilestone("m1", features, "active")]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
			});
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("●");
			expect(line).toContain("Running");
		});

		it("shows current milestone name", () => {
			const milestone = makeMilestone("m1", [makeFeature("f1", "active")], "active");
			milestone.name = "auth";
			const plan = makePlan([milestone]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
			});
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("auth");
		});

		it("shows current feature name", () => {
			const feature = makeFeature("f1", "active", "jwt-tokens");
			const plan = makePlan([makeMilestone("m1", [feature], "active")]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
			});
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("jwt-tokens");
		});
	});

	describe("paused state (VAL-UI-001)", () => {
		it("shows paused indicator with waiting for input", () => {
			const features = [makeFeature("f1", "done"), makeFeature("f2", "pending")];
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("paused", { resumeTargetState: "executing" });
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("⏸");
			expect(line).toContain("Paused");
			expect(line).toContain("waiting for input");
		});

		it("shows progress bar with paused state", () => {
			const features = [makeFeature("f1", "done"), makeFeature("f2", "pending")];
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("paused", { resumeTargetState: "executing", totalFeaturesCompleted: 1 });
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("█");
		});
	});

	describe("validating state (VAL-UI-001, VAL-UI-014)", () => {
		it("shows validating milestone text", () => {
			const state = makeState("validating", { currentMilestoneId: "m1" });
			const milestone = makeMilestone("m1", [makeFeature("f1", "done")], "active");
			milestone.name = "core";
			const plan = makePlan([milestone]);
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("Validating");
		});

		it("does not throw or return empty for validating state", () => {
			const state = makeState("validating");
			const lines = buildWidgetLines(state);
			expect(lines.length).toBeGreaterThan(0);
		});
	});

	describe("completed state (VAL-UI-001)", () => {
		it("shows done indicator with full bar and report ready", () => {
			const features = [makeFeature("f1", "done"), makeFeature("f2", "done")];
			const plan = makePlan([makeMilestone("m1", features, "done")]);
			const state = makeState("completed", { completedAt: nowISO(), totalFeaturesCompleted: 2 });
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("✓");
			expect(line).toContain("Done");
			expect(line).toContain("report ready");
		});

		it("shows full progress bar for completed state", () => {
			const features = [makeFeature("f1", "done"), makeFeature("f2", "done")];
			const plan = makePlan([makeMilestone("m1", features, "done")]);
			const state = makeState("completed", { completedAt: nowISO(), totalFeaturesCompleted: 2 });
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).not.toContain("░");
			expect(line).toContain("█");
		});
	});

	describe("failed state (VAL-UI-001)", () => {
		it("shows failed indicator with bar and blocked feature info", () => {
			const features = [makeFeature("f1", "done"), makeFeature("f2", "failed")];
			const plan = makePlan([makeMilestone("m1", features, "failed")]);
			const state = makeState("failed", {
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
				totalFeaturesFailed: 1,
			});
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("✗");
			expect(line).toContain("Failed");
		});

		it("shows blocked feature name when available", () => {
			const features = [makeFeature("f1", "done"), makeFeature("f2", "failed", "jwt-tokens")];
			const plan = makePlan([makeMilestone("m1", features, "failed")]);
			const state = makeState("failed", {
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
				totalFeaturesFailed: 1,
			});
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("jwt-tokens");
		});
	});

	describe("progress bar (VAL-UI-002)", () => {
		it("uses █ for done features", () => {
			const features = [makeFeature("f1", "done"), makeFeature("f2", "pending")];
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("executing", { totalFeaturesCompleted: 1 });
			const lines = buildWidgetLines(state, plan);
			const line = lines.join("");
			expect(line).toContain("█");
		});

		it("uses ▓ for exactly one active feature", () => {
			const features = [makeFeature("f1", "done"), makeFeature("f2", "active"), makeFeature("f3", "pending")];
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("executing", {
				currentFeatureId: "f2",
				totalFeaturesCompleted: 1,
			});
			const lines = buildWidgetLines(state, plan);
			const line = lines.join("");
			expect(line).toContain("▓");
		});

		it("uses ░ for pending features", () => {
			const features = [makeFeature("f1", "pending"), makeFeature("f2", "pending")];
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("executing");
			const lines = buildWidgetLines(state, plan);
			const line = lines.join("");
			expect(line).toContain("░");
			expect(line).not.toContain("█");
		});

		it("zero done → all pending chars", () => {
			const features = [makeFeature("f1", "pending"), makeFeature("f2", "pending")];
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("executing");
			const lines = buildWidgetLines(state, plan);
			const line = lines.join("");
			expect(line).not.toContain("█");
			expect(line).not.toContain("▓");
			expect(line).toContain("░");
		});

		it("all done → all █ (no ░ or ▓)", () => {
			const features = [makeFeature("f1", "done"), makeFeature("f2", "done")];
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("executing", { totalFeaturesCompleted: 2 });
			const lines = buildWidgetLines(state, plan);
			const line = lines.join("");
			expect(line).not.toContain("░");
			expect(line).not.toContain("▓");
			expect(line).toContain("█");
		});

		it("skipped features count as done (VAL-UI-002)", () => {
			const features = [makeFeature("f1", "skipped"), makeFeature("f2", "skipped")];
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("executing", { totalFeaturesSkipped: 2 });
			const lines = buildWidgetLines(state, plan);
			const line = lines.join("");
			expect(line).toContain("█");
			expect(line).not.toContain("░");
		});

		it("bar always totals exactly barWidth characters (VAL-UI-002)", () => {
			const barWidth = 10;
			const features = [
				makeFeature("f1", "done"),
				makeFeature("f2", "done"),
				makeFeature("f3", "active"),
				makeFeature("f4", "pending"),
				makeFeature("f5", "pending"),
				makeFeature("f6", "pending"),
				makeFeature("f7", "pending"),
			];
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("executing", { totalFeaturesCompleted: 2 });
			const lines = buildWidgetLines(state, plan, barWidth);
			const barLine = lines.find((l) => l.includes("█") || l.includes("▓") || l.includes("░"));
			expect(barLine).toBeDefined();

			const barChars = (barLine ?? "").split("").filter((c) => c === "█" || c === "▓" || c === "░");
			expect(barChars.length).toBe(barWidth);
		});

		it("bar totals barWidth with different feature counts (rounding test) (VAL-UI-002)", () => {
			const barWidth = 10;
			const features = Array.from({ length: 7 }, (_, i) => makeFeature(`f${i + 1}`, i < 3 ? "done" : "pending"));
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("executing", { totalFeaturesCompleted: 3 });
			const lines = buildWidgetLines(state, plan, barWidth);
			const barLine = lines.find((l) => l.includes("█") || l.includes("▓") || l.includes("░"));
			const barChars = (barLine ?? "").split("").filter((c) => c === "█" || c === "▓" || c === "░");
			expect(barChars.length).toBe(barWidth);
		});

		it("fix features included in total feature count (VAL-UI-002)", () => {
			const features = [
				makeFeature("f1", "done"),
				{ ...makeFeature("fix1", "pending"), fixOrigin: { sourceKind: "worker-failure" as const } },
			];
			const plan = makePlan([makeMilestone("m1", features)]);
			const state = makeState("executing", { totalFeaturesCompleted: 1 });
			const lines = buildWidgetLines(state, plan);
			const line = lines.join(" ");
			expect(line).toContain("2");
		});
	});

	describe("long name truncation (VAL-UI-002)", () => {
		it("truncates very long milestone names to fit line width", () => {
			const longName = "a".repeat(100);
			const milestone = makeMilestone("m1", [makeFeature("f1", "active")], "active");
			milestone.name = longName;
			const plan = makePlan([milestone]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
			});
			const lines = buildWidgetLines(state, plan);
			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(120);
			}
		});

		it("truncates very long feature names to fit line width", () => {
			const longName = "b".repeat(100);
			const feature = makeFeature("f1", "active", longName);
			const plan = makePlan([makeMilestone("m1", [feature], "active")]);
			const state = makeState("executing", {
				currentMilestoneId: "m1",
				currentFeatureId: "f1",
			});
			const lines = buildWidgetLines(state, plan);
			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(120);
			}
		});
	});

	describe("updateWidget export", () => {
		it("updateWidget is exported from widget module", async () => {
			const mod = await import("./widget.js");
			expect(typeof mod.updateWidget).toBe("function");
		});

		it("updateWidget calls setWidget with mission name and widget lines", () => {
			const { updateWidget } = require("./widget.js");
			const setWidget = (() => {
				const calls: Array<[string, string[]]> = [];
				return {
					calls,
					fn: (name: string, lines: string[]) => calls.push([name, lines]),
				};
			})();
			const ui = { setWidget: setWidget.fn };
			const state = makeState("planning");
			updateWidget(ui, state);
			expect(setWidget.calls.length).toBe(1);
			expect(setWidget.calls[0]![0]).toBe("mission");
			expect(Array.isArray(setWidget.calls[0]![1])).toBe(true);
		});
	});
});
