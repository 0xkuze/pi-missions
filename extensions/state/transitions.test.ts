import { describe, expect, it } from "bun:test";
import type { MissionState, MissionStatus } from "../types.js";
import { transitionState } from "./transitions.js";

const BASE_STATE: MissionState = {
	missionId: "mission-001",
	status: "planning",
	progressLog: [],
	startedAt: "2024-01-01T00:00:00.000Z",
	totalFeaturesCompleted: 0,
	totalFeaturesFailed: 0,
	totalFeaturesSkipped: 0,
	totalFixFeaturesCreated: 0,
};

function makeState(status: MissionStatus, overrides: Partial<MissionState> = {}): MissionState {
	return { ...BASE_STATE, status, ...overrides };
}

const FIXED_TS = "2024-01-01T12:00:00.000Z";

describe("transitionState", () => {
	describe("forward transitions", () => {
		it("planning -> draft_review", () => {
			const state = makeState("planning");
			const next = transitionState(state, "draft_review", FIXED_TS);
			expect(next.status).toBe("draft_review");
			expect(next.progressLog).toHaveLength(1);
			expect(next.progressLog[0].type).toBe("plan_submitted");
			expect(next.progressLog[0].timestamp).toBe(FIXED_TS);
			expect(next.progressLog[0].detail).toBeTruthy();
		});

		it("draft_review -> approved", () => {
			const state = makeState("draft_review");
			const next = transitionState(state, "approved", FIXED_TS);
			expect(next.status).toBe("approved");
			expect(next.progressLog).toHaveLength(1);
			expect(next.progressLog[0].type).toBe("plan_approved");
			expect(next.progressLog[0].timestamp).toBe(FIXED_TS);
		});

		it("approved -> executing", () => {
			const state = makeState("approved");
			const next = transitionState(state, "executing", FIXED_TS);
			expect(next.status).toBe("executing");
			expect(next.progressLog).toHaveLength(1);
			expect(next.progressLog[0].type).toBe("feature_start");
		});

		it("executing -> validating", () => {
			const state = makeState("executing");
			const next = transitionState(state, "validating", FIXED_TS);
			expect(next.status).toBe("validating");
			expect(next.progressLog).toHaveLength(1);
			expect(next.progressLog[0].type).toBe("validation_start");
		});

		it("validating -> executing", () => {
			const state = makeState("validating");
			const next = transitionState(state, "executing", FIXED_TS);
			expect(next.status).toBe("executing");
			expect(next.progressLog).toHaveLength(1);
			expect(next.progressLog[0].type).toBe("feature_start");
		});

		it("executing -> completed", () => {
			const state = makeState("executing");
			const next = transitionState(state, "completed", FIXED_TS);
			expect(next.status).toBe("completed");
			expect(next.completedAt).toBe(FIXED_TS);
			expect(next.progressLog).toHaveLength(1);
			expect(next.progressLog[0].type).toBe("mission_complete");
		});

		it("full lifecycle: planning -> draft_review -> approved -> executing -> validating -> executing -> completed", () => {
			let state = makeState("planning");
			state = transitionState(state, "draft_review", FIXED_TS);
			state = transitionState(state, "approved", FIXED_TS);
			state = transitionState(state, "executing", FIXED_TS);
			state = transitionState(state, "validating", FIXED_TS);
			state = transitionState(state, "executing", FIXED_TS);
			state = transitionState(state, "completed", FIXED_TS);
			expect(state.status).toBe("completed");
			expect(state.progressLog).toHaveLength(6);
			expect(state.completedAt).toBe(FIXED_TS);
		});

		it("preserves existing progressLog entries", () => {
			const state = makeState("planning", {
				progressLog: [{ timestamp: "2024-01-01T10:00:00.000Z", type: "mission_started", detail: "Started" }],
			});
			const next = transitionState(state, "draft_review", FIXED_TS);
			expect(next.progressLog).toHaveLength(2);
			expect(next.progressLog[0].type).toBe("mission_started");
			expect(next.progressLog[1].type).toBe("plan_submitted");
		});

		it("preserves all tracking counters across forward transitions", () => {
			const state = makeState("planning", {
				totalFeaturesCompleted: 3,
				totalFeaturesFailed: 1,
				totalFeaturesSkipped: 2,
				totalFixFeaturesCreated: 1,
				currentMilestoneId: "m-1",
				currentFeatureId: "f-2",
			});
			const next = transitionState(state, "draft_review", FIXED_TS);
			expect(next.totalFeaturesCompleted).toBe(3);
			expect(next.totalFeaturesFailed).toBe(1);
			expect(next.totalFeaturesSkipped).toBe(2);
			expect(next.totalFixFeaturesCreated).toBe(1);
			expect(next.currentMilestoneId).toBe("m-1");
			expect(next.currentFeatureId).toBe("f-2");
		});

		it("uses current timestamp when none provided", () => {
			const before = Date.now();
			const state = makeState("planning");
			const next = transitionState(state, "draft_review");
			const after = Date.now();
			const ts = new Date(next.progressLog[0].timestamp).getTime();
			expect(ts).toBeGreaterThanOrEqual(before);
			expect(ts).toBeLessThanOrEqual(after);
		});
	});

	describe("invalid transitions", () => {
		it("throws on planning -> executing (skipping states)", () => {
			const state = makeState("planning");
			expect(() => transitionState(state, "executing")).toThrow();
		});

		it("throws on planning -> approved (skipping states)", () => {
			const state = makeState("planning");
			expect(() => transitionState(state, "approved")).toThrow();
		});

		it("throws on planning -> completed (skipping states)", () => {
			const state = makeState("planning");
			expect(() => transitionState(state, "completed")).toThrow();
		});

		it("throws on draft_review -> executing (skipping states)", () => {
			const state = makeState("draft_review");
			expect(() => transitionState(state, "executing")).toThrow();
		});

		it("throws on approved -> completed (skipping executing)", () => {
			const state = makeState("approved");
			expect(() => transitionState(state, "completed")).toThrow();
		});

		it("throws on approved -> validating (skipping executing)", () => {
			const state = makeState("approved");
			expect(() => transitionState(state, "validating")).toThrow();
		});

		it("throws on validating -> completed (must go through executing)", () => {
			const state = makeState("validating");
			expect(() => transitionState(state, "completed")).toThrow();
		});

		it("throws descriptive error for invalid transitions", () => {
			const state = makeState("planning");
			expect(() => transitionState(state, "executing")).toThrow(/planning.*executing|executing.*planning/);
		});
	});

	describe("terminal state stickiness", () => {
		const terminalStates: MissionStatus[] = ["completed", "failed", "aborted"];
		const allTargets: MissionStatus[] = [
			"planning",
			"draft_review",
			"approved",
			"executing",
			"validating",
			"paused",
			"completed",
			"failed",
			"aborted",
		];

		for (const terminal of terminalStates) {
			for (const target of allTargets) {
				it(`throws when transitioning from terminal '${terminal}' to '${target}'`, () => {
					const state = makeState(terminal, { completedAt: FIXED_TS });
					expect(() => transitionState(state, target)).toThrow();
				});
			}
		}
	});

	describe("failed transition from any active state", () => {
		const activeStates: MissionStatus[] = ["planning", "draft_review", "approved", "executing", "validating"];

		for (const active of activeStates) {
			it(`${active} -> failed`, () => {
				const state = makeState(active);
				const next = transitionState(state, "failed", FIXED_TS);
				expect(next.status).toBe("failed");
				expect(next.completedAt).toBe(FIXED_TS);
				expect(next.progressLog).toHaveLength(1);
				expect(next.progressLog[0].type).toBe("mission_failed");
				expect(next.progressLog[0].timestamp).toBe(FIXED_TS);
			});
		}
	});

	describe("aborted transition from any active state", () => {
		const activeAndPaused: MissionStatus[] = [
			"planning",
			"draft_review",
			"approved",
			"executing",
			"validating",
			"paused",
		];

		for (const active of activeAndPaused) {
			it(`${active} -> aborted`, () => {
				const stateOverride = active === "paused" ? { resumeTargetState: "executing" as const } : {};
				const state = makeState(active, stateOverride);
				const next = transitionState(state, "aborted", FIXED_TS);
				expect(next.status).toBe("aborted");
				expect(next.completedAt).toBe(FIXED_TS);
				expect(next.progressLog).toHaveLength(1);
				expect(next.progressLog[0].type).toBe("mission_aborted");
				expect(next.progressLog[0].timestamp).toBe(FIXED_TS);
				expect(next.resumeTargetState).toBeUndefined();
			});
		}
	});

	describe("failed and aborted set completedAt", () => {
		it("failed sets completedAt", () => {
			const state = makeState("executing");
			expect(state.completedAt).toBeUndefined();
			const next = transitionState(state, "failed", FIXED_TS);
			expect(next.completedAt).toBe(FIXED_TS);
		});

		it("aborted sets completedAt", () => {
			const state = makeState("executing");
			expect(state.completedAt).toBeUndefined();
			const next = transitionState(state, "aborted", FIXED_TS);
			expect(next.completedAt).toBe(FIXED_TS);
		});

		it("completed sets completedAt", () => {
			const state = makeState("executing");
			expect(state.completedAt).toBeUndefined();
			const next = transitionState(state, "completed", FIXED_TS);
			expect(next.completedAt).toBe(FIXED_TS);
		});
	});

	describe("pause/resume", () => {
		it("pausing from executing stores resumeTargetState", () => {
			const state = makeState("executing");
			const next = transitionState(state, "paused", FIXED_TS);
			expect(next.status).toBe("paused");
			expect(next.resumeTargetState).toBe("executing");
			expect(next.progressLog).toHaveLength(1);
			expect(next.progressLog[0].type).toBe("pause");
			expect(next.progressLog[0].timestamp).toBe(FIXED_TS);
		});

		it("pausing from validating stores resumeTargetState", () => {
			const state = makeState("validating");
			const next = transitionState(state, "paused", FIXED_TS);
			expect(next.status).toBe("paused");
			expect(next.resumeTargetState).toBe("validating");
		});

		it("pausing from planning stores resumeTargetState", () => {
			const state = makeState("planning");
			const next = transitionState(state, "paused", FIXED_TS);
			expect(next.status).toBe("paused");
			expect(next.resumeTargetState).toBe("planning");
		});

		it("pausing from draft_review stores resumeTargetState", () => {
			const state = makeState("draft_review");
			const next = transitionState(state, "paused", FIXED_TS);
			expect(next.status).toBe("paused");
			expect(next.resumeTargetState).toBe("draft_review");
		});

		it("cannot pause from idle/approved (not in pausable set)", () => {
			const state = makeState("approved");
			expect(() => transitionState(state, "paused")).toThrow(/pause/);
		});

		it("resuming from paused to executing restores state", () => {
			const state = makeState("paused", { resumeTargetState: "executing" });
			const next = transitionState(state, "executing", FIXED_TS);
			expect(next.status).toBe("executing");
			expect(next.resumeTargetState).toBeUndefined();
			expect(next.progressLog).toHaveLength(1);
			expect(next.progressLog[0].type).toBe("resume");
			expect(next.progressLog[0].timestamp).toBe(FIXED_TS);
		});

		it("resuming from paused to validating restores state", () => {
			const state = makeState("paused", { resumeTargetState: "validating" });
			const next = transitionState(state, "validating", FIXED_TS);
			expect(next.status).toBe("validating");
			expect(next.resumeTargetState).toBeUndefined();
		});

		it("resuming from paused to planning restores state", () => {
			const state = makeState("paused", { resumeTargetState: "planning" });
			const next = transitionState(state, "planning", FIXED_TS);
			expect(next.status).toBe("planning");
			expect(next.resumeTargetState).toBeUndefined();
		});

		it("resuming from paused to draft_review restores state", () => {
			const state = makeState("paused", { resumeTargetState: "draft_review" });
			const next = transitionState(state, "draft_review", FIXED_TS);
			expect(next.status).toBe("draft_review");
			expect(next.resumeTargetState).toBeUndefined();
		});

		it("throws when resuming to wrong state", () => {
			const state = makeState("paused", { resumeTargetState: "executing" });
			expect(() => transitionState(state, "planning", FIXED_TS)).toThrow(/executing/);
		});

		it("throws when resuming with no resumeTargetState", () => {
			const state = makeState("paused");
			expect(() => transitionState(state, "executing", FIXED_TS)).toThrow(/resumeTargetState/);
		});

		it("throws when trying to pause from a terminal state (covered by terminal check)", () => {
			const state = makeState("completed", { completedAt: FIXED_TS });
			expect(() => transitionState(state, "paused")).toThrow();
		});
	});

	describe("pause/resume round-trip preserves tracking fields", () => {
		it("round-trip from executing preserves all counters and ids", () => {
			const original = makeState("executing", {
				currentMilestoneId: "milestone-1",
				currentFeatureId: "feature-2",
				totalFeaturesCompleted: 5,
				totalFeaturesFailed: 2,
				totalFeaturesSkipped: 1,
				totalFixFeaturesCreated: 3,
			});

			const paused = transitionState(original, "paused", FIXED_TS);
			expect(paused.currentMilestoneId).toBe("milestone-1");
			expect(paused.currentFeatureId).toBe("feature-2");
			expect(paused.totalFeaturesCompleted).toBe(5);
			expect(paused.totalFeaturesFailed).toBe(2);
			expect(paused.totalFeaturesSkipped).toBe(1);
			expect(paused.totalFixFeaturesCreated).toBe(3);

			const resumed = transitionState(paused, "executing", FIXED_TS);
			expect(resumed.status).toBe("executing");
			expect(resumed.currentMilestoneId).toBe("milestone-1");
			expect(resumed.currentFeatureId).toBe("feature-2");
			expect(resumed.totalFeaturesCompleted).toBe(5);
			expect(resumed.totalFeaturesFailed).toBe(2);
			expect(resumed.totalFeaturesSkipped).toBe(1);
			expect(resumed.totalFixFeaturesCreated).toBe(3);
		});

		it("round-trip from validating preserves all counters and ids", () => {
			const original = makeState("validating", {
				currentMilestoneId: "milestone-2",
				currentFeatureId: "feature-5",
				totalFeaturesCompleted: 10,
				totalFeaturesFailed: 0,
				totalFeaturesSkipped: 0,
				totalFixFeaturesCreated: 0,
			});

			const paused = transitionState(original, "paused", FIXED_TS);
			const resumed = transitionState(paused, "validating", FIXED_TS);
			expect(resumed.currentMilestoneId).toBe("milestone-2");
			expect(resumed.currentFeatureId).toBe("feature-5");
			expect(resumed.totalFeaturesCompleted).toBe(10);
		});

		it("pause and resume both append progress events", () => {
			const original = makeState("executing", { progressLog: [] });
			const paused = transitionState(original, "paused", FIXED_TS);
			expect(paused.progressLog).toHaveLength(1);
			expect(paused.progressLog[0].type).toBe("pause");

			const resumed = transitionState(paused, "executing", FIXED_TS);
			expect(resumed.progressLog).toHaveLength(2);
			expect(resumed.progressLog[1].type).toBe("resume");
		});

		it("aborting from paused works directly without resuming", () => {
			const state = makeState("paused", { resumeTargetState: "executing" });
			const aborted = transitionState(state, "aborted", FIXED_TS);
			expect(aborted.status).toBe("aborted");
			expect(aborted.completedAt).toBe(FIXED_TS);
			expect(aborted.resumeTargetState).toBeUndefined();
			expect(aborted.progressLog[0].type).toBe("mission_aborted");
		});
	});

	describe("state immutability", () => {
		it("does not mutate the original state", () => {
			const state = makeState("planning");
			const originalStatus = state.status;
			const originalLog = state.progressLog.length;
			transitionState(state, "draft_review", FIXED_TS);
			expect(state.status).toBe(originalStatus);
			expect(state.progressLog.length).toBe(originalLog);
		});
	});

	describe("event details", () => {
		it("each transition appends a ProgressEvent with correct type and timestamp", () => {
			const state = makeState("draft_review");
			const next = transitionState(state, "approved", FIXED_TS);
			expect(next.progressLog[0]).toMatchObject({
				type: "plan_approved",
				timestamp: FIXED_TS,
			});
			expect(typeof next.progressLog[0].detail).toBe("string");
			expect(next.progressLog[0].detail.length).toBeGreaterThan(0);
		});

		it("failed event has correct type and non-empty detail", () => {
			const state = makeState("executing");
			const next = transitionState(state, "failed", FIXED_TS);
			expect(next.progressLog[0].type).toBe("mission_failed");
			expect(next.progressLog[0].detail.length).toBeGreaterThan(0);
		});

		it("aborted event has correct type and non-empty detail", () => {
			const state = makeState("executing");
			const next = transitionState(state, "aborted", FIXED_TS);
			expect(next.progressLog[0].type).toBe("mission_aborted");
			expect(next.progressLog[0].detail.length).toBeGreaterThan(0);
		});
	});

	describe("cannot pause from non-pausable active states", () => {
		it("throws on approved -> paused", () => {
			const state = makeState("approved");
			expect(() => transitionState(state, "paused")).toThrow();
		});
	});

	describe("cannot resume from non-paused state", () => {
		it("planning -> executing throws (not from paused)", () => {
			const state = makeState("planning");
			expect(() => transitionState(state, "executing")).toThrow();
		});
	});

	describe("progress event timestamps", () => {
		it("pause event has the provided timestamp", () => {
			const state = makeState("executing");
			const next = transitionState(state, "paused", "2024-06-15T08:30:00.000Z");
			expect(next.progressLog[0].timestamp).toBe("2024-06-15T08:30:00.000Z");
		});

		it("resume event has the provided timestamp", () => {
			const state = makeState("paused", { resumeTargetState: "executing" });
			const next = transitionState(state, "executing", "2024-06-15T09:00:00.000Z");
			expect(next.progressLog[0].timestamp).toBe("2024-06-15T09:00:00.000Z");
		});
	});
});
