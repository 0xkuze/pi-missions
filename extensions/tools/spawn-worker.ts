import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolveModel } from "../config.js";
import {
	generateWorkerContext,
	generateWorkerPrompt,
	generateWorkerSkill,
	writeWorkerFiles,
} from "../orchestrator/worker-prompt.js";
import { loadConfig, loadPlan, loadState, savePlan, saveState } from "../state/manager.js";
import { transitionState } from "../state/transitions.js";
import type { Feature, MissionPlan, MissionState, WorkerAttempt, WorkerResult } from "../types.js";
import { nowISO } from "../utils.js";
import { synthesizeWorkerResult } from "./result-synthesis.js";

interface StreamLike {
	on(event: string, handler: (data: Buffer) => void): unknown;
}

interface ProcLike {
	stdout: StreamLike | null;
	stderr: StreamLike | null;
	on(event: string, handler: (...args: unknown[]) => void): unknown;
}

type SpawnFn = (command: string, args: string[], options: Record<string, unknown>) => ProcLike;

interface Deps {
	basePath: string;
	projectDir: string;
	updateWidget: (state: MissionState, plan?: MissionPlan) => void;
	_spawnOverride?: SpawnFn;
}

const TERMINAL_FEATURE_STATUSES = new Set(["blocked", "skipped", "done"]);

function findFeature(plan: MissionPlan, featureId: string): Feature | null {
	for (const milestone of plan.milestones) {
		for (const feature of milestone.features) {
			if (feature.id === featureId) return feature;
		}
	}
	return null;
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

function checkDependencies(feature: Feature, allFeatures: Map<string, Feature>): string | null {
	for (const depId of feature.dependencies) {
		const dep = allFeatures.get(depId);
		if (!dep || dep.status !== "done") {
			return `Dependency '${depId}' is not done (status: '${dep?.status ?? "unknown"}')`;
		}
	}
	return null;
}

function getPiInvocation(args: string[]): { command: string; commandArgs: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return { command: process.execPath, commandArgs: [currentScript, ...args] };
	}
	const execName = basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, commandArgs: args };
	}
	return { command: "pi", commandArgs: args };
}

function buildWorkerArgs(
	skillPath: string,
	contextPath: string,
	promptText: string,
	workerModel: string | undefined,
): string[] {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
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
): Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: string | null }> {
	return new Promise((resolve) => {
		const proc = spawnFn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stdoutBuf = "";
		let stderrBuf = "";

		proc.stdout?.on("data", (chunk: Buffer) => {
			stdoutBuf += chunk.toString();
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderrBuf += chunk.toString();
		});

		proc.on("close", (...args: unknown[]) => {
			const code = args[0] as number | null;
			const sig = args[1] as string | null;
			resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: code, signal: sig });
		});

		proc.on("error", (...errArgs: unknown[]) => {
			const err = errArgs[0] as NodeJS.ErrnoException;
			resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: null, signal: err.code ?? "EUNKNOWN" });
		});
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

export function registerSpawnWorkerTool(pi: ExtensionAPI, deps: Deps): void {
	const spawnFn: SpawnFn = deps._spawnOverride ?? (spawn as SpawnFn);

	pi.registerTool({
		name: "spawn_worker",
		label: "Spawn Worker",
		description:
			"Spawn an isolated worker process to implement a single feature. Blocks until the worker completes. Reads the feature from plan.json, generates a skill and prompt, spawns pi, captures output, and returns a WorkerResult.",
		parameters: Type.Object({
			featureId: Type.String({ description: "ID of the feature to implement" }),
			additionalContext: Type.Optional(Type.String({ description: "Extra context or guidance for retry attempts" })),
		}),
		async execute(_toolCallId, params) {
			const state = loadState(deps.basePath);
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
			const workerModel = resolveModel("worker", config, plan);
			const attemptNumber = feature.attempts.length + 1;
			const runtimeDir = join(deps.basePath, "runtime", feature.id, String(attemptNumber));

			const agentsMd = readAgentsMd(deps.projectDir);
			const skill = generateWorkerSkill(feature, agentsMd);
			const prompt = generateWorkerPrompt(feature, params.additionalContext);
			const context = generateWorkerContext(agentsMd);
			writeWorkerFiles(deps.basePath, feature.id, attemptNumber, { skill, prompt, context });

			const skillPath = join(runtimeDir, "worker-skill.md");
			const contextPath = join(runtimeDir, "worker-context.md");

			const workerArgs = buildWorkerArgs(skillPath, contextPath, prompt, workerModel);
			const { command, commandArgs } = getPiInvocation(workerArgs);

			let activeState = state;
			if (state.status === "approved") {
				activeState = transitionState(state, "executing");
			}

			let updatedPlan = setFeatureActive(plan, feature.id);
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

			const startTime = Date.now();
			const procResult = await spawnWorkerProcess(spawnFn, command, commandArgs, deps.projectDir);

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

			const result = synthesizeWorkerResult(
				procResult.stdout,
				procResult.stderr,
				procResult.exitCode,
				procResult.signal,
				startTime,
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

			saveState(deps.basePath, activeState);
			savePlan(deps.basePath, updatedPlan);
			deps.updateWidget(activeState, updatedPlan);

			const statusText = result.status === "success" ? "succeeded" : `failed (attempt ${attemptNumber})`;
			return {
				content: [
					{
						type: "text",
						text: `Worker ${statusText} for feature '${feature.name}'.\n\n${result.summary}`,
					},
				],
				details: {},
			};
		},
	});
}
