import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	generateWorkerContext,
	generateWorkerPrompt,
	generateWorkerSkill,
	writeWorkerFiles,
} from "../../extensions/orchestrator/worker-prompt.js";
import type { Feature } from "../../extensions/types.js";
import { createTempDir, makeFeature } from "../helpers/index.js";

const FORBIDDEN_TERMS = ["mission", "orchestrat", "milestone", "state.json", "plan.json", ".pi/missions"];

const JWT_OVERRIDES: Partial<Feature> = {
	id: "feat-123",
	name: "Add JWT authentication",
	description: "Implement JWT-based authentication with refresh tokens.",
	acceptanceCriteria: [
		"JWT signing with RS256 algorithm",
		"Token refresh endpoint implemented",
		"15m access token expiry, 7d refresh expiry",
	],
	relevantFiles: ["src/auth.ts", "src/middleware/verify.ts"],
	estimatedComplexity: "medium",
};

describe("generateWorkerSkill", () => {
	it("includes feature name in heading", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("Add JWT authentication");
	});

	it("includes feature description", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("Implement JWT-based authentication with refresh tokens.");
	});

	it("includes all acceptance criteria", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("JWT signing with RS256 algorithm");
		expect(skill).toContain("Token refresh endpoint implemented");
		expect(skill).toContain("15m access token expiry, 7d refresh expiry");
	});

	it("includes relevant files", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("src/auth.ts");
		expect(skill).toContain("src/middleware/verify.ts");
	});

	it("includes AGENTS.md conventions when provided (VAL-WORKER-001)", () => {
		const agentsMd = "## Conventions\n\nUse TypeScript strict mode.";
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), agentsMd);
		expect(skill).toContain("Use TypeScript strict mode.");
	});

	it("works without AGENTS.md (no error, no reference to missing file)", () => {
		expect(() => generateWorkerSkill(makeFeature(JWT_OVERRIDES))).not.toThrow();
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).not.toContain("undefined");
	});

	it("handles empty relevant files list gracefully", () => {
		const feature = makeFeature({ ...JWT_OVERRIDES, relevantFiles: [] });
		const skill = generateWorkerSkill(feature);
		expect(skill).not.toContain("undefined");
		expect(skill).toContain("(none specified)");
	});

	it("does NOT contain verbose Procedure section", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).not.toContain("## Procedure");
	});

	it("does NOT contain verbose Completion section", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).not.toContain("## Completion");
	});

	it("does NOT contain verbose focus instructions", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).not.toContain("Implement only what is described");
	});

	it("contains report_result tool instructions", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("report_result");
	});

	it("report_result instructions include whatWasImplemented field", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("whatWasImplemented");
	});

	it("report_result instructions include whatWasLeftUndone field", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("whatWasLeftUndone");
	});

	it("report_result instructions include commandsRun field", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("commandsRun");
	});

	it("report_result instructions include testsAdded field", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("testsAdded");
	});

	it("report_result instructions include discoveredIssues field", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("discoveredIssues");
	});

	it("contains verification commands section", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		expect(skill).toContain("## Verification");
	});

	it("default mode skill is at most 40 non-empty lines", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
		const nonEmptyLines = skill.split("\n").filter((l) => l.trim().length > 0);
		expect(nonEmptyLines.length).toBeLessThanOrEqual(40);
	});

	it("default mode skill with conventions is at most 40 non-empty lines", () => {
		const agentsMd = "## Conventions\n\nUse TypeScript strict mode.\nNo enums.";
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), agentsMd);
		const nonEmptyLines = skill.split("\n").filter((l) => l.trim().length > 0);
		expect(nonEmptyLines.length).toBeLessThanOrEqual(40);
	});

	describe("mission terminology exclusion (VAL-WORKER-002)", () => {
		for (const term of FORBIDDEN_TERMS) {
			it(`does not contain forbidden term '${term}'`, () => {
				const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
				expect(skill.toLowerCase()).not.toContain(term.toLowerCase());
			});
		}

		it("does not contain forbidden terms even when AGENTS.md is absent", () => {
			const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES));
			for (const term of FORBIDDEN_TERMS) {
				expect(skill.toLowerCase()).not.toContain(term.toLowerCase());
			}
		});

		it("does not contain forbidden terms even when AGENTS.md is present", () => {
			const agentsMd = "## Conventions\n\nFollow strict TypeScript conventions.";
			const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), agentsMd);
			for (const term of FORBIDDEN_TERMS) {
				expect(skill.toLowerCase()).not.toContain(term.toLowerCase());
			}
		});
	});
});

describe("generateWorkerSkill (caveman mode)", () => {
	it("includes feature name", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		expect(skill).toContain("Add JWT authentication");
	});

	it("includes feature description", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		expect(skill).toContain("Implement JWT-based authentication with refresh tokens.");
	});

	it("includes acceptance criteria", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		expect(skill).toContain("JWT signing with RS256 algorithm");
	});

	it("includes relevant files", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		expect(skill).toContain("src/auth.ts");
	});

	it("contains report_result tool instructions", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		expect(skill).toContain("report_result");
	});

	it("report_result includes whatWasImplemented field", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		expect(skill).toContain("whatWasImplemented");
	});

	it("report_result includes whatWasLeftUndone field", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		expect(skill).toContain("whatWasLeftUndone");
	});

	it("report_result includes commandsRun field", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		expect(skill).toContain("commandsRun");
	});

	it("report_result includes testsAdded field", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		expect(skill).toContain("testsAdded");
	});

	it("report_result includes discoveredIssues field", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		expect(skill).toContain("discoveredIssues");
	});

	it("caveman mode skill is at most 20 non-empty lines", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		const nonEmptyLines = skill.split("\n").filter((l) => l.trim().length > 0);
		expect(nonEmptyLines.length).toBeLessThanOrEqual(20);
	});

	it("caveman mode skill with conventions is at most 20 non-empty lines", () => {
		const agentsMd = "## Conventions\n\nUse strict mode.";
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), agentsMd, "caveman");
		const nonEmptyLines = skill.split("\n").filter((l) => l.trim().length > 0);
		expect(nonEmptyLines.length).toBeLessThanOrEqual(20);
	});

	it("caveman-full mode produces caveman output", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman-full");
		expect(skill).toContain("report_result");
		const nonEmptyLines = skill.split("\n").filter((l) => l.trim().length > 0);
		expect(nonEmptyLines.length).toBeLessThanOrEqual(20);
	});

	it("handles empty relevant files gracefully", () => {
		const feature = makeFeature({ ...JWT_OVERRIDES, relevantFiles: [] });
		const skill = generateWorkerSkill(feature, undefined, "caveman");
		expect(skill).not.toContain("undefined");
	});

	it("excludes forbidden terms", () => {
		const skill = generateWorkerSkill(makeFeature(JWT_OVERRIDES), undefined, "caveman");
		for (const term of FORBIDDEN_TERMS) {
			expect(skill.toLowerCase()).not.toContain(term.toLowerCase());
		}
	});
});

describe("generateWorkerPrompt", () => {
	it("includes feature description (VAL-WORKER-003)", () => {
		const prompt = generateWorkerPrompt(makeFeature(JWT_OVERRIDES));
		expect(prompt).toContain("Implement JWT-based authentication with refresh tokens.");
	});

	it("appends additionalContext when provided (VAL-WORKER-003)", () => {
		const extra = "Previous attempt failed because RS256 key was missing.";
		const prompt = generateWorkerPrompt(makeFeature(JWT_OVERRIDES), extra);
		expect(prompt).toContain(extra);
		expect(prompt).toContain("Implement JWT-based authentication");
	});

	it("does not include additionalContext section when none provided", () => {
		const prompt = generateWorkerPrompt(makeFeature(JWT_OVERRIDES));
		expect(prompt).not.toContain("Additional Context");
	});

	it("returns a non-empty string", () => {
		const prompt = generateWorkerPrompt(makeFeature(JWT_OVERRIDES));
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
	let tmp: ReturnType<typeof createTempDir>;

	beforeEach(() => {
		tmp = createTempDir("worker-prompt-test-");
	});

	afterEach(() => {
		tmp.cleanup();
	});

	it("writes files to correct runtime path (VAL-WORKER-004)", () => {
		writeWorkerFiles(tmp.path, "feat-123", 2, {
			skill: "skill content",
			prompt: "prompt content",
			context: "context content",
		});

		const skillContent = readFileSync(join(tmp.path, "runtime", "feat-123", "2", "worker-skill.md"), "utf8");
		const promptContent = readFileSync(join(tmp.path, "runtime", "feat-123", "2", "worker-prompt.md"), "utf8");
		const contextContent = readFileSync(join(tmp.path, "runtime", "feat-123", "2", "worker-context.md"), "utf8");

		expect(skillContent).toBe("skill content");
		expect(promptContent).toBe("prompt content");
		expect(contextContent).toBe("context content");
	});

	it("creates directories on demand", () => {
		expect(() =>
			writeWorkerFiles(join(tmp.path, "non-existent", "nested"), "feat-abc", 1, {
				skill: "s",
				prompt: "p",
				context: "c",
			}),
		).not.toThrow();
	});

	it("writes attempt 1 to runtime/<featureId>/1/ path", () => {
		writeWorkerFiles(tmp.path, "feat-456", 1, {
			skill: "s",
			prompt: "p",
			context: "c",
		});

		const skillContent = readFileSync(join(tmp.path, "runtime", "feat-456", "1", "worker-skill.md"), "utf8");
		expect(skillContent).toBe("s");
	});

	it("writes separate directories for different attempts", () => {
		writeWorkerFiles(tmp.path, "feat-789", 1, { skill: "attempt1", prompt: "p1", context: "c1" });
		writeWorkerFiles(tmp.path, "feat-789", 2, { skill: "attempt2", prompt: "p2", context: "c2" });

		const skill1 = readFileSync(join(tmp.path, "runtime", "feat-789", "1", "worker-skill.md"), "utf8");
		const skill2 = readFileSync(join(tmp.path, "runtime", "feat-789", "2", "worker-skill.md"), "utf8");

		expect(skill1).toBe("attempt1");
		expect(skill2).toBe("attempt2");
	});

	it("writes separate directories for different features", () => {
		writeWorkerFiles(tmp.path, "feat-A", 1, { skill: "featureA", prompt: "p", context: "c" });
		writeWorkerFiles(tmp.path, "feat-B", 1, { skill: "featureB", prompt: "p", context: "c" });

		const skillA = readFileSync(join(tmp.path, "runtime", "feat-A", "1", "worker-skill.md"), "utf8");
		const skillB = readFileSync(join(tmp.path, "runtime", "feat-B", "1", "worker-skill.md"), "utf8");

		expect(skillA).toBe("featureA");
		expect(skillB).toBe("featureB");
	});

	it("basePath uses .pi/missions/runtime/<featureId>/<attempt>/ structure when given a base like .pi/missions", () => {
		const fakeBase = join(tmp.path, ".pi", "missions");
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
	let tmp: ReturnType<typeof createTempDir>;

	beforeEach(() => {
		tmp = createTempDir("worker-integration-");
	});

	afterEach(() => {
		tmp.cleanup();
	});

	it("generates skill without forbidden terms and writes to disk", () => {
		const feature = makeFeature(JWT_OVERRIDES);
		const agentsMd = "## Conventions\n\nUse TypeScript strict mode.";
		const skill = generateWorkerSkill(feature, agentsMd);
		const prompt = generateWorkerPrompt(feature);
		const context = generateWorkerContext(agentsMd);

		writeWorkerFiles(tmp.path, feature.id, 1, { skill, prompt, context });

		const writtenSkill = readFileSync(join(tmp.path, "runtime", feature.id, "1", "worker-skill.md"), "utf8");

		for (const term of FORBIDDEN_TERMS) {
			expect(writtenSkill.toLowerCase()).not.toContain(term.toLowerCase());
		}
		expect(writtenSkill).toContain("Add JWT authentication");
		expect(writtenSkill).toContain("Use TypeScript strict mode.");
	});

	it("retry attempt (attempt 2) written to separate directory", () => {
		const feature = makeFeature(JWT_OVERRIDES);
		const skill1 = generateWorkerSkill(feature);
		const skill2 = generateWorkerSkill(feature);
		const prompt2 = generateWorkerPrompt(feature, "Previous attempt failed due to missing RS256 key.");

		writeWorkerFiles(tmp.path, feature.id, 1, {
			skill: skill1,
			prompt: generateWorkerPrompt(feature),
			context: "",
		});
		writeWorkerFiles(tmp.path, feature.id, 2, { skill: skill2, prompt: prompt2, context: "" });

		const p1 = readFileSync(join(tmp.path, "runtime", feature.id, "1", "worker-prompt.md"), "utf8");
		const p2 = readFileSync(join(tmp.path, "runtime", feature.id, "2", "worker-prompt.md"), "utf8");

		expect(p1).not.toContain("Previous attempt failed");
		expect(p2).toContain("Previous attempt failed due to missing RS256 key.");
	});
});
