import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureGitSnapshot, detectOutOfScopeChanges, getChangedFiles, isGitAvailable, stageAndCommit } from "./git.js";

function initGitRepo(dir: string): void {
	execSync("git init", { cwd: dir, stdio: "ignore" });
	execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
	execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
	execSync("git config commit.gpgsign false", { cwd: dir, stdio: "ignore" });
}

function makeInitialCommit(dir: string): string {
	writeFileSync(join(dir, "README.md"), "# Test Repo");
	execSync("git add -A", { cwd: dir, stdio: "ignore" });
	execSync("git commit -m 'initial commit'", { cwd: dir, stdio: "ignore" });
	return execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
}

let testDir: string;
let nonGitDir: string;

beforeEach(() => {
	const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	testDir = join(tmpdir(), `git-test-${suffix}`);
	nonGitDir = join(tmpdir(), `non-git-test-${suffix}`);
	mkdirSync(testDir, { recursive: true });
	mkdirSync(nonGitDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
	try {
		rmSync(nonGitDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("isGitAvailable", () => {
	describe("VAL-GIT-001: git availability detection", () => {
		it("returns true inside a git repository", () => {
			initGitRepo(testDir);
			expect(isGitAvailable(testDir)).toBe(true);
		});

		it("returns false outside a git repository", () => {
			expect(isGitAvailable(nonGitDir)).toBe(false);
		});

		it("does not throw in either case", () => {
			expect(() => isGitAvailable(testDir)).not.toThrow();
			expect(() => isGitAvailable(nonGitDir)).not.toThrow();
		});

		it("returns false for a non-existent directory without throwing", () => {
			const nonExistent = join(tmpdir(), "does-not-exist-12345");
			expect(() => isGitAvailable(nonExistent)).not.toThrow();
			expect(isGitAvailable(nonExistent)).toBe(false);
		});
	});
});

describe("captureGitSnapshot", () => {
	describe("VAL-GIT-002: pre-mission snapshot captures repository state", () => {
		it("records HEAD commit SHA as a 40-character hex string", () => {
			initGitRepo(testDir);
			const sha = makeInitialCommit(testDir);
			const snapshot = captureGitSnapshot(testDir);
			expect(snapshot.headCommit).toBe(sha);
			expect(snapshot.headCommit).toMatch(/^[0-9a-f]{40}$/);
		});

		it("returns empty dirtyFiles for a clean repository", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			const snapshot = captureGitSnapshot(testDir);
			expect(snapshot.dirtyFiles).toEqual([]);
		});

		it("returns dirty files in the dirtyFiles list", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			writeFileSync(join(testDir, "dirty.ts"), "// modified");
			const snapshot = captureGitSnapshot(testDir);
			expect(snapshot.dirtyFiles).toContain("dirty.ts");
		});

		it("includes staged files in dirtyFiles", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			writeFileSync(join(testDir, "staged.ts"), "// new file");
			execSync("git add staged.ts", { cwd: testDir, stdio: "ignore" });
			const snapshot = captureGitSnapshot(testDir);
			expect(snapshot.dirtyFiles).toContain("staged.ts");
		});

		it("sets autoCommitEnabled to true for a clean repository", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			const snapshot = captureGitSnapshot(testDir);
			expect(snapshot.autoCommitEnabled).toBe(true);
		});

		it("sets autoCommitEnabled to false when dirty files exist", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			writeFileSync(join(testDir, "dirty.ts"), "// modified");
			const snapshot = captureGitSnapshot(testDir);
			expect(snapshot.autoCommitEnabled).toBe(false);
		});

		it("returns only filenames without git status codes in dirtyFiles", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			writeFileSync(join(testDir, "my-file.ts"), "// modified");
			const snapshot = captureGitSnapshot(testDir);
			const file = snapshot.dirtyFiles[0];
			expect(file).not.toMatch(/^[A-Z?!]\s/);
			expect(file).toBe("my-file.ts");
		});
	});
});

describe("getChangedFiles", () => {
	describe("VAL-GIT-003: per-feature change tracking", () => {
		it("returns files changed since a given base commit", () => {
			initGitRepo(testDir);
			const base = makeInitialCommit(testDir);
			writeFileSync(join(testDir, "new-file.ts"), "// new");
			execSync("git add -A", { cwd: testDir, stdio: "ignore" });
			execSync("git commit -m 'add new-file'", { cwd: testDir, stdio: "ignore" });
			const changed = getChangedFiles(testDir, base);
			expect(changed).toContain("new-file.ts");
		});

		it("returns empty array when no files changed since base commit", () => {
			initGitRepo(testDir);
			const base = makeInitialCommit(testDir);
			const changed = getChangedFiles(testDir, base);
			expect(changed).toEqual([]);
		});

		it("uses HEAD as default base when no baseCommit provided", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			writeFileSync(join(testDir, "untracked.ts"), "// untracked");
			const changed = getChangedFiles(testDir);
			expect(Array.isArray(changed)).toBe(true);
		});

		it("does not include pre-existing dirty files in committed delta", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			writeFileSync(join(testDir, "pre-existing.ts"), "// pre-existing dirty");
			const base = execSync("git rev-parse HEAD", { cwd: testDir }).toString().trim();
			writeFileSync(join(testDir, "worker-change.ts"), "// added by worker");
			execSync("git add worker-change.ts", { cwd: testDir, stdio: "ignore" });
			execSync("git commit -m 'worker added file'", { cwd: testDir, stdio: "ignore" });
			const changed = getChangedFiles(testDir, base);
			expect(changed).toContain("worker-change.ts");
			expect(changed).not.toContain("pre-existing.ts");
		});

		it("returns multiple changed files", () => {
			initGitRepo(testDir);
			const base = makeInitialCommit(testDir);
			writeFileSync(join(testDir, "file-a.ts"), "// a");
			writeFileSync(join(testDir, "file-b.ts"), "// b");
			execSync("git add -A", { cwd: testDir, stdio: "ignore" });
			execSync("git commit -m 'add two files'", { cwd: testDir, stdio: "ignore" });
			const changed = getChangedFiles(testDir, base);
			expect(changed).toContain("file-a.ts");
			expect(changed).toContain("file-b.ts");
		});
	});

	describe("VAL-GIT-006: no-git mode graceful degradation", () => {
		it("returns empty array when git is unavailable (non-git directory)", () => {
			const changed = getChangedFiles(nonGitDir);
			expect(changed).toEqual([]);
		});

		it("returns empty array when baseCommit is invalid without throwing", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			const changed = getChangedFiles(testDir, "invalid-commit-sha");
			expect(changed).toEqual([]);
		});

		it("does not throw when called outside a git repo", () => {
			expect(() => getChangedFiles(nonGitDir)).not.toThrow();
		});
	});
});

describe("stageAndCommit", () => {
	describe("VAL-GIT-004: selective staging commits only feature-changed files", () => {
		it("stages specified files and creates a commit", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			writeFileSync(join(testDir, "feature.ts"), "// feature");
			writeFileSync(join(testDir, "unrelated.ts"), "// unrelated");
			const sha = stageAndCommit(testDir, ["feature.ts"], "mission: add feature");
			expect(sha).toMatch(/^[0-9a-f]{40}$/);
		});

		it("returns the new HEAD commit SHA after committing", () => {
			initGitRepo(testDir);
			const initialSha = makeInitialCommit(testDir);
			writeFileSync(join(testDir, "feature.ts"), "// feature");
			const newSha = stageAndCommit(testDir, ["feature.ts"], "mission: add feature");
			expect(newSha).not.toBe(initialSha);
			expect(newSha).toMatch(/^[0-9a-f]{40}$/);
		});

		it("does not stage unspecified files", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			writeFileSync(join(testDir, "target.ts"), "// target");
			writeFileSync(join(testDir, "other.ts"), "// other");
			stageAndCommit(testDir, ["target.ts"], "mission: add target");
			const statusOutput = execSync("git status --porcelain", { cwd: testDir }).toString();
			expect(statusOutput).toContain("other.ts");
			expect(statusOutput).not.toContain("target.ts");
		});

		it("commits with the provided message", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			writeFileSync(join(testDir, "feature.ts"), "// feature");
			stageAndCommit(testDir, ["feature.ts"], "mission: implement auth");
			const log = execSync("git log --oneline -1", { cwd: testDir }).toString();
			expect(log).toContain("mission: implement auth");
		});

		it("can commit multiple files in one call", () => {
			initGitRepo(testDir);
			makeInitialCommit(testDir);
			writeFileSync(join(testDir, "file-a.ts"), "// a");
			writeFileSync(join(testDir, "file-b.ts"), "// b");
			const sha = stageAndCommit(testDir, ["file-a.ts", "file-b.ts"], "mission: add files");
			expect(sha).toMatch(/^[0-9a-f]{40}$/);
			const showOutput = execSync(`git show --name-only ${sha}`, { cwd: testDir }).toString();
			expect(showOutput).toContain("file-a.ts");
			expect(showOutput).toContain("file-b.ts");
		});
	});
});

describe("detectOutOfScopeChanges", () => {
	describe("VAL-GIT-003: out-of-scope detection", () => {
		it("returns files not in the relevantFiles list", () => {
			const changed = ["src/auth.ts", "src/config.ts", "tests/unrelated.test.ts"];
			const relevant = ["src/auth.ts", "src/config.ts"];
			const outOfScope = detectOutOfScopeChanges(changed, relevant);
			expect(outOfScope).toEqual(["tests/unrelated.test.ts"]);
		});

		it("returns empty array when all changed files are relevant", () => {
			const changed = ["src/auth.ts"];
			const relevant = ["src/auth.ts", "src/config.ts"];
			const outOfScope = detectOutOfScopeChanges(changed, relevant);
			expect(outOfScope).toEqual([]);
		});

		it("returns all changed files when relevantFiles is empty", () => {
			const changed = ["src/auth.ts", "src/config.ts"];
			const relevant: string[] = [];
			const outOfScope = detectOutOfScopeChanges(changed, relevant);
			expect(outOfScope).toEqual(["src/auth.ts", "src/config.ts"]);
		});

		it("returns empty array when no files changed", () => {
			const changed: string[] = [];
			const relevant = ["src/auth.ts"];
			const outOfScope = detectOutOfScopeChanges(changed, relevant);
			expect(outOfScope).toEqual([]);
		});

		it("returns empty array when both are empty", () => {
			const outOfScope = detectOutOfScopeChanges([], []);
			expect(outOfScope).toEqual([]);
		});

		it("uses exact string matching (case-sensitive)", () => {
			const changed = ["src/Auth.ts"];
			const relevant = ["src/auth.ts"];
			const outOfScope = detectOutOfScopeChanges(changed, relevant);
			expect(outOfScope).toContain("src/Auth.ts");
		});
	});
});

describe("no-git mode integration", () => {
	describe("VAL-GIT-006: full no-git mode graceful operation", () => {
		it("isGitAvailable returns false for non-git directory", () => {
			expect(isGitAvailable(nonGitDir)).toBe(false);
		});

		it("getChangedFiles degrades gracefully in non-git directory", () => {
			const result = getChangedFiles(nonGitDir);
			expect(result).toEqual([]);
		});

		it("detectOutOfScopeChanges works without git", () => {
			const result = detectOutOfScopeChanges(["file.ts"], ["other.ts"]);
			expect(result).toEqual(["file.ts"]);
		});
	});
});
