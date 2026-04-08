import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { resolveModel, resolveSpawnAndLearn } from "../config.js";
import { getChangedFiles, isGitAvailable, stageAndCommit } from "../git.js";
import { learnFromResult } from "../learn.js";
import { clearProtocolCache } from "../orchestrator/protocol.js";
import {
	type CompletedFeatureSummary,
	generateWorkerContext,
	generateWorkerPrompt,
	generateWorkerSkill,
	writeWorkerFiles,
} from "../orchestrator/worker-prompt.js";
import { findFeature } from "../plan-helpers.js";
import type { ProcLike, SpawnFn } from "../process-types.js";
import { loadConfig, loadEnvironment, loadPlan, loadState, savePlan, saveState } from "../state/manager.js";
import { autoCompleteMilestone, autoStartMilestone, findMilestoneForFeature } from "../state/milestone-lifecycle.js";
import { transitionState } from "../state/transitions.js";
import type { Feature, MissionPlan, MissionState, WorkerAttempt, WorkerResult } from "../types.js";
import { getPiInvocation, nowISO } from "../utils.js";
import { removePidFile, writePidFile } from "../worker-pid.js";
import { addFixFeatureToPlan } from "./create-fix.js";
import { synthesizeWorkerResult } from "./result-synthesis.js";
import { runValidator } from "./validate-worker.js";

interface SetupCommandResult {
	success: boolean;
	command: string;
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

type RunSetupCommandFn = (command: string, cwd: string, timeoutMs: number) => Promise<SetupCommandResult>;
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface Deps {
	basePath: string;
	projectDir: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
	refreshWidget?: (state: MissionState, plan?: MissionPlan) => void;
	getThinkingLevel?: () => ThinkingLevel;
	setThinkingLevel?: (level: ThinkingLevel) => void;
	availableModels?: string[] | (() => string[]);
	_spawnOverride?: SpawnFn;
	_isGitAvailableOverride?: (cwd: string) => boolean;
	_getChangedFilesOverride?: (cwd: string, baseCommit?: string) => string[];
	_stageAndCommitOverride?: (cwd: string, files: string[], message: string) => string;
	_runSetupCommandOverride?: RunSetupCommandFn;
}

const TERMINAL_FEATURE_STATUSES = new Set(["blocked", "skipped", "done"]);
const DEFAULT_WORKER_TIMEOUT_MS = 600_000;
const SIGKILL_GRACE_MS = 5000;

let activeWorkerProcess: { proc: ProcLike; kill: () => void } | null = null;

export function killActiveWorker(): void {
	if (activeWorkerProcess) {
		activeWorkerProcess.kill();
		activeWorkerProcess = null;
	}
}

function findAllFeatures(plan: MissionPlan): Map<string, Feature> {
	const map = new Map<string, Feature>();
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			map.set(feature.id, feature);
		}
	}
	return map;
}

function findNextPending(plan: MissionPlan, currentFeatureId: string): Feature | null {
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.id !== currentFeatureId && feature.status === "pending") {
				return feature;
			}
		}
	}
	return null;
}

function collectCompletedFeatures(plan: MissionPlan, excludeFeatureId: string): CompletedFeatureSummary[] {
	const completed: CompletedFeatureSummary[] = [];
	for (const milestone of plan.milestones) {
		for (const f of milestone.features) {
			if (f.id !== excludeFeatureId && f.status === "done") {
				completed.push({ name: f.name, description: f.description, relevantFiles: f.relevantFiles });
			}
		}
	}
	return completed;
}

const RESOLVED_DEP_STATUSES = new Set(["done", "skipped", "failed"]);

function checkDependencies(feature: Feature, allFeatures: Map<string, Feature>): string | null {
	for (const depId of feature.dependencies) {
		const dep = allFeatures.get(depId);
		if (!dep || !RESOLVED_DEP_STATUSES.has(dep.status)) {
			return `Dependency '${depId}' is not resolved (status: '${dep?.status ?? "unknown"}')`;
		}
	}
	return null;
}

export const REPORT_RESULT_EXTENSION_SOURCE = `import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
const S = Type.Object({
  whatWasImplemented: Type.String(),
  whatWasLeftUndone: Type.String(),
  commandsRun: Type.Optional(Type.Array(Type.Object({ command: Type.String(), exitCode: Type.Number(), observation: Type.String() }))),
  testsAdded: Type.Optional(Type.Array(Type.Object({ file: Type.String(), cases: Type.Array(Type.String()) }))),
  discoveredIssues: Type.Optional(Type.Array(Type.Object({ severity: Type.Union([Type.Literal("low"),Type.Literal("medium"),Type.Literal("high")]), description: Type.String(), suggestedFix: Type.Optional(Type.String()) }))),
});
function coerceArrayField(v: unknown): unknown[] { if (Array.isArray(v)) return v; if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } } return []; }
export default function register(pi: ExtensionAPI): void {
  pi.registerTool({ name: "report_result", label: "Report Result", description: "Report your work results. You MUST call this tool when done.", parameters: S, prepareArguments(args: Record<string, unknown>) { return { ...args, commandsRun: coerceArrayField(args.commandsRun), testsAdded: coerceArrayField(args.testsAdded), discoveredIssues: coerceArrayField(args.discoveredIssues) }; }, async execute(_: string, p: typeof S._static) { return { content: [{ type: "text" as const, text: "Result reported successfully.\\nImplemented: " + p.whatWasImplemented }] }; } });
}`;

function writeReportResultExtension(runtimeDir: string): string {
	mkdirSync(runtimeDir, { recursive: true });
	const extensionPath = join(runtimeDir, "report-result-extension.ts");
	writeFileSync(extensionPath, REPORT_RESULT_EXTENSION_SOURCE, "utf8");
	return extensionPath;
}

function buildWorkerArgs(
	skillPath: string,
	contextPath: string,
	promptText: string,
	workerModel: string | undefined,
	runtimeDir: string,
): string[] {
	const extensionPath = writeReportResultExtension(runtimeDir);
	const args: string[] = ["--mode", "json", "-p", "--no-session", "--extension", extensionPath];
	if (workerModel) {
		args.push("--model", workerModel);
	}
	args.push("--skill", skillPath, "--append-system-prompt", contextPath, promptText);
	return args;
}

function spawnWorkerProcess(
	spawnFn: SpawnFn,
	command: string,
	args: string[],
	cwd: string,
	options?: { signal?: AbortSignal; timeoutMs?: number; onChunk?: (stdout: string) => void; runtimeDir?: string },
): Promise<{
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: string | null;
	timedOut: boolean;
	aborted: boolean;
}> {
	return new Promise((resolve) => {
		const proc = spawnFn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

		if (options?.runtimeDir && typeof proc.pid === "number") {
			writePidFile(options.runtimeDir, proc.pid);
		}
		let stdoutBuf = "";
		let stderrBuf = "";
		let killed = false;
		let timedOut = false;
		let aborted = false;
		let lastChunkTime = 0;
		const CHUNK_INTERVAL_MS = 3000;

		const killProc = () => {
			if (killed) return;
			killed = true;
			if (proc.kill) {
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) {
						proc.kill?.("SIGKILL");
					}
				}, SIGKILL_GRACE_MS);
			}
		};

		activeWorkerProcess = { proc, kill: killProc };

		proc.stdout?.on("data", (chunk: Buffer) => {
			stdoutBuf += chunk.toString();
			const now = Date.now();
			if (options?.onChunk && now - lastChunkTime > CHUNK_INTERVAL_MS) {
				lastChunkTime = now;
				options.onChunk(stdoutBuf);
			}
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderrBuf += chunk.toString();
		});

		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		proc.on("close", (...closeArgs: unknown[]) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (options?.runtimeDir) removePidFile(options.runtimeDir);
			activeWorkerProcess = null;
			const code = closeArgs[0] as number | null;
			const sig = closeArgs[1] as string | null;
			resolve({
				stdout: stdoutBuf,
				stderr: stderrBuf,
				exitCode: killed ? null : code,
				signal: killed ? "SIGTERM" : sig,
				timedOut,
				aborted,
			});
		});

		proc.on("error", (...errArgs: unknown[]) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (options?.runtimeDir) removePidFile(options.runtimeDir);
			activeWorkerProcess = null;
			const err = errArgs[0] as NodeJS.ErrnoException;
			resolve({
				stdout: stdoutBuf,
				stderr: stderrBuf,
				exitCode: null,
				signal: err.code ?? "EUNKNOWN",
				timedOut,
				aborted,
			});
		});

		if (options?.signal) {
			if (options.signal.aborted) {
				aborted = true;
				killProc();
			} else {
				options.signal.addEventListener(
					"abort",
					() => {
						aborted = true;
						killProc();
					},
					{ once: true },
				);
			}
		}

		if (options?.timeoutMs && options.timeoutMs > 0) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				killProc();
			}, options.timeoutMs);
		}
	});
}

function writeRunArtifacts(
	runtimeDir: string,
	stdout: string,
	stderr: string,
	result: WorkerResult,
	metadata: Record<string, unknown>,
): { stdoutPath: string; stderrPath: string; resultPath: string } {
	mkdirSync(runtimeDir, { recursive: true });
	const stdoutPath = join(runtimeDir, "stdout.log");
	const stderrPath = join(runtimeDir, "stderr.log");
	const resultPath = join(runtimeDir, "result.json");
	const metaPath = join(runtimeDir, "metadata.json");
	writeFileSync(stdoutPath, stdout, "utf8");
	writeFileSync(stderrPath, stderr, "utf8");
	writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
	writeFileSync(metaPath, JSON.stringify(metadata, null, 2), "utf8");
	return { stdoutPath, stderrPath, resultPath };
}

function updateFeatureSuccess(plan: MissionPlan, featureId: string, attempt: WorkerAttempt): MissionPlan {
	return {
		...plan,
		milestones: plan.milestones.map((m) => ({
			...m,
			features: m.features.map((f) => {
				if (f.id !== featureId) return f;
				return {
					...f,
					status: "done" as const,
					completedAt: attempt.completedAt,
					attempts: [...f.attempts, attempt],
				};
			}),
		})),
	};
}

function updateFeatureFailure(
	plan: MissionPlan,
	featureId: string,
	attempt: WorkerAttempt,
	maxRetries: number,
): MissionPlan {
	return {
		...plan,
		milestones: plan.milestones.map((m) => ({
			...m,
			features: m.features.map((f) => {
				if (f.id !== featureId) return f;
				const newAttempts = [...f.attempts, attempt];
				const failureCount = newAttempts.filter((a) => a.status === "failure").length;
				const newStatus = failureCount >= maxRetries ? ("failed" as const) : ("active" as const);
				return {
					...f,
					status: newStatus,
					attempts: newAttempts,
				};
			}),
		})),
	};
}

function setFeatureActive(plan: MissionPlan, featureId: string): MissionPlan {
	return {
		...plan,
		milestones: plan.milestones.map((m) => ({
			...m,
			features: m.features.map((f) => {
				if (f.id !== featureId) return f;
				return { ...f, status: "active" as const, startedAt: f.startedAt ?? nowISO() };
			}),
		})),
	};
}

function readAgentsMd(projectDir: string): string | undefined {
	const agentsPath = join(projectDir, "AGENTS.md");
	try {
		return readFileSync(agentsPath, "utf8");
	} catch {
		return undefined;
	}
}

interface SelfCorrectionResult {
	fixFeatureId?: string;
	fixFeatureName?: string;
	summary: string;
}

function performSelfCorrection(
	basePath: string,
	plan: MissionPlan,
	state: MissionState,
	feature: Feature,
	result: WorkerResult,
	autonomy: "low" | "medium" | "high",
	maxRetries: number,
): { updatedPlan: MissionPlan; updatedState: MissionState; correction: SelfCorrectionResult } {
	const handoff = result.handoff;
	if (!handoff) {
		return { updatedPlan: plan, updatedState: state, correction: { summary: "" } };
	}

	const hasUndone = handoff.whatWasLeftUndone.trim().length > 0;
	const highSeverityIssues = handoff.discoveredIssues.filter((i) => i.severity === "high");

	if (!hasUndone && highSeverityIssues.length === 0) {
		return { updatedPlan: plan, updatedState: state, correction: { summary: "" } };
	}

	const reasons: string[] = [];
	if (hasUndone) reasons.push(`Undone: ${handoff.whatWasLeftUndone}`);
	for (const issue of highSeverityIssues) reasons.push(`High-severity: ${issue.description}`);
	const reasonText = reasons.join("; ");

	if (autonomy === "low") {
		return {
			updatedPlan: plan,
			updatedState: state,
			correction: {
				summary: `Self-correction: issues found but autonomy is low — please review. ${reasonText}`,
			},
		};
	}

	const failureCount =
		feature.attempts.filter((a) => a.status === "failure").length + (result.status === "failure" ? 1 : 0);
	if (failureCount >= maxRetries) {
		return { updatedPlan: plan, updatedState: state, correction: { summary: "" } };
	}

	const milestone = findMilestoneForFeature(plan, feature.id);
	if (!milestone) {
		return { updatedPlan: plan, updatedState: state, correction: { summary: "" } };
	}

	const descriptionParts: string[] = [];
	if (hasUndone) descriptionParts.push(handoff.whatWasLeftUndone);
	for (const issue of highSeverityIssues) descriptionParts.push(issue.description);
	const fixName = `fix-${feature.name}`;

	const {
		featureId: fixFeatureId,
		updatedPlan,
		updatedState,
	} = addFixFeatureToPlan(basePath, plan, state, {
		milestoneId: milestone.id,
		name: fixName,
		description: `Self-correction for '${feature.name}': ${descriptionParts.join(". ")}`,
		acceptanceCriteria:
			highSeverityIssues.length > 0
				? highSeverityIssues.map((i) => i.suggestedFix ?? `Fix: ${i.description}`)
				: [`Complete: ${handoff.whatWasLeftUndone}`],
		relevantFiles: feature.relevantFiles,
		sourceKind: "worker-failure",
		sourceFeatureId: feature.id,
	});

	return {
		updatedPlan,
		updatedState,
		correction: {
			fixFeatureId,
			fixFeatureName: fixName,
			summary: `Self-correction: auto-created fix feature '${fixName}' (${fixFeatureId}). ${reasonText}`,
		},
	};
}

const DEFAULT_SETUP_TIMEOUT_MS = 60_000;

function runSetupCommand(command: string, cwd: string, timeoutMs: number): Promise<SetupCommandResult> {
	return new Promise((resolve) => {
		const proc = spawn("sh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const timeoutId = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGTERM");
		}, timeoutMs);
		proc.on("close", (code) => {
			clearTimeout(timeoutId);
			resolve({ success: !timedOut && code === 0, command, exitCode: timedOut ? null : code, stdout, stderr });
		});
		proc.on("error", (err) => {
			clearTimeout(timeoutId);
			resolve({ success: false, command, exitCode: null, stdout, stderr: err.message });
		});
	});
}

interface EnvironmentSetupResult {
	ran: boolean;
	success: boolean;
	error?: string;
}

async function runEnvironmentSetup(
	basePath: string,
	projectDir: string,
	state: MissionState,
	runSetup: RunSetupCommandFn,
): Promise<EnvironmentSetupResult> {
	if (state.environmentSetupComplete) {
		return { ran: false, success: true };
	}
	const env = loadEnvironment(basePath);
	if (!env?.setupCommands || env.setupCommands.length === 0) {
		return { ran: false, success: true };
	}
	for (const cmd of env.setupCommands) {
		const result = await runSetup(cmd, projectDir, DEFAULT_SETUP_TIMEOUT_MS);
		if (!result.success) {
			return {
				ran: true,
				success: false,
				error: `Environment setup command '${cmd}' failed (exit code ${result.exitCode}): ${result.stderr || result.stdout}`,
			};
		}
	}
	return { ran: true, success: true };
}

export function registerSpawnWorkerTool(pi: ExtensionAPI, deps: Deps): void {
	const spawnFn: SpawnFn = deps._spawnOverride ?? (spawn as SpawnFn);

	pi.registerTool({
		name: "spawn_worker",
		label: "Spawn Worker",
		description:
			"Spawn an isolated worker process to implement a single feature. Blocks until the worker completes. Reads the feature from plan.json, generates a skill and prompt, spawns pi, captures output, and returns a WorkerResult.",
		promptSnippet: "Spawn an isolated worker for a single feature. Blocks until complete.",
		promptGuidelines: [
			"Never read implementation files yourself \u2014 delegate all coding to workers via spawn_worker.",
			"If a worker fails, use create_fix_feature instead of debugging yourself.",
		],
		parameters: Type.Object({
			featureId: Type.String({ description: "ID of the feature to implement" }),
			additionalContext: Type.Optional(Type.String({ description: "Extra context or guidance for retry attempts" })),
		}),
		// why: pi Theme uses branded ThemeColor types; we accept `any` at this API boundary
		renderCall(args: any, theme: any) {
			const featureName = args.featureId || "...";
			const text = theme.fg("toolTitle", theme.bold("spawn_worker ")) + theme.fg("accent", featureName);
			return new Text(text, 0, 0);
		},
		renderResult(result: any, { expanded }: any, theme: any) {
			const text = result.content?.[0];
			const output = text?.type === "text" ? text.text : "(no output)";
			const firstLine = output.split("\n")[0];
			const icon = output.includes("succeeded") ? theme.fg("success", "\u2713") : theme.fg("error", "\u2717");
			if (!expanded) {
				return new Text(`${icon} ${firstLine}`, 0, 0);
			}
			return new Text(`${icon} ${output}`, 0, 0);
		},
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			let state = loadState(deps.basePath);
			if (!state) {
				return { content: [{ type: "text", text: "Error: no active mission state." }], details: {} };
			}

			if (state.status !== "approved" && state.status !== "executing") {
				return {
					content: [
						{
							type: "text",
							text: `Error: spawn_worker requires 'approved' or 'executing' state. Current: '${state.status}'.`,
						},
					],
					details: {},
				};
			}

			if (state.currentFeatureId) {
				return {
					content: [
						{
							type: "text",
							text: `Error: concurrent execution rejected. Worker '${state.currentFeatureId}' is already running.`,
						},
					],
					details: {},
				};
			}

			const plan = loadPlan(deps.basePath);
			if (!plan) {
				return { content: [{ type: "text", text: "Error: no plan found." }], details: {} };
			}

			const feature = findFeature(plan, params.featureId);
			if (!feature) {
				return {
					content: [{ type: "text", text: `Error: feature '${params.featureId}' not found in plan.` }],
					details: {},
				};
			}

			if (TERMINAL_FEATURE_STATUSES.has(feature.status)) {
				return {
					content: [
						{
							type: "text",
							text: `Error: feature '${params.featureId}' has status '${feature.status}' and cannot be spawned.`,
						},
					],
					details: {},
				};
			}

			const allFeatures = findAllFeatures(plan);
			const depError = checkDependencies(feature, allFeatures);
			if (depError) {
				return { content: [{ type: "text", text: `Error: ${depError}` }], details: {} };
			}

			const config = loadConfig(deps.basePath);
			const maxRetries = config.maxRetries ?? 3;
			const workerModel = resolveModel("worker", config, plan, feature.estimatedComplexity);

			const availableModels =
				typeof deps.availableModels === "function" ? deps.availableModels() : deps.availableModels;
			if (workerModel && availableModels && availableModels.length > 0) {
				if (!availableModels.includes(workerModel)) {
					return {
						content: [
							{
								type: "text",
								text: `Error: worker model '${workerModel}' is not available (no API key or provider not configured). Available models: ${availableModels.slice(0, 5).join(", ")}${availableModels.length > 5 ? "..." : ""}. Change the worker model in Mission Control (Ctrl+Shift+M) or configure the provider.`,
							},
						],
						details: {},
					};
				}
			}

			const runSetup = deps._runSetupCommandOverride ?? runSetupCommand;
			const setupResult = await runEnvironmentSetup(deps.basePath, deps.projectDir, state, runSetup);
			if (!setupResult.success) {
				return {
					content: [{ type: "text", text: `Error: environment setup failed. ${setupResult.error}` }],
					details: {},
				};
			}
			if (setupResult.ran) {
				state = { ...state, environmentSetupComplete: true };
				saveState(deps.basePath, state);
			}

			const attemptNumber = feature.attempts.length + 1;
			const runtimeDir = join(deps.basePath, "runtime", feature.id, String(attemptNumber));

			const agentsMd = readAgentsMd(deps.projectDir);
			const completedFeatures = collectCompletedFeatures(plan, feature.id);
			const skill = generateWorkerSkill(feature, agentsMd, config.promptingMode);
			const prompt = generateWorkerPrompt(feature, params.additionalContext);
			const context = generateWorkerContext(agentsMd, completedFeatures, deps.basePath, deps.projectDir);
			writeWorkerFiles(deps.basePath, feature.id, attemptNumber, { skill, prompt, context });

			const skillPath = join(runtimeDir, "worker-skill.md");
			const contextPath = join(runtimeDir, "worker-context.md");

			const workerArgs = buildWorkerArgs(skillPath, contextPath, prompt, workerModel, runtimeDir);
			const { command, commandArgs } = getPiInvocation(workerArgs);

			let activeState = state;
			if (state.status === "approved") {
				activeState = transitionState(state, "executing");
			}

			let updatedPlan = setFeatureActive(plan, feature.id);
			({ plan: updatedPlan, state: activeState } = autoStartMilestone(updatedPlan, activeState, feature.id));
			activeState = {
				...activeState,
				currentFeatureId: feature.id,
				progressLog: [
					...activeState.progressLog,
					{ timestamp: nowISO(), type: "worker_spawn", detail: `Spawning worker for feature '${feature.name}'` },
				],
			};
			saveState(deps.basePath, activeState);
			savePlan(deps.basePath, updatedPlan);
			deps.updateWidget(activeState, updatedPlan);

			const savedThinkingLevel = deps.getThinkingLevel ? deps.getThinkingLevel() : undefined;

			const uiCtx = ctx as { ui?: { setWorkingMessage?: (msg?: string) => void } } | undefined;
			uiCtx?.ui?.setWorkingMessage?.(
				`Spawning worker: ${feature.name} (${activeState.totalFeaturesCompleted + 1}/${allFeatures.size})`,
			);

			const refreshFn = deps.refreshWidget ?? deps.updateWidget;
			const widgetInterval = setInterval(() => {
				const currentState = loadState(deps.basePath);
				const currentPlan = loadPlan(deps.basePath);
				if (currentState) refreshFn(currentState, currentPlan ?? undefined);
			}, 2000);

			const timeoutMs = config.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
			const startTime = Date.now();

			const onChunk = onUpdate
				? (stdout: string) => {
						const elapsed = Math.round((Date.now() - startTime) / 1000);
						const lines = stdout.split("\n").filter((l: string) => l.trim());
						onUpdate({
							content: [{ type: "text", text: `Worker running for ${elapsed}s (${lines.length} events)...` }],
							details: {},
						});
					}
				: undefined;

			const procResult = await spawnWorkerProcess(spawnFn, command, commandArgs, deps.projectDir, {
				signal: signal ?? undefined,
				timeoutMs,
				onChunk,
				runtimeDir,
			});

			clearInterval(widgetInterval);
			uiCtx?.ui?.setWorkingMessage?.();

			if (savedThinkingLevel !== undefined && deps.setThinkingLevel) {
				deps.setThinkingLevel(savedThinkingLevel);
			}

			if (procResult.timedOut) {
				activeState = {
					...activeState,
					currentFeatureId: undefined,
					totalFeaturesFailed: activeState.totalFeaturesFailed + 1,
					progressLog: [
						...activeState.progressLog,
						{
							timestamp: nowISO(),
							type: "worker_complete" as const,
							detail: `Worker timed out for '${feature.name}' after ${timeoutMs}ms`,
						},
					],
				};
				const attempt: WorkerAttempt = {
					attemptNumber,
					startedAt: new Date(startTime).toISOString(),
					completedAt: nowISO(),
					resultPath: join(runtimeDir, "result.json"),
					stdoutPath: join(runtimeDir, "stdout.log"),
					stderrPath: join(runtimeDir, "stderr.log"),
					durationMs: Date.now() - startTime,
					model: workerModel,
					status: "failure",
				};
				updatedPlan = updateFeatureFailure(updatedPlan, feature.id, attempt, maxRetries);
				saveState(deps.basePath, activeState);
				savePlan(deps.basePath, updatedPlan);
				deps.updateWidget(activeState, updatedPlan);
				return {
					content: [
						{
							type: "text",
							text: `Worker timed out for feature '${feature.name}' after ${timeoutMs}ms.`,
						},
					],
					details: {},
				};
			}

			if (procResult.aborted) {
				activeState = {
					...activeState,
					currentFeatureId: undefined,
					progressLog: [
						...activeState.progressLog,
						{
							timestamp: nowISO(),
							type: "worker_complete" as const,
							detail: `Worker aborted for '${feature.name}'`,
						},
					],
				};
				saveState(deps.basePath, activeState);
				deps.updateWidget(activeState, updatedPlan);
				return {
					content: [
						{
							type: "text",
							text: `Worker aborted for feature '${feature.name}'.`,
						},
					],
					details: {},
				};
			}

			if (procResult.signal === "ENOENT") {
				activeState = {
					...activeState,
					currentFeatureId: undefined,
				};
				saveState(deps.basePath, activeState);
				deps.updateWidget(activeState, updatedPlan);
				return {
					content: [
						{
							type: "text",
							text: `Error: pi binary not found. Cannot spawn worker. Command: '${command}'.`,
						},
					],
					details: {},
				};
			}

			let result = synthesizeWorkerResult(
				procResult.stdout,
				procResult.stderr,
				procResult.exitCode,
				procResult.signal,
				startTime,
				{ projectDir: deps.projectDir },
			);

			const completedAt = nowISO();
			const attempt: WorkerAttempt = {
				attemptNumber,
				startedAt: new Date(startTime).toISOString(),
				completedAt,
				exitCode: procResult.exitCode ?? undefined,
				resultPath: join(runtimeDir, "result.json"),
				stdoutPath: join(runtimeDir, "stdout.log"),
				stderrPath: join(runtimeDir, "stderr.log"),
				durationMs: result.metrics.durationMs,
				model: workerModel,
				status: result.status === "success" ? "success" : "failure",
			};

			const metadata = {
				featureId: feature.id,
				attemptNumber,
				model: workerModel,
				startedAt: attempt.startedAt,
				completedAt,
				exitCode: procResult.exitCode,
			};

			writeRunArtifacts(runtimeDir, procResult.stdout, procResult.stderr, result, metadata);

			const spawnAndLearn = resolveSpawnAndLearn(config);
			if (
				learnFromResult(deps.basePath, result, spawnAndLearn, {
					name: feature.name,
					description: feature.description,
				}).learned
			) {
				clearProtocolCache();
			}

			if (result.status === "success") {
				const validatorResult = await runValidator(feature, result, {
					basePath: deps.basePath,
					projectDir: deps.projectDir,
					spawnFn: spawnFn as SpawnFn,
					plan: updatedPlan,
					config,
					signal: signal ?? undefined,
				});
				if (validatorResult.verdict !== "pass") {
					result = {
						...result,
						status: "failure",
						summary: `${result.summary}\n\nValidator: ${validatorResult.feedback}`,
						error: {
							kind: "validation",
							message: `Validator: ${validatorResult.verdict}`,
							details: validatorResult.feedback,
						},
					};
				}
			}

			if (result.status === "success") {
				updatedPlan = updateFeatureSuccess(updatedPlan, feature.id, attempt);
				activeState = {
					...activeState,
					currentFeatureId: undefined,
					totalFeaturesCompleted: activeState.totalFeaturesCompleted + 1,
					progressLog: [
						...activeState.progressLog,
						{
							timestamp: nowISO(),
							type: "worker_complete" as const,
							detail: `Worker completed successfully for '${feature.name}'`,
						},
					],
				};
			} else {
				updatedPlan = updateFeatureFailure(updatedPlan, feature.id, attempt, maxRetries);
				activeState = {
					...activeState,
					currentFeatureId: undefined,
					totalFeaturesFailed: activeState.totalFeaturesFailed + 1,
					progressLog: [
						...activeState.progressLog,
						{
							timestamp: nowISO(),
							type: "worker_complete" as const,
							detail: `Worker failed for '${feature.name}' (attempt ${attemptNumber})`,
						},
					],
				};
			}

			if (result.status === "success") {
				const snapshot = activeState.gitSnapshot;
				const autoCommit = snapshot?.autoCommitEnabled ?? false;
				const gitCheck = deps._isGitAvailableOverride ?? isGitAvailable;
				if (autoCommit && gitCheck(deps.projectDir)) {
					const getChanged = deps._getChangedFilesOverride ?? getChangedFiles;
					const doCommit = deps._stageAndCommitOverride ?? stageAndCommit;
					const changedFiles = getChanged(deps.projectDir, snapshot?.headCommit);
					if (changedFiles.length > 0) {
						const isFix = feature.fixOrigin !== undefined;
						const msg = isFix ? `mission: fix ${feature.name}` : `mission: ${feature.name}`;
						try {
							const sha = doCommit(deps.projectDir, changedFiles, msg);
							activeState = {
								...activeState,
								gitSnapshot: { ...snapshot!, headCommit: sha },
								progressLog: [
									...activeState.progressLog,
									{
										timestamp: nowISO(),
										type: "commit_created" as const,
										detail: `Auto-committed ${changedFiles.length} file(s) for '${feature.name}': ${sha}`,
									},
								],
							};
						} catch {
							// why: auto-commit is best-effort — don't fail the feature if git commit fails
						}
					}
				}
			}

			const autonomy = config.autonomy ?? "medium";
			const {
				updatedPlan: correctedPlan,
				updatedState: correctedState,
				correction,
			} = performSelfCorrection(deps.basePath, updatedPlan, activeState, feature, result, autonomy, maxRetries);

			if (correction.fixFeatureId) {
				updatedPlan = correctedPlan;
				activeState = correctedState;
			}

			({ plan: updatedPlan, state: activeState } = autoCompleteMilestone(updatedPlan, activeState, feature.id));

			saveState(deps.basePath, activeState);
			savePlan(deps.basePath, updatedPlan);
			deps.updateWidget(activeState, updatedPlan);

			const statusText = result.status === "success" ? "succeeded" : `failed (attempt ${attemptNumber})`;
			const nextPending = findNextPending(updatedPlan, feature.id);
			const progressDone = activeState.totalFeaturesCompleted + activeState.totalFeaturesSkipped;
			let completionHint: string;
			if (result.status !== "success") {
				completionHint = nextPending
					? `Next: ${nextPending.name}. Action: call create_fix_feature for this failure, then spawn_worker.`
					: "No pending features remain. Call create_fix_feature to address this failure.";
			} else {
				completionHint = nextPending
					? `Next: ${nextPending.name}.`
					: "ALL FEATURES DONE. Call complete_mission now with a summary of what was accomplished.";
			}
			const correctionText = correction.summary ? `\n\n${correction.summary}` : "";
			return {
				content: [
					{
						type: "text",
						text: `Worker ${statusText} for feature '${feature.name}'.\nProgress: ${progressDone}/${allFeatures.size} features done. ${completionHint}\n\n${result.summary}${correctionText}`,
					},
				],
				details: {},
			};
		},
	});
}
