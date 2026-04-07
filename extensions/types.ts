import { type Static, type TSchema, Type } from "@sinclair/typebox";

export type { Static, TSchema };

export type MissionStatus =
	| "planning"
	| "draft_review"
	| "approved"
	| "executing"
	| "validating"
	| "paused"
	| "completed"
	| "failed"
	| "aborted";

export type ResumeTargetState = "planning" | "draft_review" | "executing" | "validating";

export type ProgressEventType =
	| "mission_started"
	| "planning_started"
	| "plan_submitted"
	| "plan_approved"
	| "feature_start"
	| "feature_complete"
	| "feature_failed"
	| "feature_skipped"
	| "feature_blocked"
	| "fix_feature_created"
	| "milestone_start"
	| "milestone_complete"
	| "validation_start"
	| "validation_pass"
	| "validation_fail"
	| "commit_created"
	| "pause"
	| "resume"
	| "redirect"
	| "plan_mutated"
	| "mission_complete"
	| "mission_failed"
	| "mission_aborted"
	| "worker_spawn"
	| "worker_complete";

export interface ProgressEvent {
	timestamp: string;
	type: ProgressEventType;
	detail: string;
	metadata?: Record<string, unknown>;
}

export interface ModelAssignment {
	orchestrator?: string;
	worker?: string;
	validator?: string;
}

export interface GitSnapshot {
	headCommit: string;
	dirtyFiles: string[];
	autoCommitEnabled: boolean;
}

export interface FixFeatureOrigin {
	sourceKind: "worker-failure" | "validation-failure";
	sourceFeatureId?: string;
	sourceMilestoneId?: string;
	validationOutput?: string;
}

export interface WorkerAttempt {
	attemptNumber: number;
	startedAt: string;
	completedAt?: string;
	exitCode?: number;
	resultPath: string;
	stdoutPath: string;
	stderrPath: string;
	durationMs?: number;
	model?: string;
	status: "running" | "success" | "failure" | "interrupted";
}

export interface Feature {
	id: string;
	name: string;
	description: string;
	acceptanceCriteria: string[];
	relevantFiles: string[];
	dependencies: string[];
	estimatedComplexity: "low" | "medium" | "high";
	status: "pending" | "active" | "done" | "failed" | "skipped" | "blocked";
	fixOrigin?: FixFeatureOrigin;
	attempts: WorkerAttempt[];
	startedAt?: string;
	completedAt?: string;
}

export interface Milestone {
	id: string;
	name: string;
	description: string;
	features: Feature[];
	validationCommands?: string[];
	status: "pending" | "active" | "done" | "failed";
	startedAt?: string;
	completedAt?: string;
}

export interface MissionPlan {
	id: string;
	description: string;
	planVersion: number;
	milestones: Milestone[];
	validationCommands: string[];
	modelAssignment: ModelAssignment;
	createdAt: string;
	approvedAt?: string;
}

export interface MissionState {
	missionId: string;
	status: MissionStatus;
	resumeTargetState?: ResumeTargetState;
	currentMilestoneId?: string;
	currentFeatureId?: string;
	progressLog: ProgressEvent[];
	startedAt: string;
	completedAt?: string;
	totalFeaturesCompleted: number;
	totalFeaturesFailed: number;
	totalFeaturesSkipped: number;
	totalFixFeaturesCreated: number;
	gitSnapshot?: GitSnapshot;
	missionStartedAtMs?: number;
	protocolVersion?: number;
	turnCount?: number;
}

export type PromptingMode = "default" | "caveman" | "caveman-full";

export interface GlobalConfig {
	models?: ModelAssignment;
	promptingMode?: PromptingMode;
	spawnAndLearn?: boolean;
	onboardingCompleted?: boolean;
}

export interface MissionConfig {
	models?: ModelAssignment;
	modelByComplexity?: {
		low?: string;
		medium?: string;
		high?: string;
	};
	promptingMode?: PromptingMode;
	spawnAndLearn?: boolean;
	validation?: {
		commands?: string[];
		timeoutMs?: number;
	};
	autonomy?: "low" | "medium" | "high";
	git?: {
		autoCommit?: boolean;
	};
	maxRetries?: number;
	workerTimeoutMs?: number;
	validatorStrictness?: "strict" | "lenient";
}

export interface ActiveSession {
	sessionId: string;
	pid: number;
	startedAt: string;
	lastHeartbeatAt: string;
}

export type PlanMutationKind =
	| "plan-created"
	| "plan-revised"
	| "plan-approved"
	| "add-milestone"
	| "remove-milestone"
	| "reorder-milestone"
	| "add-feature"
	| "remove-feature"
	| "reorder-feature"
	| "edit-feature"
	| "add-fix-feature"
	| "edit-validation"
	| "feature-status-change"
	| "milestone-status-change";

export interface PlanMutation {
	planVersion: number;
	timestamp: string;
	actor: "user" | "orchestrator";
	kind: PlanMutationKind;
	summary: string;
	payload: Record<string, unknown>;
}

export interface WorkerHandoff {
	whatWasImplemented: string;
	whatWasLeftUndone: string;
	commandsRun: Array<{
		command: string;
		exitCode: number;
		observation: string;
	}>;
	testsAdded: Array<{
		file: string;
		cases: string[];
	}>;
	discoveredIssues: Array<{
		severity: "low" | "medium" | "high";
		description: string;
		suggestedFix?: string;
	}>;
}

export interface WorkerResult {
	status: "success" | "failure" | "blocked";
	summary: string;
	filesChanged: string[];
	commandsRun: Array<{
		command: string;
		exitCode: number | null;
	}>;
	notes?: string[];
	handoff?: WorkerHandoff;
	error?: {
		kind: "tool" | "validation" | "environment" | "unknown";
		message: string;
		details?: string;
	};
	metrics: {
		durationMs: number;
		tokensUsed?: number;
		estimatedCost?: number;
	};
}

export interface ValidationResult {
	status: "pass" | "fail";
	milestoneId: string;
	commands: Array<{
		label: string;
		command: string;
		exitCode: number | null;
		durationMs: number;
		timedOut: boolean;
		stdoutPath: string;
		stderrPath: string;
	}>;
	summary: string;
	failingChecks: string[];
}

export interface SubmitPlanParams {
	description: string;
	milestones: Array<{
		id: string;
		name: string;
		description: string;
		features: Array<{
			id: string;
			name: string;
			description: string;
			acceptanceCriteria: string[];
			relevantFiles: string[];
			dependencies: string[];
			estimatedComplexity: "low" | "medium" | "high";
		}>;
		validationCommands?: string[];
	}>;
	validationCommands: string[];
	modelSuggestions?: ModelAssignment;
}

export interface SpawnWorkerParams {
	featureId: string;
	additionalContext?: string;
}

export interface RunValidationParams {
	milestoneId: string;
}

export interface CommitChangesParams {
	featureId: string;
	message?: string;
}

export interface CreateFixFeatureParams {
	milestoneId: string;
	name: string;
	description: string;
	acceptanceCriteria: string[];
	relevantFiles: string[];
	sourceKind: "worker-failure" | "validation-failure";
	sourceFeatureId?: string;
}

export interface UpdateMissionStateParams {
	action: "start_milestone" | "complete_milestone" | "skip_feature" | "block_feature" | "note";
	targetId: string;
	reason?: string;
}

export interface CompleteMissionParams {
	summary: string;
	remainingNotes?: string[];
}

const WorkerAttemptSchema = Type.Object({
	attemptNumber: Type.Number(),
	startedAt: Type.String(),
	completedAt: Type.Optional(Type.String()),
	exitCode: Type.Optional(Type.Number()),
	resultPath: Type.String(),
	stdoutPath: Type.String(),
	stderrPath: Type.String(),
	durationMs: Type.Optional(Type.Number()),
	model: Type.Optional(Type.String()),
	status: Type.Union([
		Type.Literal("running"),
		Type.Literal("success"),
		Type.Literal("failure"),
		Type.Literal("interrupted"),
	]),
});

const FixFeatureOriginSchema = Type.Object({
	sourceKind: Type.Union([Type.Literal("worker-failure"), Type.Literal("validation-failure")]),
	sourceFeatureId: Type.Optional(Type.String()),
	sourceMilestoneId: Type.Optional(Type.String()),
	validationOutput: Type.Optional(Type.String()),
});

const FeatureSchema = Type.Object({
	id: Type.String(),
	name: Type.String(),
	description: Type.String(),
	acceptanceCriteria: Type.Array(Type.String()),
	relevantFiles: Type.Array(Type.String()),
	dependencies: Type.Array(Type.String()),
	estimatedComplexity: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
	status: Type.Union([
		Type.Literal("pending"),
		Type.Literal("active"),
		Type.Literal("done"),
		Type.Literal("failed"),
		Type.Literal("skipped"),
		Type.Literal("blocked"),
	]),
	fixOrigin: Type.Optional(FixFeatureOriginSchema),
	attempts: Type.Array(WorkerAttemptSchema),
	startedAt: Type.Optional(Type.String()),
	completedAt: Type.Optional(Type.String()),
});

const MilestoneSchema = Type.Object({
	id: Type.String(),
	name: Type.String(),
	description: Type.String(),
	features: Type.Array(FeatureSchema),
	validationCommands: Type.Optional(Type.Array(Type.String())),
	status: Type.Union([Type.Literal("pending"), Type.Literal("active"), Type.Literal("done"), Type.Literal("failed")]),
	startedAt: Type.Optional(Type.String()),
	completedAt: Type.Optional(Type.String()),
});

const ModelAssignmentSchema = Type.Object({
	orchestrator: Type.Optional(Type.String()),
	worker: Type.Optional(Type.String()),
	validator: Type.Optional(Type.String()),
});

export const MissionPlanSchema = Type.Object({
	id: Type.String(),
	description: Type.String(),
	planVersion: Type.Number(),
	milestones: Type.Array(MilestoneSchema),
	validationCommands: Type.Array(Type.String()),
	modelAssignment: ModelAssignmentSchema,
	createdAt: Type.String(),
	approvedAt: Type.Optional(Type.String()),
});

const GitSnapshotSchema = Type.Object({
	headCommit: Type.String(),
	dirtyFiles: Type.Array(Type.String()),
	autoCommitEnabled: Type.Boolean(),
});

const ProgressEventSchema = Type.Object({
	timestamp: Type.String(),
	type: Type.Union([
		Type.Literal("mission_started"),
		Type.Literal("planning_started"),
		Type.Literal("plan_submitted"),
		Type.Literal("plan_approved"),
		Type.Literal("feature_start"),
		Type.Literal("feature_complete"),
		Type.Literal("feature_failed"),
		Type.Literal("feature_skipped"),
		Type.Literal("feature_blocked"),
		Type.Literal("fix_feature_created"),
		Type.Literal("milestone_start"),
		Type.Literal("milestone_complete"),
		Type.Literal("validation_start"),
		Type.Literal("validation_pass"),
		Type.Literal("validation_fail"),
		Type.Literal("commit_created"),
		Type.Literal("pause"),
		Type.Literal("resume"),
		Type.Literal("redirect"),
		Type.Literal("plan_mutated"),
		Type.Literal("mission_complete"),
		Type.Literal("mission_failed"),
		Type.Literal("mission_aborted"),
		Type.Literal("worker_spawn"),
		Type.Literal("worker_complete"),
	]),
	detail: Type.String(),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const MissionStateSchema = Type.Object({
	missionId: Type.String(),
	status: Type.Union([
		Type.Literal("planning"),
		Type.Literal("draft_review"),
		Type.Literal("approved"),
		Type.Literal("executing"),
		Type.Literal("validating"),
		Type.Literal("paused"),
		Type.Literal("completed"),
		Type.Literal("failed"),
		Type.Literal("aborted"),
	]),
	resumeTargetState: Type.Optional(
		Type.Union([
			Type.Literal("planning"),
			Type.Literal("draft_review"),
			Type.Literal("executing"),
			Type.Literal("validating"),
		]),
	),
	currentMilestoneId: Type.Optional(Type.String()),
	currentFeatureId: Type.Optional(Type.String()),
	progressLog: Type.Array(ProgressEventSchema),
	startedAt: Type.String(),
	completedAt: Type.Optional(Type.String()),
	totalFeaturesCompleted: Type.Number(),
	totalFeaturesFailed: Type.Number(),
	totalFeaturesSkipped: Type.Number(),
	totalFixFeaturesCreated: Type.Number(),
	gitSnapshot: Type.Optional(GitSnapshotSchema),
	missionStartedAtMs: Type.Optional(Type.Number()),
	protocolVersion: Type.Optional(Type.Number()),
	turnCount: Type.Optional(Type.Number()),
});

const PromptingModeSchema = Type.Optional(
	Type.Union([Type.Literal("default"), Type.Literal("caveman"), Type.Literal("caveman-full")]),
);

export const GlobalConfigSchema = Type.Object({
	models: Type.Optional(ModelAssignmentSchema),
	promptingMode: PromptingModeSchema,
	spawnAndLearn: Type.Optional(Type.Boolean()),
	onboardingCompleted: Type.Optional(Type.Boolean()),
});

export const MissionConfigSchema = Type.Object({
	models: Type.Optional(ModelAssignmentSchema),
	modelByComplexity: Type.Optional(
		Type.Object({
			low: Type.Optional(Type.String()),
			medium: Type.Optional(Type.String()),
			high: Type.Optional(Type.String()),
		}),
	),
	promptingMode: PromptingModeSchema,
	spawnAndLearn: Type.Optional(Type.Boolean()),
	validation: Type.Optional(
		Type.Object({
			commands: Type.Optional(Type.Array(Type.String())),
			timeoutMs: Type.Optional(Type.Number()),
		}),
	),
	autonomy: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
	git: Type.Optional(
		Type.Object({
			autoCommit: Type.Optional(Type.Boolean()),
		}),
	),
	maxRetries: Type.Optional(Type.Number()),
	workerTimeoutMs: Type.Optional(Type.Number()),
	validatorStrictness: Type.Optional(Type.Union([Type.Literal("strict"), Type.Literal("lenient")])),
});

export const ReportResultSchema = Type.Object({
	whatWasImplemented: Type.String(),
	whatWasLeftUndone: Type.String(),
	commandsRun: Type.Array(
		Type.Object({
			command: Type.String(),
			exitCode: Type.Number(),
			observation: Type.String(),
		}),
	),
	testsAdded: Type.Array(
		Type.Object({
			file: Type.String(),
			cases: Type.Array(Type.String()),
		}),
	),
	discoveredIssues: Type.Array(
		Type.Object({
			severity: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
			description: Type.String(),
			suggestedFix: Type.Optional(Type.String()),
		}),
	),
});

export const WorkerResultSchema = Type.Object({
	status: Type.Union([Type.Literal("success"), Type.Literal("failure"), Type.Literal("blocked")]),
	summary: Type.String(),
	filesChanged: Type.Array(Type.String()),
	commandsRun: Type.Array(
		Type.Object({
			command: Type.String(),
			exitCode: Type.Union([Type.Number(), Type.Null()]),
		}),
	),
	notes: Type.Optional(Type.Array(Type.String())),
	handoff: Type.Optional(ReportResultSchema),
	error: Type.Optional(
		Type.Object({
			kind: Type.Union([
				Type.Literal("tool"),
				Type.Literal("validation"),
				Type.Literal("environment"),
				Type.Literal("unknown"),
			]),
			message: Type.String(),
			details: Type.Optional(Type.String()),
		}),
	),
	metrics: Type.Object({
		durationMs: Type.Number(),
		tokensUsed: Type.Optional(Type.Number()),
		estimatedCost: Type.Optional(Type.Number()),
	}),
});

export const ValidationResultSchema = Type.Object({
	status: Type.Union([Type.Literal("pass"), Type.Literal("fail")]),
	milestoneId: Type.String(),
	commands: Type.Array(
		Type.Object({
			label: Type.String(),
			command: Type.String(),
			exitCode: Type.Union([Type.Number(), Type.Null()]),
			durationMs: Type.Number(),
			timedOut: Type.Boolean(),
			stdoutPath: Type.String(),
			stderrPath: Type.String(),
		}),
	),
	summary: Type.String(),
	failingChecks: Type.Array(Type.String()),
});
