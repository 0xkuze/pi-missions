import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { getDefaultConfig } from "../config.js";
import type { MissionConfig, MissionPlan, MissionState } from "../types.js";
import { MissionConfigSchema, MissionPlanSchema, MissionStateSchema } from "../types.js";

let stateCache: { basePath: string; state: MissionState } | null = null;
let planCache: { basePath: string; plan: MissionPlan } | null = null;

export function clearStateCache(): void {
	stateCache = null;
}

export function clearPlanCache(): void {
	planCache = null;
}

export function invalidateCaches(basePath: string): void {
	if (stateCache && stateCache.basePath === basePath) stateCache = null;
	if (planCache && planCache.basePath === basePath) planCache = null;
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

function statePath(basePath: string): string {
	return join(basePath, "state.json");
}

function planPath(basePath: string): string {
	return join(basePath, "plan.json");
}

function configPath(basePath: string): string {
	return join(basePath, "config.json");
}

export function saveState(basePath: string, state: MissionState, cacheCallback?: (data: MissionState) => void): void {
	atomicWrite(statePath(basePath), JSON.stringify(state, null, 2));
	stateCache = { basePath, state };
	cacheCallback?.(state);
}

export function loadState(basePath: string): MissionState | null {
	if (stateCache && stateCache.basePath === basePath) {
		return stateCache.state;
	}
	const file = statePath(basePath);
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`state.json contains invalid JSON: ${(err as Error).message}`);
	}
	if (!Value.Check(MissionStateSchema, parsed)) {
		const errors = [...Value.Errors(MissionStateSchema, parsed)];
		const first = errors[0];
		throw new Error(
			`state.json failed schema validation: ${first ? `${first.path} ${first.message}` : "unknown error"}`,
		);
	}
	stateCache = { basePath, state: parsed };
	return parsed;
}

export function savePlan(basePath: string, plan: MissionPlan, cacheCallback?: (data: MissionPlan) => void): void {
	atomicWrite(planPath(basePath), JSON.stringify(plan, null, 2));
	planCache = { basePath, plan };
	cacheCallback?.(plan);
}

export function loadPlan(basePath: string): MissionPlan | null {
	if (planCache && planCache.basePath === basePath) {
		return planCache.plan;
	}
	const file = planPath(basePath);
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`plan.json contains invalid JSON: ${(err as Error).message}`);
	}
	if (!Value.Check(MissionPlanSchema, parsed)) {
		const errors = [...Value.Errors(MissionPlanSchema, parsed)];
		const first = errors[0];
		throw new Error(
			`plan.json failed schema validation: ${first ? `${first.path} ${first.message}` : "unknown error"}`,
		);
	}
	planCache = { basePath, plan: parsed };
	return parsed;
}

export function saveConfig(basePath: string, config: MissionConfig): void {
	atomicWrite(configPath(basePath), JSON.stringify(config, null, 2));
}

export function loadConfig(basePath: string): MissionConfig {
	const file = configPath(basePath);
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return getDefaultConfig();
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`config.json contains invalid JSON: ${(err as Error).message}`);
	}
	if (!Value.Check(MissionConfigSchema, parsed)) {
		const errors = [...Value.Errors(MissionConfigSchema, parsed)];
		const first = errors[0];
		throw new Error(
			`config.json failed schema validation: ${first ? `${first.path} ${first.message}` : "unknown error"}`,
		);
	}
	const defaults = getDefaultConfig();
	return mergeConfig(defaults, parsed);
}

function mergeConfig(defaults: MissionConfig, overrides: MissionConfig): MissionConfig {
	return {
		...defaults,
		...overrides,
		models: overrides.models ?? defaults.models,
		validation: overrides.validation ? { ...defaults.validation, ...overrides.validation } : defaults.validation,
		git: overrides.git ? { ...defaults.git, ...overrides.git } : defaults.git,
	};
}
