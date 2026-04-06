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
