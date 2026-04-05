import type { ActiveSession } from "../types.js";

export function acquireLock(_basePath: string, _sessionInfo: ActiveSession): boolean {
	return false;
}

export function releaseLock(_basePath: string): void {}

export function isLocked(_basePath: string): { locked: boolean; session?: ActiveSession } {
	return { locked: false };
}

export function updateHeartbeat(_basePath: string): void {}
