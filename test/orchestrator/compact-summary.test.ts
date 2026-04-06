import { afterEach, describe, expect, it } from "bun:test";
import { buildCompactMissionSummary, clearProtocolCache } from "../../extensions/orchestrator/protocol.js";
import { makeFeature, makeMilestone, makePlan, makeState } from "../helpers/index.js";

function makeProtocolPlan(overrides: Parameters<typeof makePlan>[0] = {}) {
	return makePlan({
		description: "Build a CRM",
		milestones: [
			makeMilestone({
				id: "m1",
				name: "Foundation",
				description: "Core data models",
				features: [
					makeFeature({ id: "f1", name: "user-model", status: "done" }),
					makeFeature({ id: "f2", name: "auth-endpoint", status: "active" }),
					makeFeature({ id: "f3", name: "refresh-tokens", status: "pending" }),
				],
				status: "active",
			}),
			makeMilestone({
				id: "m2",
				name: "Validation",
				description: "Validation milestone",
				features: [makeFeature({ id: "f4", name: "audit-logs", status: "pending" })],
			}),
		],
		validationCommands: ["npm test"],
		...overrides,
	});
}

describe("buildCompactMissionSummary", () => {
	afterEach(() => {
		clearProtocolCache();
	});

	it("returns status and progress counts", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
			totalFeaturesSkipped: 0,
			totalFeaturesFailed: 0,
		});
		const plan = makeProtocolPlan();
		const result = buildCompactMissionSummary(state, plan);
		expect(result).toContain("executing");
		expect(result).toContain("1/4");
	});

	it("includes current feature name from plan", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
		});
		const plan = makeProtocolPlan();
		const result = buildCompactMissionSummary(state, plan);
		expect(result).toContain("auth-endpoint");
	});

	it("includes current milestone name from plan", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
		});
		const plan = makeProtocolPlan();
		const result = buildCompactMissionSummary(state, plan);
		expect(result).toContain("Foundation");
	});

	it("works without a plan", () => {
		const state = makeState({
			status: "executing",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
			totalFeaturesSkipped: 1,
			totalFeaturesFailed: 0,
		});
		const result = buildCompactMissionSummary(state);
		expect(result).toContain("executing");
		expect(result).toContain("2/0");
	});

	it("includes failed count", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
			totalFeaturesFailed: 2,
		});
		const plan = makeProtocolPlan();
		const result = buildCompactMissionSummary(state, plan);
		expect(result).toContain("2 failed");
	});

	it("counts skipped in done total", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f3",
			totalFeaturesCompleted: 1,
			totalFeaturesSkipped: 1,
			totalFeaturesFailed: 0,
		});
		const plan = makeProtocolPlan();
		const result = buildCompactMissionSummary(state, plan);
		expect(result).toContain("2/4");
	});

	it("shows 'none' for current feature when no feature set", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			totalFeaturesCompleted: 1,
		});
		const plan = makeProtocolPlan();
		const result = buildCompactMissionSummary(state, plan);
		expect(result).toMatch(/Current:.*none/i);
	});

	it("shows 'none' for milestone when not set", () => {
		const state = makeState({
			status: "executing",
			totalFeaturesCompleted: 0,
		});
		const result = buildCompactMissionSummary(state);
		expect(result).toMatch(/milestone.*none/i);
	});

	it("includes instruction to continue", () => {
		const state = makeState({ status: "executing" });
		const result = buildCompactMissionSummary(state);
		expect(result.toLowerCase()).toContain("continue");
	});

	it("is a single-line-ish compact summary (no excessive newlines)", () => {
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
		});
		const plan = makeProtocolPlan();
		const result = buildCompactMissionSummary(state, plan);
		const lines = result.split("\n").filter((l) => l.trim());
		expect(lines.length).toBeLessThanOrEqual(3);
	});
});
