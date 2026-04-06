import { describe, expect, it } from "bun:test";
import { countProgress } from "../../extensions/ui/count-progress.js";
import { makeFeature, makeMilestone, makePlan, makeState } from "../helpers/index.js";

describe("countProgress", () => {
	it("returns {done: 0, total: 0, hasActive: false} when no plan provided and state counters are zero", () => {
		const state = makeState({ totalFeaturesCompleted: 0, totalFeaturesSkipped: 0, totalFeaturesFailed: 0 });
		const result = countProgress(state);
		expect(result).toEqual({ done: 0, total: 0, hasActive: false });
	});

	it("returns correct counts from plan features as source of truth", () => {
		const plan = makePlan({
			milestones: [
				makeMilestone({
					features: [
						makeFeature({ id: "f1", status: "done" }),
						makeFeature({ id: "f2", status: "pending" }),
						makeFeature({ id: "f3", status: "pending" }),
					],
				}),
			],
		});
		const state = makeState({ totalFeaturesCompleted: 99, totalFeaturesSkipped: 99 });
		const result = countProgress(state, plan);
		expect(result).toEqual({ done: 1, total: 3, hasActive: false });
	});

	it("counts done and skipped features as done", () => {
		const plan = makePlan({
			milestones: [
				makeMilestone({
					features: [
						makeFeature({ id: "f1", status: "done" }),
						makeFeature({ id: "f2", status: "skipped" }),
						makeFeature({ id: "f3", status: "pending" }),
					],
				}),
			],
		});
		const state = makeState();
		const result = countProgress(state, plan);
		expect(result.done).toBe(2);
		expect(result.total).toBe(3);
	});

	it("counts active feature correctly with hasActive true", () => {
		const plan = makePlan({
			milestones: [
				makeMilestone({
					features: [
						makeFeature({ id: "f1", status: "done" }),
						makeFeature({ id: "f2", status: "active" }),
						makeFeature({ id: "f3", status: "pending" }),
					],
				}),
			],
		});
		const state = makeState();
		const result = countProgress(state, plan);
		expect(result.done).toBe(1);
		expect(result.total).toBe(3);
		expect(result.hasActive).toBe(true);
	});

	it("falls back to state counters when no plan provided", () => {
		const state = makeState({
			totalFeaturesCompleted: 3,
			totalFeaturesSkipped: 2,
			totalFeaturesFailed: 1,
			currentFeatureId: "f-active",
		});
		const result = countProgress(state);
		expect(result.done).toBe(5);
		expect(result.total).toBe(6);
		expect(result.hasActive).toBe(true);
	});

	it("handles empty milestones", () => {
		const plan = makePlan({ milestones: [] });
		const state = makeState();
		const result = countProgress(state, plan);
		expect(result).toEqual({ done: 0, total: 0, hasActive: false });
	});

	it("handles multiple milestones with mixed statuses", () => {
		const plan = makePlan({
			milestones: [
				makeMilestone({
					id: "m1",
					features: [makeFeature({ id: "f1", status: "done" }), makeFeature({ id: "f2", status: "done" })],
				}),
				makeMilestone({
					id: "m2",
					features: [
						makeFeature({ id: "f3", status: "active" }),
						makeFeature({ id: "f4", status: "pending" }),
						makeFeature({ id: "f5", status: "failed" }),
					],
				}),
			],
		});
		const state = makeState();
		const result = countProgress(state, plan);
		expect(result.done).toBe(2);
		expect(result.total).toBe(5);
		expect(result.hasActive).toBe(true);
	});

	it("counts fix features (fixOrigin) the same as regular features", () => {
		const plan = makePlan({
			milestones: [
				makeMilestone({
					features: [
						makeFeature({ id: "f1", status: "done" }),
						makeFeature({
							id: "f2",
							status: "done",
							fixOrigin: {
								sourceKind: "worker-failure",
								sourceFeatureId: "f1",
							},
						}),
						makeFeature({ id: "f3", status: "pending" }),
					],
				}),
			],
		});
		const state = makeState();
		const result = countProgress(state, plan);
		expect(result.done).toBe(2);
		expect(result.total).toBe(3);
	});
});
