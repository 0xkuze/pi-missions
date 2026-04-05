import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionPlan } from "../types.js";

export type DraftReviewAction = { kind: "approve" } | { kind: "close" } | { kind: "noop" };

function countTotalFeatures(plan: MissionPlan): number {
	return plan.milestones.reduce((sum, m) => sum + m.features.length, 0);
}

function estimatedRuns(plan: MissionPlan): number {
	const featureCount = countTotalFeatures(plan);
	const milestoneCount = plan.milestones.length;
	return featureCount + 2 * milestoneCount;
}

function renderModelAssignments(plan: MissionPlan): string[] {
	const { worker, orchestrator, validator } = plan.modelAssignment;
	if (!worker && !orchestrator && !validator) return [];
	const lines: string[] = ["Models"];
	if (orchestrator) lines.push(`  • Orchestrator: ${orchestrator}`);
	if (worker) lines.push(`  • Worker: ${worker}`);
	if (validator) lines.push(`  • Validator: ${validator}`);
	return lines;
}

function renderValidationCommands(plan: MissionPlan): string[] {
	if (plan.validationCommands.length === 0) return [];
	const lines: string[] = ["Validation"];
	for (const cmd of plan.validationCommands) {
		lines.push(`  • ${cmd}`);
	}
	return lines;
}

export function renderDraftReview(plan: MissionPlan): string[] {
	const lines: string[] = [];

	lines.push("Draft Mission Plan");
	lines.push(`Mission: ${plan.description}`);
	lines.push("");

	for (const milestone of plan.milestones) {
		const count = milestone.features.length;
		lines.push(`Milestone: ${milestone.name} (${count} feature${count !== 1 ? "s" : ""})`);
		for (const feature of milestone.features) {
			lines.push(`  • ${feature.name}: ${feature.description}`);
		}
		lines.push("");
	}

	const validationLines = renderValidationCommands(plan);
	if (validationLines.length > 0) {
		lines.push(...validationLines);
		lines.push("");
	}

	const modelLines = renderModelAssignments(plan);
	if (modelLines.length > 0) {
		lines.push(...modelLines);
	}

	const total = countTotalFeatures(plan);
	const runs = estimatedRuns(plan);
	lines.push(`  • Estimated runs: ${total} features + ${plan.milestones.length * 2} validations = ~${runs}`);
	lines.push("");

	lines.push("A: approve   Esc: back to chat (continue planning)");

	return lines;
}

export function handleDraftReviewKey(key: string): DraftReviewAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	if (key.toUpperCase() === "A") return { kind: "approve" };
	return { kind: "noop" };
}
