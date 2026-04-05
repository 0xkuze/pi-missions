import type { Feature } from "../types.js";

export function generateWorkerSkill(_feature: Feature, _agentsMdContent?: string): string {
	return "";
}

export function generateWorkerPrompt(_feature: Feature, _additionalContext?: string): string {
	return "";
}

export function generateWorkerContext(_agentsMdContent?: string): string {
	return "";
}

export function writeWorkerFiles(
	_basePath: string,
	_featureId: string,
	_attempt: number,
	_files: { skill: string; prompt: string; context: string },
): void {}
