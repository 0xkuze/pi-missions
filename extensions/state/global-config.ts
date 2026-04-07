import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { DEFAULT_ORCHESTRATOR_MODEL, DEFAULT_VALIDATOR_MODEL, DEFAULT_WORKER_MODEL } from "../config.js";
import type { GlobalConfig } from "../types.js";
import { GlobalConfigSchema } from "../types.js";

let pathOverride: string | null = null;

export function setGlobalConfigPathForTesting(path: string | null): void {
	pathOverride = path;
}

function globalConfigPath(): string {
	if (pathOverride) return pathOverride;
	return join(homedir(), ".pi", "missions", "global-config.json");
}

function ensureDir(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
}

function atomicWrite(filePath: string, content: string): void {
	ensureDir(filePath);
	const tmp = `${filePath}.tmp`;
	writeFileSync(tmp, content, "utf8");
	renameSync(tmp, filePath);
}

export function loadGlobalConfig(): GlobalConfig | null {
	try {
		const raw = readFileSync(globalConfigPath(), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!Value.Check(GlobalConfigSchema, parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function saveGlobalConfig(config: GlobalConfig): void {
	atomicWrite(globalConfigPath(), JSON.stringify(config, null, 2));
}

export function isOnboardingCompleted(): boolean {
	const config = loadGlobalConfig();
	return config?.onboardingCompleted === true;
}

export function getDefaultGlobalConfig(): GlobalConfig {
	return {
		models: {
			orchestrator: DEFAULT_ORCHESTRATOR_MODEL,
			worker: DEFAULT_WORKER_MODEL,
			validator: DEFAULT_VALIDATOR_MODEL,
		},
		promptingMode: "caveman",
		spawnAndLearn: true,
		onboardingCompleted: false,
	};
}
