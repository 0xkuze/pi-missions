import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { getDefaultConfig } from "../config.js";
import type { MissionConfig, MissionPlan, MissionState } from "../types.js";
import { MissionConfigSchema, MissionPlanSchema, MissionStateSchema } from "../types.js";

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

export function saveState(basePath: string, state: MissionState): void {
	atomicWrite(statePath(basePath), JSON.stringify(state, null, 2));
}

export function loadState(basePath: string): MissionState | null {
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
	return parsed;
}

export function savePlan(basePath: string, plan: MissionPlan): void {
	atomicWrite(planPath(basePath), JSON.stringify(plan, null, 2));
}

export function loadPlan(basePath: string): MissionPlan | null {
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
