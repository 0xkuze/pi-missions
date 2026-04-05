import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Feature } from "../../extensions/types.js";
import { generateWorkerContext, generateWorkerPrompt, generateWorkerSkill, writeWorkerFiles } from "../../extensions/orchestrator/worker-prompt.js";

const FORBIDDEN_TERMS = ["mission", "orchestrat", "milestone", "state.json", "plan.json", ".pi/missions"];

function makeFeature(overrides: Partial<Feature> = {}): Feature {
	return {
		id: "feat-123",
		name: "Add JWT authentication",
		description: "Implement JWT-based authentication with refresh tokens.",
		acceptanceCriteria: [
			"JWT signing with RS256 algorithm",
			"Token refresh endpoint implemented",
			"15m access token expiry, 7d refresh expiry",
		],
		relevantFiles: ["src/auth.ts", "src/middleware/verify.ts"],
		dependencies: [],
		estimatedComplexity: "medium",
		status: "pending",
		attempts: [],
		...overrides,
	};
}

describe("generateWorkerSkill", () => {
	it("includes feature name in heading", () => {
		const skill = generateWorkerSkill(makeFeature());
		expect(skill).toContain("Add JWT authentication");
	});

	it("includes feature description", () => {
		const skill = generateWorkerSkill(makeFeature());
		expect(skill).toContain("Implement JWT-based authentication with refresh tokens.");
	});

	it("includes all acceptance criteria", () => {
		const skill = generateWorkerSkill(makeFeature());
		expect(skill).toContain("JWT signing with RS256 algorithm");
		expect(skill).toContain("Token refresh endpoint implemented");
		expect(skill).toContain("15m access token expiry, 7d refresh expiry");
	});

	it("includes relevant files", () => {
		const skill = generateWorkerSkill(makeFeature());
		expect(skill).toContain("src/auth.ts");
		expect(skill).toContain("src/middleware/verify.ts");
	});

	it("includes focus instructions", () => {
		const skill = generateWorkerSkill(makeFeature());
		expect(skill).toContain("Implement only what is described");
	});

	it("includes AGENTS.md conventions when provided (VAL-WORKER-001)", () => {
		const agentsMd = "## Conventions\n\nUse TypeScript strict mode.";
		const skill = generateWorkerSkill(makeFeature(), agentsMd);
		expect(skill).toContain("Use TypeScript strict mode.");
	});

	it("works without AGENTS.md (no error, no reference to missing file)", () => {
		expect(() => generateWorkerSkill(makeFeature())).not.toThrow();
		const skill = generateWorkerSkill(makeFeature());
		expect(skill).not.toContain("undefined");
	});

	it("handles empty relevant files list gracefully", () => {
		const feature = makeFeature({ relevantFiles: [] });
		const skill = generateWorkerSkill(feature);
		expect(skill).not.toContain("undefined");
		expect(skill).toContain("(none specified)");
	});

	describe("mission terminology exclusion (VAL-WORKER-002)", () => {
		for (const term of FORBIDDEN_TERMS) {
			it(`does not contain forbidden term '${term}'`, () => {
				const skill = generateWorkerSkill(makeFeature());
				expect(skill.toLowerCase()).not.toContain(term.toLowerCase());
			});
		}

		it("does not contain forbidden terms even when AGENTS.md is absent", () => {
			const skill = generateWorkerSkill(makeFeature());
			for (const term of FORBIDDEN_TERMS) {
				expect(skill.toLowerCase()).not.toContain(term.toLowerCase());
			}
		});

		it("does not contain forbidden terms even when AGENTS.md is present", () => {
			const agentsMd = "## Conventions\n\nFollow strict TypeScript conventions.";
			const skill = generateWorkerSkill(makeFeature(), agentsMd);
			for (const term of FORBIDDEN_TERMS) {
				expect(skill.toLowerCase()).not.toContain(term.toLowerCase());
			}
		});
	});
});

describe("generateWorkerPrompt", () => {
	it("includes feature description (VAL-WORKER-003)", () => {
		const prompt = generateWorkerPrompt(makeFeature());
		expect(prompt).toContain("Implement JWT-based authentication with refresh tokens.");
	});

	it("appends additionalContext when provided (VAL-WORKER-003)", () => {
		const extra = "Previous attempt failed because RS256 key was missing.";
		const prompt = generateWorkerPrompt(makeFeature(), extra);
		expect(prompt).toContain(extra);
		expect(prompt).toContain("Implement JWT-based authentication");
	});

	it("does not include additionalContext section when none provided", () => {
		const prompt = generateWorkerPrompt(makeFeature());
		expect(prompt).not.toContain("Additional Context");
	});

	it("returns a non-empty string", () => {
		const prompt = generateWorkerPrompt(makeFeature());
		expect(prompt.length).toBeGreaterThan(0);
	});
});

describe("generateWorkerContext", () => {
	it("returns AGENTS.md content when provided (VAL-WORKER-008)", () => {
		const agentsMd = "## Project Conventions\n\nTypescript strict mode.";
		const ctx = generateWorkerContext(agentsMd);
		expect(ctx).toContain("Typescript strict mode.");
	});

	it("returns empty string when AGENTS.md is absent (VAL-WORKER-008)", () => {
		const ctx = generateWorkerContext();
		expect(ctx).toBe("");
	});

	it("returns empty string when AGENTS.md is undefined", () => {
		const ctx = generateWorkerContext(undefined);
		expect(ctx).toBe("");
	});
});

describe("writeWorkerFiles", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "worker-prompt-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes files to correct runtime path (VAL-WORKER-004)", () => {
		writeWorkerFiles(tmpDir, "feat-123", 2, {
			skill: "skill content",
			prompt: "prompt content",
			context: "context content",
		});

		const skillContent = readFileSync(join(tmpDir, "runtime", "feat-123", "2", "worker-skill.md"), "utf8");
		const promptContent = readFileSync(join(tmpDir, "runtime", "feat-123", "2", "worker-prompt.md"), "utf8");
		const contextContent = readFileSync(join(tmpDir, "runtime", "feat-123", "2", "worker-context.md"), "utf8");

		expect(skillContent).toBe("skill content");
		expect(promptContent).toBe("prompt content");
		expect(contextContent).toBe("context content");
	});

	it("creates directories on demand", () => {
		expect(() =>
			writeWorkerFiles(join(tmpDir, "non-existent", "nested"), "feat-abc", 1, {
				skill: "s",
				prompt: "p",
				context: "c",
			}),
		).not.toThrow();
	});

	it("writes attempt 1 to runtime/<featureId>/1/ path", () => {
		writeWorkerFiles(tmpDir, "feat-456", 1, {
			skill: "s",
			prompt: "p",
			context: "c",
		});

		const skillContent = readFileSync(join(tmpDir, "runtime", "feat-456", "1", "worker-skill.md"), "utf8");
		expect(skillContent).toBe("s");
	});

	it("writes separate directories for different attempts", () => {
		writeWorkerFiles(tmpDir, "feat-789", 1, { skill: "attempt1", prompt: "p1", context: "c1" });
		writeWorkerFiles(tmpDir, "feat-789", 2, { skill: "attempt2", prompt: "p2", context: "c2" });

		const skill1 = readFileSync(join(tmpDir, "runtime", "feat-789", "1", "worker-skill.md"), "utf8");
		const skill2 = readFileSync(join(tmpDir, "runtime", "feat-789", "2", "worker-skill.md"), "utf8");

		expect(skill1).toBe("attempt1");
		expect(skill2).toBe("attempt2");
	});

	it("writes separate directories for different features", () => {
		writeWorkerFiles(tmpDir, "feat-A", 1, { skill: "featureA", prompt: "p", context: "c" });
		writeWorkerFiles(tmpDir, "feat-B", 1, { skill: "featureB", prompt: "p", context: "c" });

		const skillA = readFileSync(join(tmpDir, "runtime", "feat-A", "1", "worker-skill.md"), "utf8");
		const skillB = readFileSync(join(tmpDir, "runtime", "feat-B", "1", "worker-skill.md"), "utf8");

		expect(skillA).toBe("featureA");
		expect(skillB).toBe("featureB");
	});

	it("basePath uses .pi/missions/runtime/<featureId>/<attempt>/ structure when given a base like .pi/missions", () => {
		const fakeBase = join(tmpDir, ".pi", "missions");
		writeWorkerFiles(fakeBase, "feat-123", 2, {
			skill: "skill text",
			prompt: "prompt text",
			context: "ctx",
		});

		const skillContent = readFileSync(join(fakeBase, "runtime", "feat-123", "2", "worker-skill.md"), "utf8");
		expect(skillContent).toBe("skill text");
	});
});

describe("integration: generateWorkerSkill + writeWorkerFiles", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "worker-integration-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("generates skill without forbidden terms and writes to disk", () => {
		const feature = makeFeature();
		const agentsMd = "## Conventions\n\nUse TypeScript strict mode.";
		const skill = generateWorkerSkill(feature, agentsMd);
		const prompt = generateWorkerPrompt(feature);
		const context = generateWorkerContext(agentsMd);

		writeWorkerFiles(tmpDir, feature.id, 1, { skill, prompt, context });

		const writtenSkill = readFileSync(join(tmpDir, "runtime", feature.id, "1", "worker-skill.md"), "utf8");

		for (const term of FORBIDDEN_TERMS) {
			expect(writtenSkill.toLowerCase()).not.toContain(term.toLowerCase());
		}
		expect(writtenSkill).toContain("Add JWT authentication");
		expect(writtenSkill).toContain("Use TypeScript strict mode.");
	});

	it("retry attempt (attempt 2) written to separate directory", () => {
		const feature = makeFeature();
		const skill1 = generateWorkerSkill(feature);
		const skill2 = generateWorkerSkill(feature);
		const prompt2 = generateWorkerPrompt(feature, "Previous attempt failed due to missing RS256 key.");

		writeWorkerFiles(tmpDir, feature.id, 1, { skill: skill1, prompt: generateWorkerPrompt(feature), context: "" });
		writeWorkerFiles(tmpDir, feature.id, 2, { skill: skill2, prompt: prompt2, context: "" });

		const p1 = readFileSync(join(tmpDir, "runtime", feature.id, "1", "worker-prompt.md"), "utf8");
		const p2 = readFileSync(join(tmpDir, "runtime", feature.id, "2", "worker-prompt.md"), "utf8");

		expect(p1).not.toContain("Previous attempt failed");
		expect(p2).toContain("Previous attempt failed due to missing RS256 key.");
	});
});
