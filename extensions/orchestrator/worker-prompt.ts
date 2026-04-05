import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Feature } from "../types.js";

export function generateWorkerSkill(feature: Feature, agentsMdContent?: string): string {
	const criteriaList = feature.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
	const filesList =
		feature.relevantFiles.length > 0 ? feature.relevantFiles.map((f) => `- ${f}`).join("\n") : "(none specified)";

	const conventionsSection = agentsMdContent ? `\n## Project Conventions\n\n${agentsMdContent}` : "";

	return `# Task: ${feature.name}

## Description

${feature.description}

## Acceptance Criteria

${criteriaList}

## Relevant Files

${filesList}

## Focus Instructions

- Implement only what is described in this task. Do not modify unrelated files.
- All acceptance criteria must be satisfied before finishing.
- Keep changes focused and minimal.
- Do not introduce unrelated refactors or improvements.${conventionsSection}`;
}

export function generateWorkerPrompt(feature: Feature, additionalContext?: string): string {
	const base = `Implement the following task: ${feature.description}`;
	if (!additionalContext) return base;
	return `${base}\n\n## Additional Context\n\n${additionalContext}`;
}

export function generateWorkerContext(agentsMdContent?: string): string {
	if (!agentsMdContent) return "";
	return agentsMdContent;
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
