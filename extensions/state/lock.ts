import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActiveSession } from "../types.js";

const LOCK_FILE = "lock";
const SESSION_FILE = "active-session.json";

function lockPath(basePath: string): string {
	return join(basePath, LOCK_FILE);
}

function sessionPath(basePath: string): string {
	return join(basePath, SESSION_FILE);
}

function ensureDir(basePath: string): void {
	mkdirSync(basePath, { recursive: true });
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readSession(basePath: string): ActiveSession | null {
	const path = sessionPath(basePath);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as ActiveSession;
	} catch {
		return null;
	}
}

function writeSession(basePath: string, session: ActiveSession): void {
	writeFileSync(sessionPath(basePath), JSON.stringify(session, null, 2));
}

function tryCreateLock(basePath: string): boolean {
	ensureDir(basePath);
	try {
		const fd = openSync(lockPath(basePath), "wx");
		closeSync(fd);
		return true;
	} catch {
		return false;
	}
}

export function acquireLock(basePath: string, sessionInfo: ActiveSession): boolean {
	if (tryCreateLock(basePath)) {
		writeSession(basePath, sessionInfo);
		return true;
	}

	const existing = readSession(basePath);
	if (existing !== null && existing.sessionId === sessionInfo.sessionId) {
		writeSession(basePath, sessionInfo);
		return true;
	}

	if (existing !== null && !isPidAlive(existing.pid)) {
		rmSync(lockPath(basePath), { force: true });
		if (tryCreateLock(basePath)) {
			writeSession(basePath, sessionInfo);
			return true;
		}
	}

	return false;
}

export function releaseLock(basePath: string): void {
	rmSync(lockPath(basePath), { force: true });
	rmSync(sessionPath(basePath), { force: true });
}

export function isLocked(basePath: string): { locked: boolean; session?: ActiveSession } {
	if (!existsSync(lockPath(basePath))) {
		return { locked: false };
	}
	const session = readSession(basePath);
	if (session === null) {
		return { locked: true };
	}
	return { locked: true, session };
}

export function updateHeartbeat(basePath: string): void {
	const session = readSession(basePath);
	if (session === null) return;
	writeSession(basePath, { ...session, lastHeartbeatAt: new Date().toISOString() });
}

type LockConflict =
	| { kind: "none" }
	| { kind: "live"; session: ActiveSession }
	| { kind: "stale"; session: ActiveSession };

export function getLockConflict(basePath: string, ownSessionId: string): LockConflict {
	const { locked, session } = isLocked(basePath);
	if (!locked) return { kind: "none" };
	if (!session) return { kind: "none" };
	if (session.sessionId === ownSessionId) return { kind: "none" };
	if (isPidAlive(session.pid)) return { kind: "live", session };
	return { kind: "stale", session };
}
