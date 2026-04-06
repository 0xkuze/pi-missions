import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writePidFile(runtimeDir: string, pid: number): void {
	writeFileSync(join(runtimeDir, "worker.pid"), String(pid), "utf8");
}

export function removePidFile(runtimeDir: string): void {
	try {
		rmSync(join(runtimeDir, "worker.pid"));
	} catch {
		// why: best-effort removal — file may not exist
	}
}

export function readPidFile(runtimeDir: string): number | null {
	try {
		const content = readFileSync(join(runtimeDir, "worker.pid"), "utf8").trim();
		const pid = Number.parseInt(content, 10);
		return Number.isNaN(pid) ? null : pid;
	} catch {
		return null;
	}
}

export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function checkOrphanedWorker(
	basePath: string,
	featureId: string,
	attemptNumber: number,
): "alive" | "dead" | "unknown" {
	const runtimeDir = join(basePath, "runtime", featureId, String(attemptNumber));
	const pid = readPidFile(runtimeDir);
	if (pid === null) return "unknown";
	return isProcessAlive(pid) ? "alive" : "dead";
}

export function killOrphanedWorker(basePath: string, featureId: string, attemptNumber: number): boolean {
	const runtimeDir = join(basePath, "runtime", featureId, String(attemptNumber));
	const pid = readPidFile(runtimeDir);
	if (pid === null) return false;
	if (!isProcessAlive(pid)) {
		removePidFile(runtimeDir);
		return false;
	}
	try {
		process.kill(pid, "SIGTERM");
		removePidFile(runtimeDir);
		return true;
	} catch {
		return false;
	}
}
