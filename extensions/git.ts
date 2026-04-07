import { execFileSync, execSync } from "node:child_process";
import type { GitSnapshot } from "./types.js";

export function isGitAvailable(cwd: string): boolean {
	try {
		execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function ensureGitRepo(cwd: string): boolean {
	if (isGitAvailable(cwd)) return true;
	try {
		execSync("git init", { cwd, stdio: "ignore" });
		execSync("git add -A", { cwd, stdio: "ignore" });
		execSync('git commit -m "initial commit (pre-mission)" --allow-empty', { cwd, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function captureGitSnapshot(cwd: string): GitSnapshot {
	const headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
	const statusOutput = execFileSync("git", ["status", "--porcelain"], { cwd }).toString();
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

const EXCLUDED_PREFIXES = ["node_modules/", ".pi/", "dist/", ".git/"];

function isExcluded(filePath: string): boolean {
	for (const prefix of EXCLUDED_PREFIXES) {
		if (filePath.startsWith(prefix) || filePath === prefix.slice(0, -1)) return true;
	}
	return false;
}

export function getChangedFiles(cwd: string, baseCommit?: string): string[] {
	const files = new Set<string>();
	const ref = baseCommit ?? "HEAD";
	try {
		const diff = execFileSync("git", ["diff", "--name-only", ref], { cwd }).toString();
		for (const line of diff.split("\n")) {
			const trimmed = line.trim();
			if (trimmed && !isExcluded(trimmed)) files.add(trimmed);
		}
	} catch { /* no tracked changes */ }
	try {
		const status = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd }).toString();
		for (const line of status.split("\n")) {
			if (!line.trim()) continue;
			const code = line.slice(0, 2);
			let filePath = line.slice(3).trim();
			if (filePath.endsWith("/")) filePath = filePath.slice(0, -1);
			if (isExcluded(filePath)) continue;
			if (code === "??") {
				files.add(filePath);
			} else if (code.trim()) {
				files.add(filePath);
			}
		}
	} catch { /* no git */ }
	return [...files];
}

export function stageAndCommit(cwd: string, files: string[], message: string): string {
	for (const file of files) {
		execFileSync("git", ["add", "--", file], { cwd });
	}
	execFileSync("git", ["commit", "-m", message], { cwd });
	return execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
}

const LOCKFILES = new Set(["package-lock.json", "bun.lock", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "go.sum"]);

export function detectOutOfScopeChanges(changedFiles: string[], relevantFiles: string[]): string[] {
	const relevant = new Set(relevantFiles);
	return changedFiles.filter((file) => !relevant.has(file) && !LOCKFILES.has(file));
}
