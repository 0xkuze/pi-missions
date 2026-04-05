import { execSync } from "node:child_process";
import type { GitSnapshot } from "./types.js";

export function isGitAvailable(cwd: string): boolean {
	try {
		execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function captureGitSnapshot(cwd: string): GitSnapshot {
	const headCommit = execSync("git rev-parse HEAD", { cwd }).toString().trim();
	const statusOutput = execSync("git status --porcelain", { cwd }).toString();
	const dirtyFiles = statusOutput
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => line.slice(3).trim());
	return {
		headCommit,
		dirtyFiles,
		autoCommitEnabled: dirtyFiles.length === 0,
	};
}

export function getChangedFiles(cwd: string, baseCommit?: string): string[] {
	const ref = baseCommit ?? "HEAD";
	try {
		const output = execSync(`git diff --name-only ${ref}`, { cwd }).toString();
		return output.split("\n").filter((line) => line.trim().length > 0);
	} catch {
		return [];
	}
}

export function stageAndCommit(cwd: string, files: string[], message: string): string {
	for (const file of files) {
		execSync(`git add -- "${file}"`, { cwd });
	}
	execSync(`git commit -m "${message}"`, { cwd });
	return execSync("git rev-parse HEAD", { cwd }).toString().trim();
}

export function detectOutOfScopeChanges(changedFiles: string[], relevantFiles: string[]): string[] {
	const relevant = new Set(relevantFiles);
	return changedFiles.filter((file) => !relevant.has(file));
}
