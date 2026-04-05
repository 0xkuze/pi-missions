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
}

export interface MissionConfig {
	models?: ModelAssignment;
	validation?: {
		commands?: string[];
		timeoutMs?: number;
	};
	autonomy?: "low" | "medium" | "high";
	git?: {
		autoCommit?: boolean;
	};
	maxRetries?: number;
}

export interface ActiveSession {
	sessionId: string;
	pid: number;
	startedAt: string;
	lastHeartbeatAt: string;
}

export type PlanMutationKind =
	| "plan-created"
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

export interface WorkerResult {
	status: "success" | "failure" | "blocked";
	summary: string;
	filesChanged: string[];
	commandsRun: Array<{
		command: string;
		exitCode: number | null;
	}>;
	notes?: string[];
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
