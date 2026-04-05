import { rmSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadPlan, loadState, savePlan, saveState } from "./state/manager.js";
import { appendMutation } from "./state/plan-history.js";
import { transitionState } from "./state/transitions.js";
import type { MissionPlan, MissionState, MissionStatus } from "./types.js";
import { formatDuration, generateId, nowISO } from "./utils.js";

const ALLOWED_COMMANDS: Record<MissionStatus, ReadonlySet<string>> = {
	planning: new Set(["mission", "mission-status", "mission-pause", "mission-reset"]),
	draft_review: new Set([
		"mission",
		"mission-status",
		"mission-plan",
		"mission-approve",
		"mission-pause",
		"mission-reset",
	]),
	approved: new Set(["mission", "mission-status", "mission-plan", "mission-pause", "mission-reset"]),
	executing: new Set(["mission", "mission-status", "mission-plan", "mission-pause", "mission-skip", "mission-reset"]),
	validating: new Set(["mission", "mission-status", "mission-pause", "mission-reset"]),
	paused: new Set(["mission", "mission-status", "mission-resume", "mission-plan", "mission-reset"]),
	completed: new Set(["mission", "mission-status", "mission-reset"]),
	failed: new Set(["mission", "mission-status", "mission-reset"]),
	aborted: new Set(["mission", "mission-status", "mission-reset"]),
};

function isCommandAllowed(status: MissionStatus, command: string): boolean {
	return ALLOWED_COMMANDS[status]?.has(command) ?? false;
}

function notAllowedError(command: string, status: MissionStatus): string {
	return `Error: /${command} is not allowed in '${status}' state.`;
}

function formatStatus(state: MissionState, plan?: MissionPlan | null): string {
	const durationMs = Date.now() - new Date(state.startedAt).getTime();
	const duration = formatDuration(durationMs);

	switch (state.status) {
		case "planning":
			return `Mission is in planning phase. Duration: ${duration}.`;
		case "draft_review":
			return `Mission plan is awaiting approval. Duration: ${duration}.`;
		case "approved":
			return `Mission plan approved. Starting execution. Duration: ${duration}.`;
		case "executing": {
			const milestone = plan?.milestones.find((m) => m.id === state.currentMilestoneId);
			const feature = milestone?.features.find((f) => f.id === state.currentFeatureId);
			const totalFeatures = plan?.milestones.reduce((s, m) => s + m.features.length, 0) ?? 0;
			const completedCount = state.totalFeaturesCompleted + state.totalFeaturesSkipped + state.totalFeaturesFailed;
			return (
				`Mission executing. Milestone: ${milestone?.name ?? "none"}. Feature: ${feature?.name ?? "none"}.` +
				` Progress: ${completedCount}/${totalFeatures} features. Duration: ${duration}.`
			);
		}
		case "validating":
			return `Mission is validating. Duration: ${duration}.`;
		case "paused":
			return `Mission is paused (resume target: ${state.resumeTargetState ?? "unknown"}). Duration: ${duration}.`;
		case "completed": {
			const totalDuration = state.completedAt
				? formatDuration(new Date(state.completedAt).getTime() - new Date(state.startedAt).getTime())
				: duration;
			return (
				`Mission completed. Features: ${state.totalFeaturesCompleted} completed, ` +
				`${state.totalFeaturesSkipped} skipped, ${state.totalFeaturesFailed} failed. Duration: ${totalDuration}.`
			);
		}
		case "failed":
			return `Mission failed. Duration: ${duration}.`;
		case "aborted":
			return `Mission was aborted. Duration: ${duration}.`;
		default:
			return `Mission status: ${state.status}.`;
	}
}

function formatPlan(plan: MissionPlan): string {
	const lines: string[] = [`Mission: ${plan.description}`, ""];
	for (const milestone of plan.milestones) {
		lines.push(`Milestone: ${milestone.name} [${milestone.status}]`);
		for (const feature of milestone.features) {
			lines.push(`  - ${feature.name} [${feature.status}]`);
		}
		lines.push("");
	}
	return lines.join("\n").trim();
}

export interface CommandDeps {
	basePath: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
	clearWidget: () => void;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
	pi.registerCommand("mission", {
		description: "Start a new mission or show mission status",
		handler: async (args, ctx) => {
			const description = args.trim();
			const state = loadState(deps.basePath);

			if (!description) {
				if (!state) {
					ctx.ui.notify("No active mission. Run /mission <description> to start one.", "info");
					return;
				}
				const plan = loadPlan(deps.basePath);
				ctx.ui.notify(formatStatus(state, plan), "info");
				return;
			}

			if (state && state.status !== "completed" && state.status !== "failed" && state.status !== "aborted") {
				const plan = loadPlan(deps.basePath);
				ctx.ui.notify(`Mission already active. ${formatStatus(state, plan)}`, "info");
				return;
			}

			const now = nowISO();
			const newState: MissionState = {
				missionId: generateId(),
				status: "planning",
				progressLog: [{ timestamp: now, type: "mission_started", detail: "Mission started" }],
				startedAt: now,
				totalFeaturesCompleted: 0,
				totalFeaturesFailed: 0,
				totalFeaturesSkipped: 0,
				totalFixFeaturesCreated: 0,
			};
			saveState(deps.basePath, newState);
			deps.updateWidget(newState);
			pi.setSessionName(description);
			pi.sendUserMessage(description);
		},
	});

	pi.registerCommand("mission-approve", {
		description: "Approve the draft mission plan and begin execution",
		handler: async (_args, ctx) => {
			const state = loadState(deps.basePath);
			if (!state) {
				ctx.ui.notify("No active mission.", "error");
				return;
			}
			if (!isCommandAllowed(state.status, "mission-approve")) {
				ctx.ui.notify(notAllowedError("mission-approve", state.status), "error");
				return;
			}

			const plan = loadPlan(deps.basePath);
			if (!plan) {
				ctx.ui.notify("Error: no plan found. Cannot approve.", "error");
				return;
			}

			const now = nowISO();
			const newPlanVersion = plan.planVersion + 1;
			const updatedPlan: MissionPlan = { ...plan, approvedAt: now, planVersion: newPlanVersion };
			savePlan(deps.basePath, updatedPlan);

			appendMutation(deps.basePath, {
				planVersion: newPlanVersion,
				timestamp: now,
				actor: "user",
				kind: "plan-approved",
				summary: "Plan approved by user",
				payload: {},
			});

			const newState = transitionState(state, "approved");
			saveState(deps.basePath, newState);
			deps.updateWidget(newState, updatedPlan);

			pi.sendUserMessage(
				"I have approved the mission plan. Please begin execution by calling spawn_worker for the first feature.",
			);
		},
	});

	pi.registerCommand("mission-pause", {
		description: "Pause the active mission",
		handler: async (_args, ctx) => {
			const state = loadState(deps.basePath);
			if (!state) {
				ctx.ui.notify("No active mission.", "error");
				return;
			}
			if (!isCommandAllowed(state.status, "mission-pause")) {
				ctx.ui.notify(notAllowedError("mission-pause", state.status), "error");
				return;
			}

			try {
				const newState = transitionState(state, "paused");
				saveState(deps.basePath, newState);
				const plan = loadPlan(deps.basePath);
				deps.updateWidget(newState, plan ?? undefined);
				ctx.ui.notify("Mission paused.", "info");
			} catch (err) {
				ctx.ui.notify(`Error: ${(err as Error).message}`, "error");
			}
		},
	});

	pi.registerCommand("mission-resume", {
		description: "Resume a paused mission",
		handler: async (_args, ctx) => {
			const state = loadState(deps.basePath);
			if (!state) {
				ctx.ui.notify("No active mission.", "error");
				return;
			}
			if (!isCommandAllowed(state.status, "mission-resume")) {
				ctx.ui.notify(notAllowedError("mission-resume", state.status), "error");
				return;
			}

			const target = state.resumeTargetState;
			if (!target) {
				ctx.ui.notify("Error: paused state has no resumeTargetState.", "error");
				return;
			}

			try {
				const newState = transitionState(state, target);
				saveState(deps.basePath, newState);
				const plan = loadPlan(deps.basePath);
				deps.updateWidget(newState, plan ?? undefined);
				pi.sendUserMessage("Mission resumed. Please continue from where you left off.");
			} catch (err) {
				ctx.ui.notify(`Error: ${(err as Error).message}`, "error");
			}
		},
	});

	pi.registerCommand("mission-skip", {
		description: "Skip the current feature",
		handler: async (_args, ctx) => {
			const state = loadState(deps.basePath);
			if (!state) {
				ctx.ui.notify("No active mission.", "error");
				return;
			}
			if (!isCommandAllowed(state.status, "mission-skip")) {
				ctx.ui.notify(notAllowedError("mission-skip", state.status), "error");
				return;
			}

			const featureId = state.currentFeatureId;
			if (!featureId) {
				ctx.ui.notify("Error: no current feature to skip.", "error");
				return;
			}

			const plan = loadPlan(deps.basePath);
			if (!plan) {
				ctx.ui.notify("Error: no plan found.", "error");
				return;
			}

			let featureName = featureId;
			const updatedPlan: MissionPlan = {
				...plan,
				milestones: plan.milestones.map((m) => ({
					...m,
					features: m.features.map((f) => {
						if (f.id === featureId) {
							featureName = f.name;
							return { ...f, status: "skipped" as const };
						}
						return f;
					}),
				})),
			};
			savePlan(deps.basePath, updatedPlan);

			const updatedState: MissionState = {
				...state,
				currentFeatureId: undefined,
				totalFeaturesSkipped: state.totalFeaturesSkipped + 1,
				progressLog: [
					...state.progressLog,
					{
						timestamp: nowISO(),
						type: "feature_skipped" as const,
						detail: `Feature '${featureName}' skipped by user`,
					},
				],
			};
			saveState(deps.basePath, updatedState);
			deps.updateWidget(updatedState, updatedPlan);
			pi.sendUserMessage(`Feature '${featureName}' has been skipped. Please continue with the next feature.`);
		},
	});

	pi.registerCommand("mission-reset", {
		description: "Reset and clear all mission state",
		handler: async (_args, ctx) => {
			const confirmed = await ctx.ui.confirm(
				"Reset Mission",
				"This will permanently remove all mission state and files. Are you sure?",
			);
			if (!confirmed) {
				return;
			}

			try {
				rmSync(deps.basePath, { recursive: true, force: true });
			} catch {
				// why: directory may not exist if mission never started; ignore
			}

			deps.clearWidget();
			pi.setSessionName("");
			pi.appendEntry("mission-state-cache", null);
			ctx.ui.notify("Mission reset.", "info");
		},
	});

	pi.registerCommand("mission-status", {
		description: "Show current mission status",
		handler: async (_args, ctx) => {
			const state = loadState(deps.basePath);
			if (!state) {
				ctx.ui.notify("No active mission.", "info");
				return;
			}
			const plan = loadPlan(deps.basePath);
			ctx.ui.notify(formatStatus(state, plan), "info");
		},
	});

	pi.registerCommand("mission-plan", {
		description: "Display the current mission plan",
		handler: async (_args, ctx) => {
			const state = loadState(deps.basePath);
			if (!state) {
				ctx.ui.notify("No active mission.", "info");
				return;
			}
			if (!isCommandAllowed(state.status, "mission-plan")) {
				ctx.ui.notify(notAllowedError("mission-plan", state.status), "error");
				return;
			}

			const plan = loadPlan(deps.basePath);
			if (!plan) {
				ctx.ui.notify("No plan available yet.", "info");
				return;
			}
			ctx.ui.notify(formatPlan(plan), "info");
		},
	});
}
