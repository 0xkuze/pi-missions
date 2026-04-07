import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Feature } from "../types.js";

export function generateValidatorSkill(feature: Feature): string {
	const criteria = feature.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
	return `# Code Reviewer

You are reviewing code produced by a worker for a specific feature.

## Feature
Name: ${feature.name}
Description: ${feature.description}

## Acceptance Criteria
${criteria}

## Your Task
1. Read each file listed in the prompt
2. Check every acceptance criterion listed above
3. Run type checks or tests if the project has them
4. Output your verdict as the LAST lines of your response

## Verdict Format (REQUIRED — must be the last two lines)

VERDICT: PASS
FEEDBACK: All acceptance criteria met.

OR

VERDICT: FIX
FEEDBACK: <describe exactly what needs to change — file names, line numbers, what is wrong>

OR

VERDICT: REJECT
FEEDBACK: <describe architectural issue that requires a different approach>

## Rules
- VERDICT must be exactly one of: PASS, FIX, REJECT
- PASS = all acceptance criteria are satisfied, code is correct
- FIX = issues the original worker can fix with your specific guidance
- REJECT = wrong approach, missing dependency, or needs replanning by orchestrator
- Be specific in FEEDBACK. Reference exact file names and what is wrong.
- Do NOT modify any files. Only read and review.
- Do NOT use edit or write tools. Read-only review.`;
}

export function generateValidatorPrompt(feature: Feature, workerSummary: string, filesChanged: string[]): string {
	const files =
		filesChanged.length > 0
			? filesChanged.join(", ")
			: "(no files tracked — scan the project directory for relevant files)";

	return `Review the implementation of feature "${feature.name}".

Files changed by worker: ${files}

Worker's summary:
${workerSummary}

Read each file listed above. Check every acceptance criterion. Run tests/typecheck if available. Output your VERDICT.`;
}

export function writeValidatorFiles(
	basePath: string,
	featureId: string,
	attempt: number,
	files: { skill: string; prompt: string },
): void {
	const dir = join(basePath, "runtime", featureId, String(attempt));
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "validator-skill.md"), files.skill, "utf8");
	writeFileSync(join(dir, "validator-prompt.md"), files.prompt, "utf8");
}
