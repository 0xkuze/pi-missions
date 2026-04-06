import type { MissionState } from "./types.js";

export type InputResult = { action: "continue" } | { action: "transform"; text: string };

export function handleMissionInput(text: string, missionModeActive: boolean, state: MissionState | null): InputResult {
	if (!missionModeActive) return { action: "continue" };
	if (!state || state.status !== "executing") return { action: "continue" };
	if (state.currentFeatureId) {
		return {
			action: "transform",
			text: `[User instruction during mission execution] ${text}`,
		};
	}
	return { action: "continue" };
}
