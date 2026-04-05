import type { MissionState, MissionStatus, ProgressEventType, ResumeTargetState } from "../types.js";
import { nowISO } from "../utils.js";

const TERMINAL_STATUSES: ReadonlySet<MissionStatus> = new Set(["completed", "failed", "aborted"]);

const PAUSABLE_STATUSES: ReadonlySet<MissionStatus> = new Set(["planning", "draft_review", "executing", "validating"]);

const RESUME_TARGET_MAP: Partial<Record<MissionStatus, ResumeTargetState>> = {
	planning: "planning",
	draft_review: "draft_review",
	executing: "executing",
	validating: "validating",
};

const ALLOWED_FORWARD: Partial<Record<MissionStatus, MissionStatus>> = {
	planning: "draft_review",
	draft_review: "approved",
	approved: "executing",
	executing: "validating",
	validating: "executing",
};

const COMPLETION_ALLOWED: ReadonlySet<MissionStatus> = new Set(["executing"]);

const EVENT_TYPE_FOR_TARGET: Partial<Record<MissionStatus, ProgressEventType>> = {
	planning: "planning_started",
	draft_review: "plan_submitted",
	approved: "plan_approved",
	executing: "feature_start",
	validating: "validation_start",
	paused: "pause",
	completed: "mission_complete",
	failed: "mission_failed",
	aborted: "mission_aborted",
};

function eventDetail(from: MissionStatus, to: MissionStatus): string {
	switch (to) {
		case "planning":
			return "Mission planning started";
		case "draft_review":
			return "Plan submitted for review";
		case "approved":
			return "Plan approved";
		case "executing":
			return from === "approved" ? "Execution started" : "Resumed execution after validation";
		case "validating":
			return "Validation started";
		case "paused":
			return `Paused from ${from}`;
		case "completed":
			return "Mission completed successfully";
		case "failed":
			return `Mission failed from ${from}`;
		case "aborted":
			return `Mission aborted from ${from}`;
		default:
			return `Transitioned from ${from} to ${to}`;
	}
}

export function transitionState(state: MissionState, targetStatus: MissionStatus, timestamp?: string): MissionState {
	const now = timestamp ?? nowISO();
	const current = state.status;

	if (TERMINAL_STATUSES.has(current)) {
		throw new Error(`Cannot transition from terminal state '${current}' to '${targetStatus}'`);
	}

	if (targetStatus === "paused") {
		return applyPause(state, current, now);
	}

	if (current === "paused") {
		return applyResume(state, targetStatus, now);
	}

	if (targetStatus === "failed" || targetStatus === "aborted") {
		return applyTerminal(state, targetStatus, now);
	}

	if (targetStatus === "completed") {
		if (!COMPLETION_ALLOWED.has(current)) {
			throw new Error(`Cannot transition to 'completed' from '${current}': only allowed from 'executing'`);
		}
		return applyCompletion(state, now);
	}

	return applyForward(state, current, targetStatus, now);
}

function applyPause(state: MissionState, current: MissionStatus, now: string): MissionState {
	if (!PAUSABLE_STATUSES.has(current)) {
		throw new Error(`Cannot pause from state '${current}'`);
	}
	const resumeTarget = RESUME_TARGET_MAP[current] as ResumeTargetState;
	return {
		...state,
		status: "paused",
		resumeTargetState: resumeTarget,
		progressLog: [...state.progressLog, { timestamp: now, type: "pause", detail: eventDetail(current, "paused") }],
	};
}

function applyResume(state: MissionState, targetStatus: MissionStatus, now: string): MissionState {
	if (targetStatus === "aborted") {
		return applyTerminal(state, "aborted", now);
	}

	const resumeTarget = state.resumeTargetState;
	if (!resumeTarget) {
		throw new Error("Cannot resume: paused state has no resumeTargetState");
	}
	if (targetStatus !== resumeTarget) {
		throw new Error(`Cannot resume to '${targetStatus}': paused state targets '${resumeTarget}'`);
	}
	return {
		...state,
		status: targetStatus,
		resumeTargetState: undefined,
		progressLog: [
			...state.progressLog,
			{ timestamp: now, type: "resume", detail: `Resumed from pause to ${targetStatus}` },
		],
	};
}

function applyTerminal(state: MissionState, targetStatus: "failed" | "aborted", now: string): MissionState {
	return {
		...state,
		status: targetStatus,
		resumeTargetState: undefined,
		completedAt: now,
		progressLog: [
			...state.progressLog,
			{
				timestamp: now,
				type: EVENT_TYPE_FOR_TARGET[targetStatus] as ProgressEventType,
				detail: eventDetail(state.status, targetStatus),
			},
		],
	};
}

function applyCompletion(state: MissionState, now: string): MissionState {
	return {
		...state,
		status: "completed",
		completedAt: now,
		progressLog: [
			...state.progressLog,
			{ timestamp: now, type: "mission_complete", detail: eventDetail(state.status, "completed") },
		],
	};
}

function applyForward(
	state: MissionState,
	current: MissionStatus,
	targetStatus: MissionStatus,
	now: string,
): MissionState {
	const allowedNext = ALLOWED_FORWARD[current];
	if (allowedNext !== targetStatus) {
		throw new Error(
			`Invalid transition from '${current}' to '${targetStatus}'${
				allowedNext ? `: expected '${allowedNext}'` : ": no forward transitions allowed from this state"
			}`,
		);
	}

	const eventType = EVENT_TYPE_FOR_TARGET[targetStatus] as ProgressEventType;
	return {
		...state,
		status: targetStatus,
		progressLog: [
			...state.progressLog,
			{ timestamp: now, type: eventType, detail: eventDetail(current, targetStatus) },
		],
	};
}
