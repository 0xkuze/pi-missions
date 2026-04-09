import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getDefaultGlobalConfig,
	isOnboardingCompleted,
	loadGlobalConfig,
	saveGlobalConfig,
	setGlobalConfigPathForTesting,
} from "../../extensions/state/global-config.js";
import type { GlobalConfig } from "../../extensions/types.js";

let tmpDir: string;
let configPath: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "pi-global-config-test-"));
	configPath = join(tmpDir, "global-config.json");
	setGlobalConfigPathForTesting(configPath);
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	setGlobalConfigPathForTesting(null);
});

describe("loadGlobalConfig", () => {
	it("returns null when no file exists", () => {
		expect(loadGlobalConfig()).toBeNull();
	});

	it("returns parsed config when file exists", () => {
		const config: GlobalConfig = {
			models: {
				orchestrator: "anthropic/claude-opus-4-6",
				worker: "opencode-go/glm-5",
				validator: "anthropic/claude-opus-4-6",
			},
			promptingMode: "caveman",
			spawnAndLearn: true,
			onboardingCompleted: true,
		};
		writeFileSync(configPath, JSON.stringify(config));
		const loaded = loadGlobalConfig();
		expect(loaded).not.toBeNull();
		expect(loaded!.models!.orchestrator).toBe("anthropic/claude-opus-4-6");
		expect(loaded!.promptingMode).toBe("caveman");
		expect(loaded!.spawnAndLearn).toBe(true);
		expect(loaded!.onboardingCompleted).toBe(true);
	});

	it("returns null for corrupted JSON", () => {
		writeFileSync(configPath, "not valid json{{{");
		expect(loadGlobalConfig()).toBeNull();
	});

	it("returns null for invalid schema", () => {
		writeFileSync(configPath, JSON.stringify({ promptingMode: "invalid-mode" }));
		expect(loadGlobalConfig()).toBeNull();
	});

	it("accepts partial config (all fields optional)", () => {
		writeFileSync(configPath, JSON.stringify({ promptingMode: "default" }));
		const loaded = loadGlobalConfig();
		expect(loaded).not.toBeNull();
		expect(loaded!.promptingMode).toBe("default");
	});

	it("accepts empty object", () => {
		writeFileSync(configPath, JSON.stringify({}));
		const loaded = loadGlobalConfig();
		expect(loaded).not.toBeNull();
	});
});

describe("saveGlobalConfig", () => {
	it("writes config to disk", () => {
		const config: GlobalConfig = {
			models: { worker: "test-model" },
			promptingMode: "caveman",
			spawnAndLearn: false,
			onboardingCompleted: true,
		};
		saveGlobalConfig(config);
		const loaded = loadGlobalConfig();
		expect(loaded).not.toBeNull();
		expect(loaded!.models!.worker).toBe("test-model");
		expect(loaded!.promptingMode).toBe("caveman");
		expect(loaded!.onboardingCompleted).toBe(true);
	});

	it("creates parent directories on demand", () => {
		const nested = join(tmpDir, "a", "b", "c", "config.json");
		setGlobalConfigPathForTesting(nested);
		saveGlobalConfig({ onboardingCompleted: true });
		setGlobalConfigPathForTesting(nested);
		const loaded = loadGlobalConfig();
		expect(loaded).not.toBeNull();
		expect(loaded!.onboardingCompleted).toBe(true);
	});

	it("overwrites existing config", () => {
		saveGlobalConfig({ promptingMode: "default" });
		saveGlobalConfig({ promptingMode: "caveman" });
		const loaded = loadGlobalConfig();
		expect(loaded!.promptingMode).toBe("caveman");
	});
});

describe("isOnboardingCompleted", () => {
	it("returns false when no config exists", () => {
		expect(isOnboardingCompleted()).toBe(false);
	});

	it("returns false when onboardingCompleted is not set", () => {
		saveGlobalConfig({ promptingMode: "default" });
		expect(isOnboardingCompleted()).toBe(false);
	});

	it("returns false when onboardingCompleted is false", () => {
		saveGlobalConfig({ onboardingCompleted: false });
		expect(isOnboardingCompleted()).toBe(false);
	});

	it("returns true when onboardingCompleted is true", () => {
		saveGlobalConfig({ onboardingCompleted: true });
		expect(isOnboardingCompleted()).toBe(true);
	});
});

describe("getDefaultGlobalConfig", () => {
	it("returns caveman prompting mode by default", () => {
		const config = getDefaultGlobalConfig();
		expect(config.promptingMode).toBe("caveman");
	});

	it("returns spawn and learn enabled by default", () => {
		const config = getDefaultGlobalConfig();
		expect(config.spawnAndLearn).toBe(true);
	});

	it("returns default models", () => {
		const config = getDefaultGlobalConfig();
		expect(config.models!.orchestrator).toBe("anthropic/claude-opus-4-6");
		expect(config.models!.worker).toBe("opencode-go/glm-5");
		expect(config.models!.validator).toBe("anthropic/claude-opus-4-6");
	});

	it("returns onboardingCompleted false", () => {
		const config = getDefaultGlobalConfig();
		expect(config.onboardingCompleted).toBe(false);
	});
});
