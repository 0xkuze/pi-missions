import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readLibraryTopic } from "../state/library.js";
import { loadEnvironment } from "../state/manager.js";
import type { Feature, PromptingMode } from "../types.js";

export function generateWorkerSkill(feature: Feature, agentsMdContent?: string, promptingMode?: PromptingMode): string {
	if (promptingMode === "caveman" || promptingMode === "caveman-full")
		return generateCavemanWorkerSkill(feature, agentsMdContent);
	const criteriaList = feature.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
	const filesList =
		feature.relevantFiles.length > 0 ? feature.relevantFiles.map((f) => `- ${f}`).join("\n") : "(none specified)";
	const conventionsSection = agentsMdContent ? `\n${agentsMdContent}` : "";
	return `# ${feature.name}
${feature.description}
## Criteria
${criteriaList}
## Files
${filesList}
## report_result TOOL CALL
You MUST call the report_result tool (not output text) before finishing.
Parameters: whatWasImplemented (string), whatWasLeftUndone (string), commandsRun ([{command, exitCode, observation}]), testsAdded ([{file, cases: [string]}]), discoveredIssues ([{severity, description, suggestedFix?}])
## Verification
Run tests. Run lint. Fix if broken.${conventionsSection}`;
}

function generateCavemanWorkerSkill(feature: Feature, agentsMdContent?: string): string {
	const criteria = feature.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
	const files = feature.relevantFiles.length > 0 ? feature.relevantFiles.join(", ") : "(none)";
	const conventions = agentsMdContent ? `\n${agentsMdContent}` : "";
	return `# ${feature.name}
${feature.description}
Do: ${criteria}
Files: ${files}
report_result TOOL: whatWasImplemented, whatWasLeftUndone, commandsRun, testsAdded, discoveredIssues
Run tests. Fix if broken.${conventions}`;
}

export function generateWorkerPrompt(feature: Feature, additionalContext?: string): string {
	const base = `Implement the following task: ${feature.description}`;
	if (!additionalContext) return base;
	return `${base}\n\n## Additional Context\n\n${additionalContext}`;
}

export interface CompletedFeatureSummary {
	name: string;
	description: string;
	relevantFiles: string[];
}

const LIBRARY_TOPIC_HEADER_RE = /^#\s+\w+\s*\n?$/;

function isHeaderOnly(content: string): boolean {
	return LIBRARY_TOPIC_HEADER_RE.test(content.trim());
}

function buildLibrarySection(basePath: string): string {
	const sections: string[] = [];
	const pitfalls = readLibraryTopic(basePath, "pitfalls");
	if (pitfalls && !isHeaderOnly(pitfalls)) {
		sections.push(`## Known Pitfalls\n\n${pitfalls}`);
	}
	const conventions = readLibraryTopic(basePath, "conventions");
	if (conventions && !isHeaderOnly(conventions)) {
		sections.push(`## Project Conventions\n\n${conventions}`);
	}
	return sections.join("\n\n");
}

function buildEnvironmentSection(basePath: string): string {
	const env = loadEnvironment(basePath);
	if (!env) return "";
	const hasServices = env.services && env.services.length > 0;
	const hasEnvVars = env.envVars && env.envVars.length > 0;
	if (!hasServices && !hasEnvVars) return "";
	const parts: string[] = [];
	if (hasServices) {
		const serviceLines = env.services!.map((s) => `- ${s.name} (${s.type})`).join("\n");
		parts.push(`### Services\n${serviceLines}`);
	}
	if (hasEnvVars) {
		const envVarLines = env.envVars!.map((v) => `- ${v.key}=${v.secret ? "<secret>" : v.value}`).join("\n");
		parts.push(`### Environment Variables\n${envVarLines}`);
	}
	return `## Environment\n\n${parts.join("\n\n")}`;
}

const TSCONFIG_KEYS = [
	"strict",
	"module",
	"target",
	"moduleResolution",
	"verbatimModuleSyntax",
	"isolatedModules",
] as const;

function buildTsConfigSection(projectDir: string): string {
	const tsconfigPath = join(projectDir, "tsconfig.json");
	if (!existsSync(tsconfigPath)) return "";
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(tsconfigPath, "utf8"));
	} catch {
		return "";
	}
	if (typeof parsed !== "object" || parsed === null || !("compilerOptions" in parsed)) return "";
	const opts = (parsed as { compilerOptions: Record<string, unknown> }).compilerOptions;
	if (typeof opts !== "object" || opts === null) return "";
	const lines: string[] = [];
	for (const key of TSCONFIG_KEYS) {
		if (key in opts) {
			lines.push(`- ${key}: ${String(opts[key])}`);
		}
	}
	if (lines.length === 0) return "";
	return `## TypeScript Configuration\n\n${lines.join("\n")}`;
}

function buildPackageInfoSection(projectDir: string): string {
	const pkgPath = join(projectDir, "package.json");
	if (!existsSync(pkgPath)) return "";
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(pkgPath, "utf8"));
	} catch {
		return "";
	}
	if (typeof parsed !== "object" || parsed === null) return "";
	const pkg = parsed as Record<string, unknown>;
	const parts: string[] = [];
	if ("type" in pkg && typeof pkg.type === "string") {
		parts.push(`- type: ${pkg.type}`);
	}
	if ("scripts" in pkg && typeof pkg.scripts === "object" && pkg.scripts !== null) {
		const scripts = Object.keys(pkg.scripts as Record<string, unknown>);
		if (scripts.length > 0) {
			parts.push(`- scripts: ${scripts.join(", ")}`);
		}
	}
	const allDeps: string[] = [];
	for (const depField of ["dependencies", "devDependencies"] as const) {
		if (depField in pkg && typeof pkg[depField] === "object" && pkg[depField] !== null) {
			allDeps.push(...Object.keys(pkg[depField] as Record<string, unknown>));
		}
	}
	if (allDeps.length > 0) {
		parts.push(`- deps: ${allDeps.join(", ")}`);
	}
	if (parts.length === 0) return "";
	return `## Project Info\n\n${parts.join("\n")}`;
}

function buildProjectStructureSection(projectDir: string): string {
	for (const dir of ["src", "extensions", "lib"]) {
		const dirPath = join(projectDir, dir);
		if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
			const entries = readdirSync(dirPath).sort();
			if (entries.length === 0) continue;
			const lines = entries.map((e) => `- ${e}`).join("\n");
			return `## Project Structure\n\n${dir}/\n${lines}`;
		}
	}
	return "";
}

export function generateWorkerContext(
	agentsMdContent?: string,
	completedFeatures?: CompletedFeatureSummary[],
	basePath?: string,
	projectDir?: string,
): string {
	const parts: string[] = [];
	if (agentsMdContent) {
		parts.push(agentsMdContent);
	}
	if (basePath) {
		const librarySection = buildLibrarySection(basePath);
		if (librarySection) {
			parts.push(librarySection);
		}
		const envSection = buildEnvironmentSection(basePath);
		if (envSection) {
			parts.push(envSection);
		}
	}
	if (projectDir) {
		const tsSection = buildTsConfigSection(projectDir);
		if (tsSection) parts.push(tsSection);
		const pkgSection = buildPackageInfoSection(projectDir);
		if (pkgSection) parts.push(pkgSection);
		const structSection = buildProjectStructureSection(projectDir);
		if (structSection) parts.push(structSection);
	}
	if (completedFeatures && completedFeatures.length > 0) {
		const featureLines = completedFeatures.map(
			(f) => `- ${f.name}: ${f.description} (files: ${f.relevantFiles.join(", ") || "none"})`,
		);
		parts.push(
			`## Already completed features\n\nThese features have been implemented before your task. Build on top of the existing project structure and files they created.\n\n${featureLines.join("\n")}`,
		);
	}
	return parts.join("\n\n");
}

export function writeWorkerFiles(
	basePath: string,
	featureId: string,
	attempt: number,
	files: { skill: string; prompt: string; context: string },
): void {
	const dir = join(basePath, "runtime", featureId, String(attempt));
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "worker-skill.md"), files.skill, "utf8");
	writeFileSync(join(dir, "worker-prompt.md"), files.prompt, "utf8");
	writeFileSync(join(dir, "worker-context.md"), files.context, "utf8");
}
