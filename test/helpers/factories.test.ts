import { describe, expect, it } from "bun:test";
import type {
	ActiveSession,
	Feature,
	Milestone,
	MissionPlan,
	MissionState,
	ProgressEvent,
	WorkerAttempt,
} from "../../extensions/types.js";
import {
	makeActiveSession,
	makeFeature,
	makeMilestone,
	makePlan,
	makeProgressEvent,
	makeState,
	makeWorkerAttempt,
} from "./factories.js";

describe("makeFeature", () => {
	it("returns a valid Feature with all required fields", () => {
		const f = makeFeature();
		expect(f.id).toBe("feat-1");
		expect(f.name).toBe("Feature feat-1");
		expect(f.description).toBeString();
		expect(f.acceptanceCriteria).toBeArrayOfSize(1);
		expect(f.relevantFiles).toBeArray();
		expect(f.dependencies).toBeArray();
		expect(f.estimatedComplexity).toBe("low");
		expect(f.status).toBe("pending");
		expect(f.attempts).toBeArrayOfSize(0);
	});

	it("applies overrides", () => {
		const f = makeFeature({ id: "custom", status: "done", name: "Custom Feature" });
		expect(f.id).toBe("custom");
		expect(f.status).toBe("done");
		expect(f.name).toBe("Custom Feature");
	});

	it("preserves non-overridden defaults when overriding", () => {
		const f = makeFeature({ status: "active" });
		expect(f.id).toBe("feat-1");
		expect(f.description).toBeString();
		expect(f.estimatedComplexity).toBe("low");
	});

	it("allows overriding nested arrays", () => {
		const f = makeFeature({ acceptanceCriteria: ["a", "b"], dependencies: ["dep-1"] });
		expect(f.acceptanceCriteria).toEqual(["a", "b"]);
		expect(f.dependencies).toEqual(["dep-1"]);
	});
});

describe("makeWorkerAttempt", () => {
	it("returns a valid WorkerAttempt with all required fields", () => {
		const a = makeWorkerAttempt();
		expect(a.attemptNumber).toBe(1);
		expect(a.startedAt).toBeString();
		expect(a.resultPath).toBeString();
		expect(a.stdoutPath).toBeString();
		expect(a.stderrPath).toBeString();
		expect(a.status).toBe("success");
	});

	it("applies overrides", () => {
		const a = makeWorkerAttempt({ attemptNumber: 3, status: "failure", exitCode: 1, durationMs: 9000 });
		expect(a.attemptNumber).toBe(3);
		expect(a.status).toBe("failure");
		expect(a.exitCode).toBe(1);
		expect(a.durationMs).toBe(9000);
	});

	it("includes completedAt and exitCode by default", () => {
		const a = makeWorkerAttempt();
		expect(a.completedAt).toBeString();
		expect(a.exitCode).toBe(0);
		expect(a.durationMs).toBe(5000);
	});
});

describe("makeMilestone", () => {
	it("returns a valid Milestone with all required fields", () => {
		const m = makeMilestone();
		expect(m.id).toBe("milestone-1");
		expect(m.name).toBe("Milestone milestone-1");
		expect(m.description).toBeString();
		expect(m.features).toBeArray();
		expect(m.status).toBe("pending");
	});

	it("applies overrides", () => {
		const features = [makeFeature({ id: "f1" }), makeFeature({ id: "f2" })];
		const m = makeMilestone({ id: "m-custom", features, status: "active" });
		expect(m.id).toBe("m-custom");
		expect(m.features).toHaveLength(2);
		expect(m.status).toBe("active");
	});

	it("defaults to empty features array", () => {
		const m = makeMilestone();
		expect(m.features).toBeArrayOfSize(0);
	});
});

describe("makePlan", () => {
	it("returns a valid MissionPlan with all required fields", () => {
		const p = makePlan();
		expect(p.id).toBe("plan-1");
		expect(p.description).toBeString();
		expect(p.planVersion).toBe(1);
		expect(p.milestones).toBeArray();
		expect(p.validationCommands).toBeArray();
		expect(p.modelAssignment).toBeDefined();
		expect(p.createdAt).toBeString();
	});

	it("applies overrides", () => {
		const milestones = [makeMilestone({ id: "m1" })];
		const p = makePlan({ milestones, description: "Custom plan", planVersion: 3 });
		expect(p.milestones).toHaveLength(1);
		expect(p.milestones[0].id).toBe("m1");
		expect(p.description).toBe("Custom plan");
		expect(p.planVersion).toBe(3);
	});

	it("defaults to empty milestones", () => {
		const p = makePlan();
		expect(p.milestones).toBeArrayOfSize(0);
	});

	it("allows setting approvedAt", () => {
		const ts = "2025-01-01T00:00:00.000Z";
		const p = makePlan({ approvedAt: ts });
		expect(p.approvedAt).toBe(ts);
	});
});

describe("makeState", () => {
	it("returns a valid MissionState with all required fields", () => {
		const s = makeState();
		expect(s.missionId).toBe("test-mission");
		expect(s.status).toBe("executing");
		expect(s.progressLog).toBeArrayOfSize(0);
		expect(s.startedAt).toBeString();
		expect(s.totalFeaturesCompleted).toBe(0);
		expect(s.totalFeaturesFailed).toBe(0);
		expect(s.totalFeaturesSkipped).toBe(0);
		expect(s.totalFixFeaturesCreated).toBe(0);
	});

	it("applies overrides including status", () => {
		const s = makeState({ status: "planning", missionId: "custom" });
		expect(s.status).toBe("planning");
		expect(s.missionId).toBe("custom");
	});

	it("allows setting optional fields", () => {
		const s = makeState({
			currentMilestoneId: "m1",
			currentFeatureId: "f1",
			resumeTargetState: "executing",
			completedAt: "2025-01-01T00:00:00.000Z",
			gitSnapshot: { headCommit: "abc", dirtyFiles: [], autoCommitEnabled: true },
		});
		expect(s.currentMilestoneId).toBe("m1");
		expect(s.currentFeatureId).toBe("f1");
		expect(s.resumeTargetState).toBe("executing");
		expect(s.completedAt).toBe("2025-01-01T00:00:00.000Z");
		expect(s.gitSnapshot?.headCommit).toBe("abc");
	});

	it("defaults counters to zero", () => {
		const s = makeState({ totalFeaturesCompleted: 5 });
		expect(s.totalFeaturesCompleted).toBe(5);
		expect(s.totalFeaturesFailed).toBe(0);
		expect(s.totalFeaturesSkipped).toBe(0);
	});
});

describe("makeProgressEvent", () => {
	it("returns a valid ProgressEvent with all required fields", () => {
		const e = makeProgressEvent();
		expect(e.timestamp).toBeString();
		expect(e.type).toBe("feature_start");
		expect(e.detail).toBeString();
	});

	it("applies overrides", () => {
		const e = makeProgressEvent({ type: "mission_complete", detail: "All done", metadata: { key: "val" } });
		expect(e.type).toBe("mission_complete");
		expect(e.detail).toBe("All done");
		expect(e.metadata).toEqual({ key: "val" });
	});
});

describe("makeActiveSession", () => {
	it("returns a valid ActiveSession with all required fields", () => {
		const s = makeActiveSession();
		expect(s.sessionId).toBeString();
		expect(s.pid).toBe(process.pid);
		expect(s.startedAt).toBeString();
		expect(s.lastHeartbeatAt).toBeString();
	});

	it("applies overrides", () => {
		const s = makeActiveSession({ sessionId: "custom-session", pid: 12345 });
		expect(s.sessionId).toBe("custom-session");
		expect(s.pid).toBe(12345);
	});
});

describe("type safety", () => {
	it("all factories return correctly typed objects", () => {
		const feature: Feature = makeFeature();
		const attempt: WorkerAttempt = makeWorkerAttempt();
		const milestone: Milestone = makeMilestone();
		const plan: MissionPlan = makePlan();
		const state: MissionState = makeState();
		const event: ProgressEvent = makeProgressEvent();
		const session: ActiveSession = makeActiveSession();

		expect(feature).toBeDefined();
		expect(attempt).toBeDefined();
		expect(milestone).toBeDefined();
		expect(plan).toBeDefined();
		expect(state).toBeDefined();
		expect(event).toBeDefined();
		expect(session).toBeDefined();
	});
});
