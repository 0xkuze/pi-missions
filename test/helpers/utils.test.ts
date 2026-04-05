import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import type { MockChildProcess, MockSpawnOptions, SpawnFn, TempDir } from "./utils.js";
import { createMockSpawn, createTempDir } from "./utils.js";

describe("createTempDir", () => {
	it("returns an object with path and cleanup", () => {
		const dir = createTempDir();
		try {
			expect(dir.path).toBeString();
			expect(typeof dir.cleanup).toBe("function");
		} finally {
			dir.cleanup();
		}
	});

	it("creates a directory that exists on disk", () => {
		const dir = createTempDir();
		try {
			expect(existsSync(dir.path)).toBe(true);
		} finally {
			dir.cleanup();
		}
	});

	it("uses os.tmpdir() as the base directory", () => {
		const dir = createTempDir();
		try {
			expect(dir.path.startsWith(tmpdir())).toBe(true);
		} finally {
			dir.cleanup();
		}
	});

	it("uses the default prefix pi-missions-test-", () => {
		const dir = createTempDir();
		try {
			const basename = dir.path.split("/").pop()!;
			expect(basename.startsWith("pi-missions-test-")).toBe(true);
		} finally {
			dir.cleanup();
		}
	});

	it("accepts a custom prefix", () => {
		const dir = createTempDir("custom-prefix-");
		try {
			const basename = dir.path.split("/").pop()!;
			expect(basename.startsWith("custom-prefix-")).toBe(true);
		} finally {
			dir.cleanup();
		}
	});

	it("cleanup removes the directory from disk", () => {
		const dir = createTempDir();
		const path = dir.path;
		expect(existsSync(path)).toBe(true);
		dir.cleanup();
		expect(existsSync(path)).toBe(false);
	});

	it("cleanup is idempotent", () => {
		const dir = createTempDir();
		dir.cleanup();
		expect(() => dir.cleanup()).not.toThrow();
	});

	it("creates unique directories on successive calls", () => {
		const a = createTempDir();
		const b = createTempDir();
		try {
			expect(a.path).not.toBe(b.path);
		} finally {
			a.cleanup();
			b.cleanup();
		}
	});
});

describe("createMockSpawn", () => {
	it("returns a function", () => {
		const spawn = createMockSpawn();
		expect(typeof spawn).toBe("function");
	});

	it("returned function produces a mock child process", () => {
		const spawn = createMockSpawn();
		const proc = spawn("pi", ["--help"], {});
		expect(proc.stdout).toBeDefined();
		expect(proc.stderr).toBeDefined();
		expect(typeof proc.on).toBe("function");
		expect(proc.killed).toBe(false);
	});

	it("defaults to exit code 0 and no output", async () => {
		const spawn = createMockSpawn();
		const proc = spawn("pi", [], {});
		const result = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
			proc.on("close", (code, signal) => resolve({ code: code as number | null, signal: signal as string | null }));
		});
		expect(result.code).toBe(0);
		expect(result.signal).toBeNull();
	});

	it("emits stdout data from stdoutLines", async () => {
		const spawn = createMockSpawn({ stdoutLines: ["line1", "line2"] });
		const proc = spawn("pi", [], {});
		const chunks: Buffer[] = [];
		proc.stdout.on("data", (data) => chunks.push(data));
		await new Promise<void>((resolve) => {
			proc.on("close", () => resolve());
		});
		const output = Buffer.concat(chunks).toString();
		expect(output).toBe("line1\nline2");
	});

	it("emits stderr data", async () => {
		const spawn = createMockSpawn({ stderr: "error output" });
		const proc = spawn("pi", [], {});
		const chunks: Buffer[] = [];
		proc.stderr.on("data", (data) => chunks.push(data));
		await new Promise<void>((resolve) => {
			proc.on("close", () => resolve());
		});
		const output = Buffer.concat(chunks).toString();
		expect(output).toBe("error output");
	});

	it("uses the provided exit code", async () => {
		const spawn = createMockSpawn({ exitCode: 42 });
		const proc = spawn("pi", [], {});
		const result = await new Promise<{ code: number | null }>((resolve) => {
			proc.on("close", (code) => resolve({ code: code as number | null }));
		});
		expect(result.code).toBe(42);
	});

	it("uses the provided signal", async () => {
		const spawn = createMockSpawn({ signal: "SIGTERM" });
		const proc = spawn("pi", [], {});
		const result = await new Promise<{ signal: string | null }>((resolve) => {
			proc.on("close", (_code, signal) => resolve({ signal: signal as string | null }));
		});
		expect(result.signal).toBe("SIGTERM");
	});

	it("emits error instead of close when error is provided", async () => {
		const err = new Error("spawn ENOENT");
		const spawn = createMockSpawn({ error: err });
		const proc = spawn("pi", [], {});
		const caught = await new Promise<Error>((resolve) => {
			proc.on("error", (e) => resolve(e as Error));
		});
		expect(caught).toBe(err);
	});

	it("does not emit close when error is provided", async () => {
		const spawn = createMockSpawn({ error: new Error("fail") });
		const proc = spawn("pi", [], {});
		let closeCalled = false;
		proc.on("close", () => {
			closeCalled = true;
		});
		proc.on("error", () => {});
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));
		expect(closeCalled).toBe(false);
	});

	it("does not emit stdout when stdoutLines is empty", async () => {
		const spawn = createMockSpawn({ stdoutLines: [] });
		const proc = spawn("pi", [], {});
		let stdoutCalled = false;
		proc.stdout.on("data", () => {
			stdoutCalled = true;
		});
		await new Promise<void>((resolve) => {
			proc.on("close", () => resolve());
		});
		expect(stdoutCalled).toBe(false);
	});

	it("does not emit stderr when stderr is empty string", async () => {
		const spawn = createMockSpawn({ stderr: "" });
		const proc = spawn("pi", [], {});
		let stderrCalled = false;
		proc.stderr.on("data", () => {
			stderrCalled = true;
		});
		await new Promise<void>((resolve) => {
			proc.on("close", () => resolve());
		});
		expect(stderrCalled).toBe(false);
	});

	it("accepts all options together", async () => {
		const spawn = createMockSpawn({
			stdoutLines: ["output"],
			stderr: "warn",
			exitCode: 1,
			signal: "SIGKILL",
		});
		const proc = spawn("pi", [], {});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		proc.stdout.on("data", (d) => stdoutChunks.push(d));
		proc.stderr.on("data", (d) => stderrChunks.push(d));
		const result = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
			proc.on("close", (code, signal) => resolve({ code: code as number | null, signal: signal as string | null }));
		});
		expect(Buffer.concat(stdoutChunks).toString()).toBe("output");
		expect(Buffer.concat(stderrChunks).toString()).toBe("warn");
		expect(result.code).toBe(1);
		expect(result.signal).toBe("SIGKILL");
	});

	it("each call produces an independent child process", async () => {
		const spawn = createMockSpawn({ stdoutLines: ["hello"] });
		const proc1 = spawn("pi", [], {});
		const proc2 = spawn("pi", [], {});
		const chunks1: Buffer[] = [];
		const chunks2: Buffer[] = [];
		proc1.stdout.on("data", (d) => chunks1.push(d));
		proc2.stdout.on("data", (d) => chunks2.push(d));
		await Promise.all([
			new Promise<void>((r) => {
				proc1.on("close", () => r());
			}),
			new Promise<void>((r) => {
				proc2.on("close", () => r());
			}),
		]);
		expect(Buffer.concat(chunks1).toString()).toBe("hello");
		expect(Buffer.concat(chunks2).toString()).toBe("hello");
	});
});

describe("type safety", () => {
	it("createTempDir returns TempDir", () => {
		const dir: TempDir = createTempDir();
		expect(dir.path).toBeString();
		dir.cleanup();
	});

	it("createMockSpawn returns SpawnFn", () => {
		const spawn: SpawnFn = createMockSpawn();
		expect(typeof spawn).toBe("function");
	});

	it("SpawnFn produces MockChildProcess", () => {
		const spawn = createMockSpawn();
		const proc: MockChildProcess = spawn("pi", [], {});
		expect(proc).toBeDefined();
	});

	it("MockSpawnOptions fields are all optional", () => {
		const opts: MockSpawnOptions = {};
		const spawn = createMockSpawn(opts);
		expect(typeof spawn).toBe("function");
	});
});
