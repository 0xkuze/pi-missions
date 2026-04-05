import type {
	Feature,
	Milestone,
	MissionPlan,
	MissionState,
	ProgressEvent,
	WorkerAttempt,
} from "../../extensions/types.js";
import { makeFeature, makeMilestone, makePlan, makeProgressEvent, makeState, makeWorkerAttempt } from "./factories.js";

export function uiMakeState(status: MissionState["status"], overrides: Partial<MissionState> = {}): MissionState {
	return makeState({
		status,
		startedAt: new Date(Date.now() - 60_000).toISOString(),
		...overrides,
	});
}

export function uiMakeFeature(
	id: string,
	status: Feature["status"] = "pending",
	nameOrOverrides?: string | Partial<Feature>,
): Feature {
	const overrides = typeof nameOrOverrides === "string" ? { name: nameOrOverrides } : (nameOrOverrides ?? {});
	return makeFeature({
		id,
		name: overrides.name ?? `Feature ${id}`,
		status,
		...overrides,
	});
}

export function uiMakeMilestone(id: string, features: Feature[], status: Milestone["status"] = "pending"): Milestone {
	return makeMilestone({
		id,
		name: `Milestone ${id}`,
		features,
		status,
	});
}

export function uiMakePlan(milestones: Milestone[], overrides: Partial<MissionPlan> = {}): MissionPlan {
	return makePlan({
		milestones,
		...overrides,
	});
}

export function uiMakeAttempt(
	n: number,
	status: WorkerAttempt["status"] = "failure",
	overrides: Partial<WorkerAttempt> = {},
): WorkerAttempt {
	return makeWorkerAttempt({
		attemptNumber: n,
		startedAt: new Date(Date.now() - 60_000 * n).toISOString(),
		status,
		resultPath: `runtime/f1/${n}/result.json`,
		stdoutPath: `runtime/f1/${n}/stdout.log`,
		stderrPath: `runtime/f1/${n}/stderr.log`,
		...overrides,
	});
}

export function uiMakeEvent(
	type: ProgressEvent["type"],
	detail: string,
	overrides: Partial<ProgressEvent> = {},
): ProgressEvent {
	return makeProgressEvent({
		type,
		detail,
		...overrides,
	});
}
