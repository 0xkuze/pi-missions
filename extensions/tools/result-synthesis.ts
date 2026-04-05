import type { WorkerResult } from "../types.js";

export function synthesizeWorkerResult(
	_stdout: string,
	_stderr: string,
	_exitCode: number | null,
	_signal: string | null,
	_startTime: number,
): WorkerResult {
	return {
		status: "failure",
		summary: "",
		filesChanged: [],
		commandsRun: [],
		metrics: {
			durationMs: 0,
		},
	};
}
