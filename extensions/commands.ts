import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadPlan, loadState } from "./state/manager.js";
import type { MissionPlan, MissionState } from "./types.js";

export interface CommandDeps {
	basePath: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
	clearWidget: () => void;
	isMissionModeActive: () => boolean;
	setMissionModeActive: (active: boolean) => void;
	onActivate: () => void;
	onDeactivate: () => void;
}

function hasUnfinishedWork(basePath: string): boolean {
	const plan = loadPlan(basePath);
	if (!plan) return false;
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.status === "pending" || feature.status === "active") return true;
		}
	}
	return false;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
	pi.registerCommand("mission-mode", {
		description: "Toggle mission mode on or off",
		handler: async (_args, ctx) => {
			if (deps.isMissionModeActive()) {
				const state = loadState(deps.basePath);
				const activeStatuses = new Set(["planning", "draft_review", "approved", "executing", "validating"]);
				const needsConfirmation =
					state &&
					activeStatuses.has(state.status) &&
					(state.status !== "executing" || hasUnfinishedWork(deps.basePath));
				if (needsConfirmation) {
					const confirmed = await ctx.ui.confirm(
						"Deactivate Mission Mode",
						"A mission is currently active. Deactivating will pause it. Continue?",
					);
					if (!confirmed) return;
				}
				deps.setMissionModeActive(false);
				deps.onDeactivate();
				ctx.ui.notify("Mission mode deactivated.", "info");
			} else {
				deps.setMissionModeActive(true);
				deps.onActivate();
				ctx.ui.notify(
					"Mission mode activated. Open Mission Control with Ctrl+Shift+M or describe your mission goal.",
					"info",
				);
			}
		},
	});
}
