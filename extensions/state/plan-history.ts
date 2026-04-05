import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MissionPlan, PlanMutation } from "../types.js";
import { loadPlan } from "./manager.js";

const DESTRUCTIVE_FEATURE_KINDS = new Set(["remove-feature", "edit-feature"]);

function historyPath(basePath: string): string {
	return join(basePath, "plan-history.jsonl");
}

function ensureDir(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
}

function findFeatureInPlan(plan: MissionPlan, featureId: string): { status: string } | null {
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.id === featureId) {
				return feature;
			}
		}
	}
	return null;
}

function rejectIfCompletedFeature(basePath: string, mutation: PlanMutation): void {
	if (!DESTRUCTIVE_FEATURE_KINDS.has(mutation.kind)) {
		return;
	}
	const featureId = mutation.payload.featureId;
	if (typeof featureId !== "string") {
		return;
	}
	const plan = loadPlan(basePath);
	if (plan === null) {
		return;
	}
	const feature = findFeatureInPlan(plan, featureId);
	if (feature !== null && feature.status === "done") {
		throw new Error(`Cannot apply '${mutation.kind}' to completed feature '${featureId}'`);
	}
}

function lastPlanVersion(basePath: string): number {
	const history = readHistory(basePath);
	if (history.length === 0) {
		return 0;
	}
	return history[history.length - 1]!.planVersion;
}

export function appendMutation(basePath: string, mutation: PlanMutation): void {
	rejectIfCompletedFeature(basePath, mutation);

	const last = lastPlanVersion(basePath);
	if (mutation.planVersion <= last) {
		throw new Error(`planVersion must increment monotonically: got ${mutation.planVersion}, last was ${last}`);
	}

	const file = historyPath(basePath);
	ensureDir(file);
	appendFileSync(file, `${JSON.stringify(mutation)}\n`, "utf8");
}

export function readHistory(basePath: string): PlanMutation[] {
	const file = historyPath(basePath);
	if (!existsSync(file)) {
		return [];
	}
	const raw = readFileSync(file, "utf8");
	const lines = raw.split("\n").filter((line) => line.trim() !== "");
	const mutations: PlanMutation[] = [];
	for (const line of lines) {
		try {
			const parsed = JSON.parse(line) as PlanMutation;
			mutations.push(parsed);
		} catch {
			// why: JSONL trailing lines may be truncated on process crash; skip them
		}
	}
	return mutations;
}
