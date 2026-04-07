import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
## report_result
When done, call report_result with:
- whatWasImplemented: string
- whatWasLeftUndone: string
- commandsRun: [{command, exitCode, observation}]
- testsAdded: [{file, cases: [string]}]
- discoveredIssues: [{severity, description, suggestedFix?}]
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
report_result: whatWasImplemented, whatWasLeftUndone, commandsRun, testsAdded, discoveredIssues
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
