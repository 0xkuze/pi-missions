import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	checkOrphanedWorker,
	isProcessAlive,
	killOrphanedWorker,
	readPidFile,
	removePidFile,
	writePidFile,
} from "../extensions/worker-pid.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(tmpdir(), `worker-pid-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("writePidFile", () => {
	it("writes PID to expected path", () => {
		const runtimeDir = join(tmpDir, "runtime", "feat-1", "1");
		mkdirSync(runtimeDir, { recursive: true });
		writePidFile(runtimeDir, 12345);
		const content = readFileSync(join(runtimeDir, "worker.pid"), "utf8");
		expect(content).toBe("12345");
	});
});

describe("readPidFile", () => {
	it("reads PID from file", () => {
		const runtimeDir = join(tmpDir, "runtime", "feat-1", "1");
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "worker.pid"), "54321", "utf8");
		const pid = readPidFile(runtimeDir);
		expect(pid).toBe(54321);
	});

	it("returns null for missing file", () => {
		const runtimeDir = join(tmpDir, "runtime", "feat-1", "1");
		const pid = readPidFile(runtimeDir);
		expect(pid).toBeNull();
	});

	it("returns null for invalid content", () => {
		const runtimeDir = join(tmpDir, "runtime", "feat-1", "1");
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "worker.pid"), "not-a-number", "utf8");
		const pid = readPidFile(runtimeDir);
		expect(pid).toBeNull();
	});

	it("trims whitespace from PID", () => {
		const runtimeDir = join(tmpDir, "runtime", "feat-1", "1");
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "worker.pid"), "  12345  \n", "utf8");
		const pid = readPidFile(runtimeDir);
		expect(pid).toBe(12345);
	});
});

describe("removePidFile", () => {
	it("removes the PID file", () => {
		const runtimeDir = join(tmpDir, "runtime", "feat-1", "1");
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "worker.pid"), "12345", "utf8");
		removePidFile(runtimeDir);
		const pid = readPidFile(runtimeDir);
		expect(pid).toBeNull();
	});

	it("does not throw when file is missing", () => {
		const runtimeDir = join(tmpDir, "runtime", "feat-1", "1");
		expect(() => removePidFile(runtimeDir)).not.toThrow();
	});
});

describe("isProcessAlive", () => {
	it("returns true for current process", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("returns false for non-existent PID", () => {
		expect(isProcessAlive(999_999_999)).toBe(false);
	});
});

describe("checkOrphanedWorker", () => {
	it("returns 'unknown' when no PID file exists", () => {
		const result = checkOrphanedWorker(tmpDir, "feat-1", 1);
		expect(result).toBe("unknown");
	});

	it("returns 'dead' for non-existent PID", () => {
		const runtimeDir = join(tmpDir, "runtime", "feat-1", "1");
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "worker.pid"), "999999999", "utf8");
		const result = checkOrphanedWorker(tmpDir, "feat-1", 1);
		expect(result).toBe("dead");
	});

	it("returns 'alive' for a live process", () => {
		const runtimeDir = join(tmpDir, "runtime", "feat-1", "1");
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "worker.pid"), String(process.pid), "utf8");
		const result = checkOrphanedWorker(tmpDir, "feat-1", 1);
		expect(result).toBe("alive");
	});
});

describe("killOrphanedWorker", () => {
	it("returns false when no PID file exists", () => {
		const result = killOrphanedWorker(tmpDir, "feat-1", 1);
		expect(result).toBe(false);
	});

	it("returns false for dead process and removes PID file", () => {
		const runtimeDir = join(tmpDir, "runtime", "feat-1", "1");
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "worker.pid"), "999999999", "utf8");
		const result = killOrphanedWorker(tmpDir, "feat-1", 1);
		expect(result).toBe(false);
		expect(readPidFile(runtimeDir)).toBeNull();
	});
});
