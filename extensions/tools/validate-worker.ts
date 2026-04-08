import { join } from "node:path";
import { resolveModel } from "../config.js";
import {
	generateValidatorPrompt,
	generateValidatorSkill,
	writeValidatorFiles,
} from "../orchestrator/validator-prompt.js";
import type { ProcLike, SpawnFn } from "../process-types.js";
import { loadConfig } from "../state/manager.js";
import type { Feature, MissionConfig, MissionPlan, WorkerResult } from "../types.js";
import { getPiInvocation } from "../utils.js";

type ValidatorVerdict = "pass" | "fix" | "reject";

interface ValidatorResult {
	verdict: ValidatorVerdict;
	feedback: string;
	raw: string;
}

const DEFAULT_VALIDATOR_TIMEOUT_MS = 300_000;

export function parseValidatorVerdict(stdout: string, strictness?: "strict" | "lenient"): ValidatorResult {
	const events: Array<Record<string, unknown>> = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (parsed !== null && typeof parsed === "object") {
				events.push(parsed as Record<string, unknown>);
			}
		} catch {
			// skip
		}
	}

	let lastAssistantText = "";
	for (const event of events) {
		if (event.type !== "message_end") continue;
		const message = event.message as Record<string, unknown> | undefined;
		if (message?.role !== "assistant") continue;
		const content = message.content as Array<Record<string, unknown>> | undefined;
		if (!Array.isArray(content)) continue;
		const textParts = content
			.filter((block) => block.type === "text" && typeof block.text === "string")
			.map((block) => block.text as string);
		if (textParts.length > 0) {
			lastAssistantText = textParts.join("\n");
		}
	}

	return parseVerdictFromText(lastAssistantText, strictness);
}

export function parseVerdictFromText(text: string, strictness?: "strict" | "lenient"): ValidatorResult {
	const effectiveStrictness = strictness ?? "lenient";
	const verdictMatch = /VERDICT:\s*(PASS|FIX|REJECT)/i.exec(text);
	const feedbackMatch = /FEEDBACK:\s*(.+)/is.exec(text);

	if (!verdictMatch) {
		if (effectiveStrictness === "strict") {
			return {
				verdict: "reject",
				feedback: "Validator did not produce a structured verdict — no VERDICT line found.",
				raw: text,
			};
		}
		return {
			verdict: "pass",
			feedback: "Validator did not produce a structured verdict — assuming pass.",
			raw: text,
		};
	}

	const verdict = verdictMatch[1].toLowerCase() as ValidatorVerdict;
	const feedback = feedbackMatch ? feedbackMatch[1].trim() : "No feedback provided.";

	return { verdict, feedback, raw: text };
}

interface RunValidatorDeps {
	basePath: string;
	projectDir: string;
	spawnFn: SpawnFn;
	plan: MissionPlan;
	config?: MissionConfig;
	signal?: AbortSignal;
}

export async function runValidator(
	feature: Feature,
	workerResult: WorkerResult,
	deps: RunValidatorDeps,
): Promise<ValidatorResult> {
	const config = deps.config ?? loadConfig(deps.basePath);
	const validatorModel = resolveModel("validator", config, deps.plan);

	if (!validatorModel) {
		return { verdict: "pass", feedback: "No validator model configured — skipping review.", raw: "" };
	}

	const attemptNumber = feature.attempts.length + 1;
	const skill = generateValidatorSkill(feature);
	const prompt = generateValidatorPrompt(feature, workerResult.summary, workerResult.filesChanged);
	writeValidatorFiles(deps.basePath, feature.id, attemptNumber, { skill, prompt });

	const runtimeDir = join(deps.basePath, "runtime", feature.id, String(attemptNumber));
	const skillPath = join(runtimeDir, "validator-skill.md");

	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	args.push("--model", validatorModel);
	args.push("--skill", skillPath, prompt);

	const { command, commandArgs } = getPiInvocation(args);
	const timeoutMs = config.workerTimeoutMs ?? DEFAULT_VALIDATOR_TIMEOUT_MS;

	const procResult = await spawnValidatorProcess(deps.spawnFn, command, commandArgs, deps.projectDir, {
		signal: deps.signal,
		timeoutMs,
	});

	const strictness = config.validatorStrictness ?? "lenient";

	if (procResult.timedOut || procResult.aborted) {
		if (strictness === "strict") {
			return {
				verdict: "reject",
				feedback: `Validator ${procResult.timedOut ? "timed out" : "was aborted"} — no verdict produced.`,
				raw: "",
			};
		}
		return { verdict: "pass", feedback: "Validator timed out or was aborted — assuming pass.", raw: "" };
	}

	return parseValidatorVerdict(procResult.stdout, strictness);
}

function spawnValidatorProcess(
	spawnFn: SpawnFn,
	command: string,
	args: string[],
	cwd: string,
	options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; aborted: boolean }> {
	return new Promise((resolve) => {
		const proc = spawnFn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

		let stdoutBuf = "";
		let stderrBuf = "";
		let killed = false;
		let timedOut = false;
		let aborted = false;

		const killProc = () => {
			if (killed) return;
			killed = true;
			if (proc.kill) {
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill?.("SIGKILL");
				}, 5000);
			}
		};

		proc.stdout?.on("data", (chunk: Buffer) => {
			stdoutBuf += chunk.toString();
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderrBuf += chunk.toString();
		});

		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		proc.on("close", (...closeArgs: unknown[]) => {
			if (timeoutId) clearTimeout(timeoutId);
			const code = closeArgs[0] as number | null;
			resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: killed ? null : code, timedOut, aborted });
		});

		proc.on("error", () => {
			if (timeoutId) clearTimeout(timeoutId);
			resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: null, timedOut, aborted });
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
