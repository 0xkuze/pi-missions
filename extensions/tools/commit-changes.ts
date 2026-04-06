import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { detectOutOfScopeChanges, getChangedFiles, isGitAvailable, stageAndCommit } from "../git.js";
import { loadPlan, loadState, saveState } from "../state/manager.js";
import type { MissionConfig, MissionPlan, MissionState } from "../types.js";
import { nowISO } from "../utils.js";

interface Deps {
	basePath: string;
	projectDir: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
	_isGitAvailableOverride?: (cwd: string) => boolean;
	_getChangedFilesOverride?: (cwd: string, baseCommit?: string) => string[];
	_stageAndCommitOverride?: (cwd: string, files: string[], message: string) => string;
}

function findFeatureInPlan(
	plan: MissionPlan,
	featureId: string,
): {
	name: string;
	relevantFiles: string[];
	fixOrigin?: MissionPlan["milestones"][number]["features"][number]["fixOrigin"];
} | null {
	for (const milestone of plan.milestones) {
		const feature = milestone.features.find((f) => f.id === featureId);
		if (feature) {
			return { name: feature.name, relevantFiles: feature.relevantFiles, fixOrigin: feature.fixOrigin };
		}
	}
	return null;
}

function readRawConfig(basePath: string): MissionConfig {
	try {
		const raw = readFileSync(join(basePath, "config.json"), "utf8");
		return JSON.parse(raw) as MissionConfig;
	} catch {
		return {};
	}
}

function resolveAutoCommit(basePath: string, snapshot: MissionState["gitSnapshot"]): boolean {
	const rawConfig = readRawConfig(basePath);
	if (rawConfig.git?.autoCommit !== undefined) {
		return rawConfig.git.autoCommit;
	}
	if (snapshot !== undefined) {
		return snapshot.autoCommitEnabled;
	}
	return true;
}

function buildDefaultMessage(featureName: string, isFix: boolean): string {
	return isFix ? `mission: fix ${featureName}` : `mission: ${featureName}`;
}

export function registerCommitChangesTool(pi: ExtensionAPI, deps: Deps): void {
	const gitAvailable = deps._isGitAvailableOverride ?? isGitAvailable;
	const getChanged = deps._getChangedFilesOverride ?? getChangedFiles;
	const doCommit = deps._stageAndCommitOverride ?? stageAndCommit;

	pi.registerTool({
		name: "commit_changes",
		label: "Commit Changes",
		description:
			"Commit files changed by the current feature. Stages only feature-changed files against the pre-worker snapshot. Never uses git add -A in dirty repos. Returns commit SHA on success or a skip reason when conditions are not met.",
		promptSnippet: "Commit feature changes. Only call after successful worker completion.",
		parameters: Type.Object({
			featureId: Type.String({ description: "ID of the feature whose changes to commit" }),
			message: Type.Optional(Type.String({ description: "Override the default commit message" })),
		}),
		// why: pi Theme uses branded ThemeColor types; we accept `any` at this API boundary
		renderCall(args: any, theme: any) {
			return new Text(
				theme.fg("toolTitle", theme.bold("commit_changes ")) + theme.fg("accent", args.featureId || "..."),
				0,
				0,
			);
		},
		renderResult(result: any, _options: any, theme: any) {
			const text = result.content?.[0];
			const output = text?.type === "text" ? text.text : "(no output)";
			const icon = output.includes("Committed") ? theme.fg("success", "\u2713") : theme.fg("warning", "\u2013");
			const firstLine = output.split("\n")[0];
			return new Text(`${icon} ${firstLine}`, 0, 0);
		},
		async execute(_toolCallId, params) {
			if (!gitAvailable(deps.projectDir)) {
				return {
					content: [{ type: "text", text: "Skipped: git is not available in the project directory." }],
					details: {},
				};
			}

			const state = loadState(deps.basePath);
			if (!state) {
				return {
					content: [{ type: "text", text: "Skipped: no active mission state." }],
					details: {},
				};
			}

			const snapshot = state.gitSnapshot;
			const autoCommitEnabled = resolveAutoCommit(deps.basePath, snapshot);

			if (!autoCommitEnabled) {
				return {
					content: [
						{
							type: "text",
							text: "Skipped: auto-commit is not enabled (repo was dirty at mission start or explicitly disabled).",
						},
					],
					details: {},
				};
			}

			const plan = loadPlan(deps.basePath);
			if (!plan) {
				return {
					content: [{ type: "text", text: "Skipped: no plan found." }],
					details: {},
				};
			}

			const feature = findFeatureInPlan(plan, params.featureId);
			if (!feature) {
				return {
					content: [{ type: "text", text: `Skipped: feature '${params.featureId}' not found in plan.` }],
					details: {},
				};
			}

			const baseCommit = snapshot?.headCommit;
			const changedFiles = getChanged(deps.projectDir, baseCommit);

			if (changedFiles.length === 0) {
				return {
					content: [{ type: "text", text: "Skipped: no files changed since the pre-worker snapshot." }],
					details: {},
				};
			}

			const outOfScope = detectOutOfScopeChanges(changedFiles, feature.relevantFiles);
			const warnings: string[] = [];
			if (outOfScope.length > 0) {
				warnings.push(`Out-of-scope changes detected: ${outOfScope.join(", ")}`);
			}

			const isFix = feature.fixOrigin !== undefined;
			const commitMessage = params.message ?? buildDefaultMessage(feature.name, isFix);

			const sha = doCommit(deps.projectDir, changedFiles, commitMessage);

			const updatedState: MissionState = {
				...state,
				progressLog: [
					...state.progressLog,
					{
						timestamp: nowISO(),
						type: "commit_created" as const,
						detail: `Committed ${changedFiles.length} file(s) for '${feature.name}': ${sha}`,
						metadata: { sha, featureId: params.featureId, filesChanged: changedFiles },
					},
				],
			};
			saveState(deps.basePath, updatedState);
			deps.updateWidget(updatedState, plan);

			const warningText = warnings.length > 0 ? `\n\nWarnings:\n${warnings.map((w) => `- ${w}`).join("\n")}` : "";
			return {
				content: [
					{
						type: "text",
						text: `Committed ${changedFiles.length} file(s) for '${feature.name}'. SHA: ${sha}${warningText}`,
					},
				],
				details: {},
			};
		},
	});
}
