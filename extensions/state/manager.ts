import { getDefaultConfig } from "../config.js";
import type { MissionConfig, MissionPlan, MissionState } from "../types.js";

export function saveState(_basePath: string, _state: MissionState): void {}

export function loadState(_basePath: string): MissionState | null {
	return null;
}

export function savePlan(_basePath: string, _plan: MissionPlan): void {}

export function loadPlan(_basePath: string): MissionPlan | null {
	return null;
}

export function saveConfig(_basePath: string, _config: MissionConfig): void {}

export function loadConfig(_basePath: string): MissionConfig {
	return getDefaultConfig();
}
