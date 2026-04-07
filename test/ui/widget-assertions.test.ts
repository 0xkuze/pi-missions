import { describe, expect, it } from "bun:test";
import { buildWidgetLines } from "../../extensions/ui/widget.js";
import { makeFeature, makeMilestone, makePlan, makeState } from "../helpers/index.js";

describe("buildWidgetLines — assertion counts (VAL-VALUI-002)", () => {
	it("includes assertion counts in validating state", () => {
		const feature = makeFeature({ id: "f1", status: "done" });
		const milestone = makeMilestone({ id: "m1", features: [feature], status: "active" });
		milestone.name = "Auth";
		const plan = makePlan({ milestones: [milestone] });
		const state = makeState({
			status: "validating",
			currentMilestoneId: "m1",
			totalFeaturesCompleted: 1,
		});
		const lines = buildWidgetLines(state, plan, undefined, undefined, {
			assertionsPassed: 3,
			assertionsTotal: 5,
		});
		const line = lines.join(" ");
		expect(line).toMatch(/3\/5/);
		expect(line).toMatch(/assertions/i);
	});

	it("includes assertion counts in executing state after validation", () => {
		const feature1 = makeFeature({ id: "f1", status: "done" });
		const feature2 = makeFeature({ id: "f2", status: "active" });
		const milestone = makeMilestone({ id: "m1", features: [feature1, feature2], status: "active" });
		milestone.name = "Auth";
		const plan = makePlan({ milestones: [milestone] });
		const state = makeState({
			status: "executing",
			currentMilestoneId: "m1",
			currentFeatureId: "f2",
			totalFeaturesCompleted: 1,
		});
		const lines = buildWidgetLines(state, plan, undefined, undefined, {
			assertionsPassed: 5,
			assertionsTotal: 5,
		});
		const line = lines.join(" ");
		expect(line).toMatch(/5\/5/);
		expect(line).toMatch(/assertions/i);
	});

	it("does not show assertion counts when not provided", () => {
		const feature = makeFeature({ id: "f1", status: "done" });
		const milestone = makeMilestone({ id: "m1", features: [feature], status: "active" });
		const plan = makePlan({ milestones: [milestone] });
		const state = makeState({
			status: "validating",
			currentMilestoneId: "m1",
			totalFeaturesCompleted: 1,
		});
		const lines = buildWidgetLines(state, plan);
		const line = lines.join(" ");
		expect(line).not.toMatch(/\d+\/\d+ assertions/);
	});
});
