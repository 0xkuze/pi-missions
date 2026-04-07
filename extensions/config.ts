import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadGlobalConfig } from "./state/global-config.js";
import { loadConfig } from "./state/manager.js";
import type { Milestone, MissionConfig, MissionPlan, ModelAssignment, PromptingMode } from "./types.js";

export const DEFAULT_ORCHESTRATOR_MODEL = "opus-4.6";
export const DEFAULT_WORKER_MODEL = "opencode-go/glm-5";
export const DEFAULT_VALIDATOR_MODEL = "openaicodex/gpt-5.4";

const DEFAULT_CONFIG: Required<MissionConfig> = {
	models: {},
	promptingMode: "caveman",
	spawnAndLearn: true,
	validation: {
		commands: [],
		timeoutMs: 120000,
	},
	autonomy: "medium",
	git: {
		autoCommit: true,
	},
	maxRetries: 3,
	workerTimeoutMs: 600_000,
};

export function getDefaultConfig(): MissionConfig {
	return structuredClone(DEFAULT_CONFIG);
}

export function loadMissionConfig(basePath: string): MissionConfig {
	return loadConfig(basePath);
}

type ValidationRole = "typecheck" | "lint" | "test" | "build";

const CANONICAL_ORDER: ValidationRole[] = ["typecheck", "lint", "test", "build"];

function labelCommand(cmd: string): ValidationRole | null {
	const lower = cmd.toLowerCase();
	if (lower.includes("typecheck") || lower.includes("tsc") || lower.includes("type-check")) return "typecheck";
	if (lower.includes("lint")) return "lint";
	if (lower.includes("test") || lower.includes("pytest") || lower.includes("cargo test") || lower.includes("go test"))
		return "test";
	if (lower.includes("build")) return "build";
	return null;
}

function sortCommandsByCanonicalOrder(commands: string[]): string[] {
	const labeled = commands.map((cmd) => ({ cmd, role: labelCommand(cmd) }));
	const ordered: string[] = [];
	for (const role of CANONICAL_ORDER) {
		const found = labeled.filter((item) => item.role === role);
		for (const item of found) {
			ordered.push(item.cmd);
		}
	}
	for (const item of labeled) {
		if (!CANONICAL_ORDER.includes(item.role as ValidationRole)) {
			ordered.push(item.cmd);
		}
	}
	return ordered;
}

let validationCommandCache: { key: string; commands: string[] } | null = null;

function validationCacheKey(
	config: MissionConfig,
	plan: MissionPlan | null,
	milestone: Milestone | null,
	projectDir: string,
): string {
	const configCmds = config.validation?.commands?.join(",") ?? "";
	const milestoneCmds = milestone?.validationCommands?.join(",") ?? "";
	const planCmds = plan?.validationCommands?.join(",") ?? "";
	return `${configCmds}|${milestoneCmds}|${planCmds}|${projectDir}`;
}

export function resolveValidationCommands(
	config: MissionConfig,
	plan: MissionPlan | null,
	milestone: Milestone | null,
	projectDir: string,
): string[] {
	const key = validationCacheKey(config, plan, milestone, projectDir);
	if (validationCommandCache && validationCommandCache.key === key) {
		return validationCommandCache.commands;
	}

	let result: string[];
	if (config.validation?.commands && config.validation.commands.length > 0) {
		result = sortCommandsByCanonicalOrder(config.validation.commands);
	} else if (milestone?.validationCommands && milestone.validationCommands.length > 0) {
		result = sortCommandsByCanonicalOrder(milestone.validationCommands);
	} else if (plan?.validationCommands && plan.validationCommands.length > 0) {
		result = sortCommandsByCanonicalOrder(plan.validationCommands);
	} else {
		result = sortCommandsByCanonicalOrder(autoDetectCommands(projectDir));
	}

	validationCommandCache = { key, commands: result };
	return result;
}

export function clearValidationCommandCache(): void {
	validationCommandCache = null;
}

function autoDetectCommands(projectDir: string): string[] {
	const commands: string[] = [];

	const pkgPath = join(projectDir, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
			const scripts = pkg.scripts as Record<string, string> | undefined;
			if (scripts) {
				if (scripts.typecheck) commands.push("npm run typecheck");
				if (scripts.lint) commands.push("npm run lint");
				if (scripts.test) commands.push("npm run test");
				if (scripts.build) commands.push("npm run build");
			}
		} catch {
			// malformed package.json: skip
		}
		return commands;
	}

	const bunBuildPath = join(projectDir, "bun.lock");
	if (existsSync(bunBuildPath)) {
		commands.push("bun test");
		return commands;
	}

	const cargoPath = join(projectDir, "Cargo.toml");
	if (existsSync(cargoPath)) {
		commands.push("cargo test");
		return commands;
	}

	const goModPath = join(projectDir, "go.mod");
	if (existsSync(goModPath)) {
		commands.push("go test ./...");
		return commands;
	}

	const setupPyPath = join(projectDir, "setup.py");
	const pyprojectPath = join(projectDir, "pyproject.toml");
	if (existsSync(setupPyPath) || existsSync(pyprojectPath)) {
		commands.push("pytest");
		return commands;
	}

	const makefilePath = join(projectDir, "Makefile");
	if (existsSync(makefilePath)) {
		try {
			const makefile = readFileSync(makefilePath, "utf8");
			const targets = extractMakefileTargets(makefile);
			if (targets.includes("test")) commands.push("make test");
			if (targets.includes("lint")) commands.push("make lint");
			if (targets.includes("typecheck")) commands.push("make typecheck");
			if (targets.includes("build")) commands.push("make build");
		} catch {
			// unreadable Makefile: skip
		}
	}

	return commands;
}

function extractMakefileTargets(content: string): string[] {
	const targets: string[] = [];
	for (const line of content.split("\n")) {
		const match = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*:/.exec(line);
		if (match?.[1]) {
			targets.push(match[1]);
		}
	}
	return targets;
}

export function resolveModel(
	role: keyof ModelAssignment,
	config: MissionConfig,
	plan: MissionPlan | null,
	complexity?: "low" | "medium" | "high",
): string | undefined {
	if (role === "worker" && complexity && config.modelByComplexity?.[complexity]) {
		return config.modelByComplexity[complexity];
	}
	if (config.models?.[role]) {
		return config.models[role];
	}
	if (plan?.modelAssignment?.[role]) {
		return plan.modelAssignment[role];
	}
	const global = loadGlobalConfig();
	if (global?.models?.[role]) {
		return global.models[role];
	}
	switch (role) {
		case "orchestrator":
			return DEFAULT_ORCHESTRATOR_MODEL;
		case "worker":
			return DEFAULT_WORKER_MODEL;
		case "validator":
			return DEFAULT_VALIDATOR_MODEL;
	}
	return undefined;
}

export function resolvePromptingMode(config: MissionConfig): PromptingMode {
	if (config.promptingMode) return config.promptingMode;
	const global = loadGlobalConfig();
	if (global?.promptingMode) return global.promptingMode;
	return "caveman";
}

export function resolveSpawnAndLearn(config: MissionConfig): boolean {
	if (config.spawnAndLearn !== undefined) return config.spawnAndLearn;
	const global = loadGlobalConfig();
	if (global?.spawnAndLearn !== undefined) return global.spawnAndLearn;
	return true;
}
