import { existsSync } from "node:fs";
import { basename } from "node:path";

export function generateId(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	let result = "";
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	for (const byte of bytes) {
		result += chars[byte % chars.length];
	}
	return result;
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	}
	if (minutes > 0) {
		return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
	}
	return `${seconds}s`;
}

export function nowISO(): string {
	return new Date().toISOString();
}

export function getPiInvocation(args: string[]): { command: string; commandArgs: string[] } {
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
