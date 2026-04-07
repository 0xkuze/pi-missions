#!/usr/bin/env bun
/**
 * Caveman mode eval runner.
 *
 * Spawns real pi processes with different prompting modes and measures
 * token usage, cost, response length, and quality across standardized prompts.
 *
 * Usage:
 *   bun benchmarks/caveman-eval.ts [--model <model>] [--trials <n>]
 *
 * Requires: pi CLI in PATH, valid API key configured.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCavemanOutputRule } from "../extensions/orchestrator/caveman-rules.js";

const RESULTS_DIR = join(import.meta.dir, "results");

interface EvalPrompt {
	id: string;
	category: "explanation" | "planning" | "coding" | "analysis";
	prompt: string;
	systemAppend?: string;
}

const EVAL_PROMPTS: EvalPrompt[] = [
	{
		id: "explain-rerender",
		category: "explanation",
		prompt: "Why does a React component re-render when you pass an inline object as a prop?",
	},
	{
		id: "explain-connection-pool",
		category: "explanation",
		prompt: "Explain database connection pooling in 2-3 sentences. When should you use it?",
	},
	{
		id: "plan-todo-api",
		category: "planning",
		prompt:
			"I need to build a REST API for a todo app with Node.js. List the endpoints I need and the data model. Keep it concise.",
	},
	{
		id: "analyze-bug",
		category: "analysis",
		prompt:
			'This code has a bug: `if (user.role = "admin") { grantAccess(); }`. What is wrong and what is the fix?',
	},
	{
		id: "code-fizzbuzz",
		category: "coding",
		prompt: "Write a fizzbuzz function in TypeScript. No explanation needed, just the code.",
	},
	{
		id: "explain-git-rebase",
		category: "explanation",
		prompt: "What is the difference between git rebase and git merge? When would you use each?",
	},
];

type Mode = "default" | "caveman" | "caveman-full";

interface RunResult {
	mode: Mode;
	promptId: string;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
	totalCost: number;
	responseText: string;
	responseChars: number;
	responseWords: number;
	durationMs: number;
	error?: string;
}

interface TurnEndMessage {
	type: "turn_end";
	message: {
		content: Array<{ type: string; text?: string; thinking?: string }>;
		usage: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			cost: { total: number };
		};
	};
}

function buildSystemAppend(mode: Mode): string {
	const rule = getCavemanOutputRule(mode);
	if (!rule) return "";
	return rule;
}

function runPi(
	prompt: string,
	model: string,
	systemAppend: string,
): Promise<{ output: string; durationMs: number }> {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const args = ["--mode", "json", "-p", "--no-session", "--no-tools", "--model", model];

		let tmpFile: string | null = null;
		if (systemAppend) {
			tmpFile = join(tmpdir(), `caveman-eval-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
			writeFileSync(tmpFile, systemAppend, "utf8");
			args.push("--append-system-prompt", tmpFile);
		}
		args.push(prompt);

		const proc = spawn("pi", args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		const timeout = setTimeout(() => {
			proc.kill("SIGKILL");
			if (tmpFile) try { unlinkSync(tmpFile); } catch {}
			reject(new Error("pi process timed out after 60s"));
		}, 60_000);

		proc.on("close", (code) => {
			clearTimeout(timeout);
			if (tmpFile) try { unlinkSync(tmpFile); } catch {}
			const durationMs = Date.now() - start;
			if (code !== 0 && !stdout.includes("turn_end")) {
				reject(new Error(`pi exited with code ${code}: ${stderr.slice(0, 500)}`));
				return;
			}
			resolve({ output: stdout, durationMs });
		});

		proc.on("error", (err) => {
			clearTimeout(timeout);
			if (tmpFile) try { unlinkSync(tmpFile); } catch {}
			reject(err);
		});
	});
}

function parseTurnEnd(jsonLines: string): TurnEndMessage | null {
	for (const line of jsonLines.split("\n").reverse()) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line);
			if (parsed.type === "turn_end") return parsed as TurnEndMessage;
		} catch {
			continue;
		}
	}
	return null;
}

function extractResponseText(turnEnd: TurnEndMessage): string {
	return turnEnd.message.content
		.filter((c) => c.type === "text" && c.text)
		.map((c) => c.text!)
		.join("");
}

async function runSingle(prompt: EvalPrompt, mode: Mode, model: string): Promise<RunResult> {
	const systemAppend = buildSystemAppend(mode);
	try {
		const { output, durationMs } = await runPi(prompt.prompt, model, systemAppend);
		const turnEnd = parseTurnEnd(output);

		if (!turnEnd) {
			return {
				mode,
				promptId: prompt.id,
				inputTokens: 0,
				outputTokens: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalCost: 0,
				responseText: "",
				responseChars: 0,
				responseWords: 0,
				durationMs,
				error: "No turn_end found in output",
			};
		}

		const text = extractResponseText(turnEnd);
		const usage = turnEnd.message.usage;

		return {
			mode,
			promptId: prompt.id,
			inputTokens: usage.input,
			outputTokens: usage.output,
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			totalCost: usage.cost.total,
			responseText: text,
			responseChars: text.length,
			responseWords: text.split(/\s+/).filter(Boolean).length,
			durationMs,
		};
	} catch (err) {
		return {
			mode,
			promptId: prompt.id,
			inputTokens: 0,
			outputTokens: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalCost: 0,
			responseText: "",
			responseChars: 0,
			responseWords: 0,
			durationMs: 0,
			error: (err as Error).message,
		};
	}
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface PromptSummary {
	promptId: string;
	category: string;
	modes: Record<
		Mode,
		{
			medianInputTokens: number;
			medianOutputTokens: number;
			medianCacheWrite: number;
			medianCost: number;
			medianDurationMs: number;
			medianWords: number;
			sampleResponse: string;
			errors: number;
		}
	>;
}

function summarize(results: RunResult[], prompts: EvalPrompt[]): PromptSummary[] {
	const summaries: PromptSummary[] = [];

	for (const prompt of prompts) {
		const modes: PromptSummary["modes"] = {} as PromptSummary["modes"];

		for (const mode of ["default", "caveman", "caveman-full"] as Mode[]) {
			const runs = results.filter((r) => r.promptId === prompt.id && r.mode === mode && !r.error);
			const errors = results.filter((r) => r.promptId === prompt.id && r.mode === mode && r.error).length;

			modes[mode] = {
				medianInputTokens: median(runs.map((r) => r.inputTokens)),
				medianOutputTokens: median(runs.map((r) => r.outputTokens)),
				medianCacheWrite: median(runs.map((r) => r.cacheWrite)),
				medianCost: median(runs.map((r) => r.totalCost)),
				medianDurationMs: median(runs.map((r) => r.durationMs)),
				medianWords: median(runs.map((r) => r.responseWords)),
				sampleResponse: runs[0]?.responseText.slice(0, 200) ?? "(no response)",
				errors,
			};
		}

		summaries.push({ promptId: prompt.id, category: prompt.category, modes });
	}

	return summaries;
}

function printTable(summaries: PromptSummary[]): void {
	console.log("\n" + "=".repeat(100));
	console.log("CAVEMAN MODE EVAL RESULTS");
	console.log("=".repeat(100));

	console.log(
		"\n%-25s %-12s %8s %8s %8s %8s %8s %8s".replace(/%(\d+)s/g, (_, w) => `%${w}s`),
	);

	const header = [
		"Prompt".padEnd(25),
		"Mode".padEnd(14),
		"In-Tok".padStart(8),
		"Out-Tok".padStart(8),
		"Cache-W".padStart(8),
		"Cost $".padStart(8),
		"Time ms".padStart(8),
		"Words".padStart(8),
	].join(" ");
	console.log(header);
	console.log("-".repeat(100));

	for (const s of summaries) {
		for (const mode of ["default", "caveman", "caveman-full"] as Mode[]) {
			const m = s.modes[mode];
			const row = [
				(mode === "default" ? s.promptId : "").padEnd(25),
				mode.padEnd(14),
				String(m.medianInputTokens).padStart(8),
				String(m.medianOutputTokens).padStart(8),
				String(m.medianCacheWrite).padStart(8),
				m.medianCost.toFixed(4).padStart(8),
				String(Math.round(m.medianDurationMs)).padStart(8),
				String(m.medianWords).padStart(8),
			].join(" ");
			console.log(row);
		}

		const def = s.modes.default;
		const micro = s.modes.caveman;
		const full = s.modes["caveman-full"];

		if (def.medianOutputTokens > 0) {
			const microSave = Math.round((1 - micro.medianOutputTokens / def.medianOutputTokens) * 100);
			const fullSave = Math.round((1 - full.medianOutputTokens / def.medianOutputTokens) * 100);
			const microInputDelta = micro.medianInputTokens - def.medianInputTokens;
			const fullInputDelta = full.medianInputTokens - def.medianInputTokens;
			console.log(
				`${"".padEnd(25)} ${"savings".padEnd(14)} ${String(`+${microInputDelta}`).padStart(8)} ${String(`${microSave}%`).padStart(8)} ${"".padStart(8)} ${"".padStart(8)} ${"".padStart(8)} ${"micro".padStart(8)}`,
			);
			console.log(
				`${"".padEnd(25)} ${"savings".padEnd(14)} ${String(`+${fullInputDelta}`).padStart(8)} ${String(`${fullSave}%`).padStart(8)} ${"".padStart(8)} ${"".padStart(8)} ${"".padStart(8)} ${"full".padStart(8)}`,
			);
		}
		console.log("");
	}

	console.log("=".repeat(100));

	const totals: Record<Mode, { input: number; output: number; cost: number; words: number }> = {
		default: { input: 0, output: 0, cost: 0, words: 0 },
		caveman: { input: 0, output: 0, cost: 0, words: 0 },
		"caveman-full": { input: 0, output: 0, cost: 0, words: 0 },
	};

	for (const s of summaries) {
		for (const mode of ["default", "caveman", "caveman-full"] as Mode[]) {
			totals[mode].input += s.modes[mode].medianInputTokens;
			totals[mode].output += s.modes[mode].medianOutputTokens;
			totals[mode].cost += s.modes[mode].medianCost;
			totals[mode].words += s.modes[mode].medianWords;
		}
	}

	console.log("\nTOTALS ACROSS ALL PROMPTS:");
	for (const mode of ["default", "caveman", "caveman-full"] as Mode[]) {
		const t = totals[mode];
		console.log(
			`  ${mode.padEnd(14)} input: ${t.input} | output: ${t.output} | cost: $${t.cost.toFixed(4)} | words: ${t.words}`,
		);
	}

	if (totals.default.output > 0) {
		const microPct = Math.round((1 - totals.caveman.output / totals.default.output) * 100);
		const fullPct = Math.round((1 - totals["caveman-full"].output / totals.default.output) * 100);
		const microInputExtra = totals.caveman.input - totals.default.input;
		const fullInputExtra = totals["caveman-full"].input - totals.default.input;
		console.log(`\n  caveman-micro: ${microPct}% output saved, +${microInputExtra} input tokens overhead`);
		console.log(`  caveman-full:  ${fullPct}% output saved, +${fullInputExtra} input tokens overhead`);
	}
}

function printSampleResponses(summaries: PromptSummary[]): void {
	console.log("\n" + "=".repeat(100));
	console.log("SAMPLE RESPONSES (first 200 chars)");
	console.log("=".repeat(100));
	for (const s of summaries) {
		console.log(`\n--- ${s.promptId} ---`);
		for (const mode of ["default", "caveman", "caveman-full"] as Mode[]) {
			console.log(`  [${mode}]: ${s.modes[mode].sampleResponse}`);
		}
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	let model = "claude-sonnet-4-20250514";
	let trials = 1;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--model" && args[i + 1]) {
			model = args[++i];
		} else if (args[i] === "--trials" && args[i + 1]) {
			trials = Number.parseInt(args[++i], 10);
		}
	}

	console.log(`Model: ${model}`);
	console.log(`Trials: ${trials}`);
	console.log(`Prompts: ${EVAL_PROMPTS.length}`);
	console.log(`Modes: default, caveman (micro), caveman-full`);
	console.log(`Total API calls: ${EVAL_PROMPTS.length * 3 * trials}`);
	console.log("");

	const allResults: RunResult[] = [];

	for (let trial = 1; trial <= trials; trial++) {
		for (const prompt of EVAL_PROMPTS) {
			for (const mode of ["default", "caveman", "caveman-full"] as Mode[]) {
				const label = `[trial ${trial}/${trials}] ${prompt.id} | ${mode}`;
				process.stdout.write(`  ${label}...`);
				const result = await runSingle(prompt, mode, model);
				allResults.push(result);
				if (result.error) {
					console.log(` ERROR: ${result.error}`);
				} else {
					console.log(
						` in:${result.inputTokens} out:${result.outputTokens} cost:$${result.totalCost.toFixed(4)} ${result.durationMs}ms`,
					);
				}
			}
		}
	}

	const summaries = summarize(allResults, EVAL_PROMPTS);
	printTable(summaries);
	printSampleResponses(summaries);

	mkdirSync(RESULTS_DIR, { recursive: true });
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outPath = join(RESULTS_DIR, `eval-${timestamp}.json`);
	writeFileSync(
		outPath,
		JSON.stringify(
			{
				metadata: { model, trials, timestamp: new Date().toISOString(), promptCount: EVAL_PROMPTS.length },
				summaries,
				raw: allResults,
			},
			null,
			2,
		),
	);
	console.log(`\nResults saved to ${outPath}`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
