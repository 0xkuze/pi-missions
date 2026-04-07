import { describe, expect, it } from "bun:test";
import { afterEach, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	generateValidatorPrompt,
	generateValidatorSkill,
	writeValidatorFiles,
} from "../../extensions/orchestrator/validator-prompt.js";
import { makeFeature } from "../helpers/index.js";

describe("generateValidatorSkill", () => {
	it("includes feature name and description", () => {
		const feature = makeFeature({ name: "Auth endpoint", description: "Create login endpoint" });
		const skill = generateValidatorSkill(feature);
		expect(skill).toContain("Auth endpoint");
		expect(skill).toContain("Create login endpoint");
	});

	it("includes all acceptance criteria numbered", () => {
		const feature = makeFeature({ acceptanceCriteria: ["Login works", "Returns JWT", "Validates email"] });
		const skill = generateValidatorSkill(feature);
		expect(skill).toContain("1. Login works");
		expect(skill).toContain("2. Returns JWT");
		expect(skill).toContain("3. Validates email");
	});

	it("contains VERDICT format instructions", () => {
		const feature = makeFeature();
		const skill = generateValidatorSkill(feature);
		expect(skill).toContain("VERDICT: PASS");
		expect(skill).toContain("VERDICT: FIX");
		expect(skill).toContain("VERDICT: REJECT");
	});

	it("instructs read-only review — no edit or write", () => {
		const feature = makeFeature();
		const skill = generateValidatorSkill(feature);
		expect(skill).toContain("Do NOT modify any files");
		expect(skill).toContain("Do NOT use edit or write");
	});

	it("contains FEEDBACK format", () => {
		const feature = makeFeature();
		const skill = generateValidatorSkill(feature);
		expect(skill).toContain("FEEDBACK:");
	});
});

describe("generateValidatorPrompt", () => {
	it("includes feature name", () => {
		const feature = makeFeature({ name: "Fizzbuzz logic" });
		const prompt = generateValidatorPrompt(feature, "Done", ["src/fizz.ts"]);
		expect(prompt).toContain("Fizzbuzz logic");
	});

	it("includes files changed", () => {
		const feature = makeFeature();
		const prompt = generateValidatorPrompt(feature, "Done", ["src/a.ts", "src/b.ts"]);
		expect(prompt).toContain("src/a.ts");
		expect(prompt).toContain("src/b.ts");
	});

	it("includes worker summary", () => {
		const feature = makeFeature();
		const prompt = generateValidatorPrompt(feature, "Created fizzbuzz function with tests", []);
		expect(prompt).toContain("Created fizzbuzz function with tests");
	});

	it("handles empty filesChanged gracefully", () => {
		const feature = makeFeature();
		const prompt = generateValidatorPrompt(feature, "Done", []);
		expect(prompt).toContain("scan the project");
	});
});

describe("writeValidatorFiles", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "validator-prompt-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes skill and prompt to runtime dir", () => {
		writeValidatorFiles(tmpDir, "feat-1", 1, { skill: "# Skill", prompt: "Review this" });
		const skillPath = join(tmpDir, "runtime", "feat-1", "1", "validator-skill.md");
		const promptPath = join(tmpDir, "runtime", "feat-1", "1", "validator-prompt.md");
		expect(existsSync(skillPath)).toBe(true);
		expect(existsSync(promptPath)).toBe(true);
		expect(readFileSync(skillPath, "utf8")).toBe("# Skill");
		expect(readFileSync(promptPath, "utf8")).toBe("Review this");
	});
});
