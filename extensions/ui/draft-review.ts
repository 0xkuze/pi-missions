import { matchesKey } from "@mariozechner/pi-tui";
import type { MissionPlan } from "../types.js";
import type { FrameStyle } from "./frame.js";
import { frame, section } from "./frame.js";

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

export function renderDraftReview(plan: MissionPlan, width = 80, style?: FrameStyle): string[] {
	const contentWidth = width - 4;
	const tf = style?.textFn ?? ((t: string) => t);
	const bf = style?.boldFn ?? ((t: string) => t);
	const mf = style?.mutedFn ?? ((t: string) => t);
	const lines: string[] = [];

	lines.push(bf(tf(`Mission: ${plan.description}`)));
	lines.push("");

	for (const milestone of plan.milestones) {
		const count = milestone.features.length;
		lines.push(section(`${milestone.name} (${count} feature${count !== 1 ? "s" : ""})`, contentWidth, style));
		for (const feature of milestone.features) {
			lines.push(`\u2022 ${tf(feature.name)}: ${mf(feature.description)}`);
		}
		lines.push("");
	}

	const validationLines = renderValidationCommands(plan);
	if (validationLines.length > 0) {
		lines.push(section("Validation", contentWidth, style));
		for (const vl of validationLines.slice(1)) {
			lines.push(mf(vl.trimStart()));
		}
		lines.push("");
	}

	const modelLines = renderModelAssignments(plan);
	if (modelLines.length > 0) {
		lines.push(section("Models", contentWidth, style));
		for (const ml of modelLines.slice(1)) {
			const parts = ml.trimStart().split(": ");
			if (parts.length === 2) {
				lines.push(`${mf(`${parts[0]}:`)} ${tf(parts[1])}`);
			} else {
				lines.push(ml.trimStart());
			}
		}
	}

	const total = countTotalFeatures(plan);
	const runs = estimatedRuns(plan);
	lines.push(mf(`\u2022 Estimated runs: ${total} features + ${plan.milestones.length * 2} validations = ~${runs}`));

	return frame("Draft Mission Plan", lines, width, "A: approve   Esc: back to chat (continue planning)", style);
}

export function handleDraftReviewKey(key: string): DraftReviewAction {
	if (matchesKey(key, "escape")) return { kind: "close" };
	if (key.toUpperCase() === "A") return { kind: "approve" };
	return { kind: "noop" };
}
