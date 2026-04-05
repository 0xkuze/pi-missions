import type {
	ActiveSession,
	Feature,
	Milestone,
	MissionPlan,
	MissionState,
	ProgressEvent,
	WorkerAttempt,
} from "../../extensions/types.js";

const FIXED_ISO = "2025-01-01T00:00:00.000Z";

export function makeFeature(overrides: Partial<Feature> = {}): Feature {
	return {
		id: "feat-1",
		name: `Feature ${overrides.id ?? "feat-1"}`,
		description: "Implement feature",
		acceptanceCriteria: ["Works correctly"],
		relevantFiles: [],
		dependencies: [],
		estimatedComplexity: "low",
		status: "pending",
		attempts: [],
		...overrides,
	};
}

export function makeWorkerAttempt(overrides: Partial<WorkerAttempt> = {}): WorkerAttempt {
	return {
		attemptNumber: 1,
		startedAt: FIXED_ISO,
		completedAt: FIXED_ISO,
		exitCode: 0,
		resultPath: ".pi/missions/runtime/feat-1/1/result.json",
		stdoutPath: ".pi/missions/runtime/feat-1/1/stdout.log",
		stderrPath: ".pi/missions/runtime/feat-1/1/stderr.log",
		durationMs: 5000,
		status: "success",
		...overrides,
	};
}

export function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
	return {
		id: "milestone-1",
		name: `Milestone ${overrides.id ?? "milestone-1"}`,
		description: "A milestone",
		features: [],
		status: "pending",
		...overrides,
	};
}

export function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
	return {
		id: "plan-1",
		description: "Test mission plan",
		planVersion: 1,
		milestones: [],
		validationCommands: [],
		modelAssignment: {},
		createdAt: FIXED_ISO,
		...overrides,
	};
}

export function makeState(overrides: Partial<MissionState> = {}): MissionState {
	return {
		missionId: "test-mission",
		status: "executing",
		progressLog: [],
		startedAt: FIXED_ISO,
		totalFeaturesCompleted: 0,
		totalFeaturesFailed: 0,
		totalFeaturesSkipped: 0,
		totalFixFeaturesCreated: 0,
		...overrides,
	};
}

export function makeProgressEvent(overrides: Partial<ProgressEvent> = {}): ProgressEvent {
	return {
		timestamp: FIXED_ISO,
		type: "feature_start",
		detail: "Feature started",
		...overrides,
	};
}

export function makeActiveSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
	return {
		sessionId: "session-1",
		pid: process.pid,
		startedAt: FIXED_ISO,
		lastHeartbeatAt: FIXED_ISO,
		...overrides,
	};
}
