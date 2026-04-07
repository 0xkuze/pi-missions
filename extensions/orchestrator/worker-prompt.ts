import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Feature, PromptingMode } from "../types.js";

export function generateWorkerSkill(feature: Feature, agentsMdContent?: string, promptingMode?: PromptingMode): string {
	if (promptingMode === "caveman" || promptingMode === "caveman-full")
		return generateCavemanWorkerSkill(feature, agentsMdContent);
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
- Do not introduce unrelated refactors or improvements.

## Procedure

1. Read the relevant files listed above and understand the existing code structure.
2. Review the acceptance criteria carefully before writing any code.
3. If the project has tests, write or update tests for your changes first.
4. Implement the changes to satisfy all acceptance criteria.
5. Run the project's test command (if available) and fix any failures.
6. Run the project's lint/format command (if available) and fix any issues.
7. Verify every acceptance criterion is met before finishing.

## Verification

Before finishing, you MUST:
- Run the project's test command. If tests fail, fix them.
- Run the project's lint command. If lint fails, fix the issues.
- Do not finish with failing tests or lint errors.

## Completion

As your final message, include a structured summary:
- Files changed: (list files you created or modified)
- Tests: passed / failed / not run
- Lint: clean / issues / not run
- Remaining issues: (any known issues or none)${conventionsSection}`;
}

function generateCavemanWorkerSkill(feature: Feature, agentsMdContent?: string): string {
	const criteria = feature.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
	const files = feature.relevantFiles.length > 0 ? feature.relevantFiles.join(", ") : "(none)";
	const conventions = agentsMdContent ? `\nConventions:\n${agentsMdContent}` : "";
	return `# ${feature.name}

${feature.description}

Do this:
${criteria}

Files: ${files}

Only touch listed files. Run tests. Run lint. Fix if broken. No extras.${conventions}`;
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

export function generateWorkerContext(agentsMdContent?: string, completedFeatures?: CompletedFeatureSummary[]): string {
	const parts: string[] = [];
	if (agentsMdContent) {
		parts.push(agentsMdContent);
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
