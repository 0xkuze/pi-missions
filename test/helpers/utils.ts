import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface TempDir {
	path: string;
	cleanup: () => void;
}

function createTempDir(prefix = "pi-missions-test-"): TempDir {
	const path = mkdtempSync(join(tmpdir(), prefix));
	return {
		path,
		cleanup: () => rmSync(path, { recursive: true, force: true }),
	};
}

interface MockSpawnOptions {
	stdoutLines?: string[];
	stderr?: string;
	exitCode?: number;
	signal?: string | null;
	error?: Error;
}

type SpawnFn = (command: string, args: string[], options: object) => MockChildProcess;

interface MockChildProcess {
	stdout: { on: (event: string, handler: (data: Buffer) => void) => void };
	stderr: { on: (event: string, handler: (data: Buffer) => void) => void };
	killed: boolean;
	on: (event: string, handler: (...args: unknown[]) => void) => void;
}

function createMockSpawn(opts: MockSpawnOptions = {}): SpawnFn {
	const { stdoutLines = [], stderr = "", exitCode = 0, signal = null, error } = opts;

	return (_command: string, _args: string[], _options: object) => {
		const stdoutHandlers: Array<(data: Buffer) => void> = [];
		const stderrHandlers: Array<(data: Buffer) => void> = [];
		const closeHandlers: Array<(code: number | null, signal: string | null) => void> = [];
		const errorHandlers: Array<(err: Error) => void> = [];

		const proc: MockChildProcess = {
			stdout: {
				on: (event: string, handler: (data: Buffer) => void) => {
					if (event === "data") stdoutHandlers.push(handler);
				},
			},
			stderr: {
				on: (event: string, handler: (data: Buffer) => void) => {
					if (event === "data") stderrHandlers.push(handler);
				},
			},
			killed: false,
			on: (event: string, handler: (...args: unknown[]) => void) => {
				if (event === "close") closeHandlers.push(handler as (code: number | null, signal: string | null) => void);
				if (event === "error") errorHandlers.push(handler as (err: Error) => void);
			},
		};

		setImmediate(() => {
			if (error) {
				for (const h of errorHandlers) h(error);
				return;
			}
			if (stderr) {
				for (const h of stderrHandlers) h(Buffer.from(stderr));
			}
			const joinedStdout = stdoutLines.join("\n");
			if (joinedStdout) {
				for (const h of stdoutHandlers) h(Buffer.from(joinedStdout));
			}
			for (const h of closeHandlers) h(exitCode, signal);
		});

		return proc;
	};
}

export type { MockChildProcess, MockSpawnOptions, SpawnFn, TempDir };
export { createMockSpawn, createTempDir };
