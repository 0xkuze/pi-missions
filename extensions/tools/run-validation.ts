import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadMissionConfig, resolveValidationCommands } from "../config.js";
import { loadPlan, loadState, saveState } from "../state/manager.js";
import type { MissionPlan, MissionState, ValidationResult } from "../types.js";
import { nowISO } from "../utils.js";

type CommandResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};

export type ExecFn = (cmd: string, cwd: string, timeoutMs: number) => Promise<CommandResult>;

export interface RunValidationDeps {
	basePath: string;
	projectDir: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
	exec: ExecFn;
}

function sanitizeLabel(cmd: string): string {
	return cmd
		.replace(/[^a-zA-Z0-9_-]/g, "-")
		.replace(/-+/g, "-")
		.substring(0, 50);
}

function inferLabel(cmd: string): string {
	const lower = cmd.toLowerCase();
	if (lower.includes("typecheck") || lower.includes("tsc")) return "typecheck";
	if (lower.includes("lint")) return "lint";
	if (lower.includes("test") || lower.includes("pytest") || lower.includes("cargo test") || lower.includes("go test"))
		return "test";
	if (lower.includes("build")) return "build";
	return sanitizeLabel(cmd);
}

function buildSummary(commands: ValidationResult["commands"]): string {
	if (commands.length === 0) {
		return "No validation commands configured. Validation passed by default.";
	}
	const total = commands.length;
	const passed = commands.filter((c) => c.exitCode === 0 && !c.timedOut).length;
	const failed = total - passed;
	if (failed === 0) {
		return `All ${total} check${total === 1 ? "" : "s"} passed.`;
	}
	const failingLabels = commands
		.filter((c) => c.exitCode !== 0 || c.timedOut)
		.map((c) => c.label)
		.join(", ");
	return `${passed}/${total} checks passed, ${failed} failed: ${failingLabels}`;
}

export function registerRunValidationTool(pi: ExtensionAPI, deps: RunValidationDeps): void {
	const runCmd = deps.exec;

	pi.registerTool({
		name: "run_validation",
		label: "Run Validation",
		description:
			"Run validation commands for a milestone. Executes typecheck, lint, test, and build in canonical order. All commands run even if earlier ones fail. Returns a structured ValidationResult.",
		parameters: Type.Object({
			milestoneId: Type.String({ description: "ID of the milestone to validate" }),
		}),
		async execute(_toolCallId, params) {
			const state = loadState(deps.basePath);
			if (!state) {
				return { content: [{ type: "text", text: "Error: no active mission state." }], details: {} };
			}

			if (state.status !== "executing") {
				return {
					content: [
						{
							type: "text",
							text: `Error: run_validation requires 'executing' state. Current: '${state.status}'.`,
						},
					],
					details: {},
				};
			}

			const plan = loadPlan(deps.basePath);
			if (!plan) {
				return { content: [{ type: "text", text: "Error: no plan found." }], details: {} };
			}

			const milestone = plan.milestones.find((m) => m.id === params.milestoneId);
			if (!milestone) {
				return {
					content: [
						{
							type: "text",
							text: `Error: milestone '${params.milestoneId}' not found in plan.`,
						},
					],
					details: {},
				};
			}

			const config = loadMissionConfig(deps.basePath);
			const timeoutMs = config.validation?.timeoutMs ?? 120000;
			const commands = resolveValidationCommands(config, plan, milestone, deps.projectDir);

			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const runDir = join(deps.basePath, "runtime", "validation", params.milestoneId, timestamp);
			mkdirSync(runDir, { recursive: true });

			const validatingState: MissionState = {
				...state,
				status: "validating",
				progressLog: [
					...state.progressLog,
					{
						timestamp: nowISO(),
						type: "validation_start" as const,
						detail: `Validation started for milestone '${milestone.name}'`,
						metadata: { milestoneId: params.milestoneId },
					},
				],
			};
			saveState(deps.basePath, validatingState);
			deps.updateWidget(validatingState, plan);

			if (commands.length === 0) {
				const emptyResult: ValidationResult = {
					status: "pass",
					milestoneId: params.milestoneId,
					commands: [],
					summary: "No validation commands configured. Validation passed by default.",
					failingChecks: [],
				};

				writeFileSync(join(runDir, "result.json"), JSON.stringify(emptyResult, null, 2), "utf8");

				const executingState: MissionState = {
					...validatingState,
					status: "executing",
					progressLog: [
						...validatingState.progressLog,
						{
							timestamp: nowISO(),
							type: "validation_pass" as const,
							detail: `Validation passed for milestone '${milestone.name}' (no commands)`,
						},
					],
				};
				saveState(deps.basePath, executingState);
				deps.updateWidget(executingState, plan);

				return {
					content: [{ type: "text", text: JSON.stringify(emptyResult) }],
					details: {},
				};
			}

			const commandResults: ValidationResult["commands"] = [];

			for (const cmd of commands) {
				const label = inferLabel(cmd);
				const safeLabel = sanitizeLabel(label);
				const stdoutPath = join(runDir, `${safeLabel}-stdout.log`);
				const stderrPath = join(runDir, `${safeLabel}-stderr.log`);

				const start = Date.now();
				const cmdResult = await runCmd(cmd, deps.projectDir, timeoutMs);
				const durationMs = Date.now() - start;

				writeFileSync(stdoutPath, cmdResult.stdout, "utf8");
				writeFileSync(stderrPath, cmdResult.stderr, "utf8");

				commandResults.push({
					label,
					command: cmd,
					exitCode: cmdResult.exitCode,
					durationMs,
					timedOut: cmdResult.timedOut,
					stdoutPath,
					stderrPath,
				});
			}

			const failingChecks = commandResults.filter((c) => c.exitCode !== 0 || c.timedOut).map((c) => c.label);

			const overallStatus: "pass" | "fail" = failingChecks.length === 0 ? "pass" : "fail";
			const summary = buildSummary(commandResults);

			const validationResult: ValidationResult = {
				status: overallStatus,
				milestoneId: params.milestoneId,
				commands: commandResults,
				summary,
				failingChecks,
			};

			writeFileSync(join(runDir, "result.json"), JSON.stringify(validationResult, null, 2), "utf8");

			const progressEventType =
				overallStatus === "pass" ? ("validation_pass" as const) : ("validation_fail" as const);
			const executingState: MissionState = {
				...validatingState,
				status: "executing",
				progressLog: [
					...validatingState.progressLog,
					{
						timestamp: nowISO(),
						type: progressEventType,
						detail: summary,
						metadata: { milestoneId: params.milestoneId, failingChecks },
					},
				],
			};
			saveState(deps.basePath, executingState);
			deps.updateWidget(executingState, plan);

			return {
				content: [{ type: "text", text: JSON.stringify(validationResult) }],
				details: {},
			};
		},
	});
}
