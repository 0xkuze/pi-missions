import type { MissionConfig } from "./types.js";

const DEFAULT_CONFIG: Required<MissionConfig> = {
	models: {},
	validation: {
		commands: [],
		timeoutMs: 120000,
	},
	autonomy: "medium",
	git: {
		autoCommit: true,
	},
	maxRetries: 3,
};

export function getDefaultConfig(): MissionConfig {
	return structuredClone(DEFAULT_CONFIG);
}
