import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { getDefaultConfig } from "../config.js";
import type { EnvironmentDescriptor, MissionConfig, MissionPlan, MissionState, ValidationContract } from "../types.js";
import {
	EnvironmentDescriptorSchema,
	MissionConfigSchema,
	MissionPlanSchema,
	MissionStateSchema,
	ValidationContractSchema,
} from "../types.js";

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

const MAX_PROGRESS_LOG_ENTRIES = 500;
const PROGRESS_LOG_TRIM_TO = 400;

function trimProgressLog(state: MissionState): MissionState {
	if (state.progressLog.length <= MAX_PROGRESS_LOG_ENTRIES) return state;
	const trimmed = state.progressLog.slice(state.progressLog.length - PROGRESS_LOG_TRIM_TO);
	return { ...state, progressLog: trimmed };
}

export function saveState(basePath: string, state: MissionState, cacheCallback?: (data: MissionState) => void): void {
	const trimmedState = trimProgressLog(state);
	atomicWrite(statePath(basePath), JSON.stringify(trimmedState, null, 2));
	stateCache = { basePath, state: trimmedState };
	cacheCallback?.(trimmedState);
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

function environmentPath(basePath: string): string {
	return join(basePath, "environment.json");
}

export function saveEnvironment(basePath: string, descriptor: EnvironmentDescriptor): void {
	atomicWrite(environmentPath(basePath), JSON.stringify(descriptor, null, 2));
}

export function loadEnvironment(basePath: string): EnvironmentDescriptor | null {
	const file = environmentPath(basePath);
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
		throw new Error(`environment.json contains invalid JSON: ${(err as Error).message}`);
	}
	if (!Value.Check(EnvironmentDescriptorSchema, parsed)) {
		const errors = [...Value.Errors(EnvironmentDescriptorSchema, parsed)];
		const first = errors[0];
		throw new Error(
			`environment.json failed schema validation: ${first ? `${first.path} ${first.message}` : "unknown error"}`,
		);
	}
	return parsed;
}

function contractPath(basePath: string): string {
	return join(basePath, "validation-contract.json");
}

export function saveContract(basePath: string, contract: ValidationContract): void {
	atomicWrite(contractPath(basePath), JSON.stringify(contract, null, 2));
}

export function loadContract(basePath: string): ValidationContract | null {
	const file = contractPath(basePath);
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
		throw new Error(`validation-contract.json contains invalid JSON: ${(err as Error).message}`);
	}
	if (!Value.Check(ValidationContractSchema, parsed)) {
		const errors = [...Value.Errors(ValidationContractSchema, parsed)];
		const first = errors[0];
		throw new Error(
			`validation-contract.json failed schema validation: ${first ? `${first.path} ${first.message}` : "unknown error"}`,
		);
	}
	return parsed;
}
