import { describe, expect, it } from "bun:test";
import type { CommandDisplayEntry } from "../../extensions/ui/validation-view.js";
import { handleValidationViewKey, renderValidationView } from "../../extensions/ui/validation-view.js";

describe("renderValidationView (VAL-UI-008)", () => {
	describe("milestone name", () => {
		it("shows milestone name in header", () => {
			const lines = renderValidationView("Auth Core", [], false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Auth Core");
		});

		it("shows different milestone names correctly", () => {
			const lines = renderValidationView("Data Layer", [], false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Data Layer");
		});
	});

	describe("command status icons", () => {
		it("shows ✓ for passed commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "typecheck", status: "passed", durationMs: 2000 }];
			const lines = renderValidationView("Milestone", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("\u2713");
		});

		it("shows ● for running commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "test", status: "running" }];
			const lines = renderValidationView("Milestone", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("\u25cf");
		});

		it("shows ○ for pending commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "lint", status: "pending" }];
			const lines = renderValidationView("Milestone", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("\u25cb");
		});

		it("shows ✗ for failed commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "test", status: "failed", durationMs: 5000 }];
			const lines = renderValidationView("Milestone", commands, true, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("\u2717");
		});
	});

	describe("durations for completed commands", () => {
		it("shows duration for passed commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "typecheck", status: "passed", durationMs: 2500 }];
			const lines = renderValidationView("Milestone", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toMatch(/2s|2500/);
		});

		it("shows duration for failed commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "test", status: "failed", durationMs: 60000 }];
			const lines = renderValidationView("Milestone", commands, true, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toMatch(/1m|60/);
		});

		it("does not show duration for running commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "test", status: "running" }];
			const lines = renderValidationView("Milestone", commands, false, 80, undefined, 40);
			// Running commands should not show a duration value
			const testLine = lines.find((l) => l.includes("test"));
			expect(testLine).toBeDefined();
			expect(testLine).not.toMatch(/\(\d+[smh]/);
		});

		it("does not show duration for pending commands", () => {
			const commands: CommandDisplayEntry[] = [{ label: "lint", status: "pending" }];
			const lines = renderValidationView("Milestone", commands, false, 80, undefined, 40);
			const lintLine = lines.find((l) => l.includes("lint"));
			expect(lintLine).toBeDefined();
			expect(lintLine).not.toMatch(/\(\d+[smh]/);
		});
	});

	describe("all commands visible", () => {
		it("shows all commands regardless of status", () => {
			const commands: CommandDisplayEntry[] = [
				{ label: "typecheck", status: "passed", durationMs: 1000 },
				{ label: "test", status: "running" },
				{ label: "lint", status: "pending" },
			];
			const lines = renderValidationView("Milestone", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("typecheck");
			expect(text).toContain("test");
			expect(text).toContain("lint");
		});

		it("shows commands in order provided", () => {
			const commands: CommandDisplayEntry[] = [
				{ label: "typecheck", status: "passed", durationMs: 1000 },
				{ label: "lint", status: "passed", durationMs: 500 },
				{ label: "test", status: "running" },
				{ label: "build", status: "pending" },
			];
			const lines = renderValidationView("Milestone", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			const typecheckIdx = text.indexOf("typecheck");
			const lintIdx = text.indexOf("lint");
			const testIdx = text.indexOf("test");
			const buildIdx = text.indexOf("build");
			expect(typecheckIdx).toBeLessThan(lintIdx);
			expect(lintIdx).toBeLessThan(testIdx);
			expect(testIdx).toBeLessThan(buildIdx);
		});
	});

	describe("fix feature info on failure", () => {
		it("shows fix feature info when hasFailed is true", () => {
			const commands: CommandDisplayEntry[] = [{ label: "test", status: "failed", durationMs: 5000 }];
			const lines = renderValidationView("Milestone", commands, true, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text.toLowerCase()).toMatch(/fix feature|fix|failed/i);
		});

		it("does not show fix feature info when all passed", () => {
			const commands: CommandDisplayEntry[] = [{ label: "test", status: "passed", durationMs: 2000 }];
			const lines = renderValidationView("Milestone", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text.toLowerCase()).not.toMatch(/fix feature will be generated/);
		});
	});

	describe("empty commands", () => {
		it("handles empty commands list gracefully", () => {
			const lines = renderValidationView("Milestone", [], false, 80, undefined, 40);
			expect(lines.length).toBeGreaterThan(0);
		});

		it("shows no validation commands placeholder when empty", () => {
			const lines = renderValidationView("Milestone", [], false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text.toLowerCase()).toMatch(/no validation/i);
		});
	});

	describe("keyboard hint", () => {
		it("shows Esc hint", () => {
			const lines = renderValidationView("Milestone", [], false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("Esc");
		});
	});

	describe("real-time updates", () => {
		it("reflects mixed in-progress state correctly", () => {
			const commands: CommandDisplayEntry[] = [
				{ label: "typecheck", status: "passed", durationMs: 1500 },
				{ label: "test", status: "running" },
				{ label: "lint", status: "pending" },
			];
			const lines = renderValidationView("Milestone", commands, false, 80, undefined, 40);
			const text = lines.join("\n");
			expect(text).toContain("\u2713");
			expect(text).toContain("\u25cf");
			expect(text).toContain("\u25cb");
		});

		it("returns non-empty array of lines", () => {
			const lines = renderValidationView("Milestone", [], false, 80, undefined, 40);
			expect(lines.length).toBeGreaterThan(2);
		});
	});
});

describe("handleValidationViewKey (VAL-UI-008)", () => {
	it("returns close for Esc key", () => {
		const action = handleValidationViewKey("\x1B");
		expect(action.kind).toBe("close");
	});

	it("returns noop for unknown key", () => {
		const action = handleValidationViewKey("x");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for R key (no retry in validation view)", () => {
		const action = handleValidationViewKey("r");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for numeric keys", () => {
		const action = handleValidationViewKey("1");
		expect(action.kind).toBe("noop");
	});

	it("returns noop for enter key", () => {
		const action = handleValidationViewKey("\r");
		expect(action.kind).toBe("noop");
	});
});
