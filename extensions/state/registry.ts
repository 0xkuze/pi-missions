import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MissionPlan, MissionState } from "../types.js";

export interface MissionRegistryEntry {
	missionId: string;
	status: string;
	description: string;
	projectPath: string;
	startedAt: string;
	updatedAt: string;
	featuresTotal: number;
	featuresCompleted: number;
}

let registryPathOverride: string | null = null;

export function setRegistryPathForTesting(path: string | null): void {
	registryPathOverride = path;
}

function registryPath(): string {
	if (registryPathOverride) return registryPathOverride;
	return join(homedir(), ".pi", "missions", "registry.json");
}

function ensureDir(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
}

function atomicWrite(filePath: string, content: string): void {
	ensureDir(filePath);
	const tmp = `${filePath}.tmp`;
	writeFileSync(tmp, content, "utf8");
	renameSync(tmp, filePath);
}

export function loadRegistry(): MissionRegistryEntry[] {
	try {
		const raw = readFileSync(registryPath(), "utf8");
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed as MissionRegistryEntry[];
	} catch {
		return [];
	}
}

function saveRegistry(entries: MissionRegistryEntry[]): void {
	atomicWrite(registryPath(), JSON.stringify(entries, null, 2));
}

function countTotalFeatures(plan: MissionPlan | undefined): number {
	if (!plan) return 0;
	return plan.milestones.reduce((sum, m) => sum + m.features.length, 0);
}

export function updateRegistry(state: MissionState, projectPath: string, plan?: MissionPlan): void {
	const entries = loadRegistry();
	const existing = entries.findIndex((e) => e.missionId === state.missionId);

	const entry: MissionRegistryEntry = {
		missionId: state.missionId,
		status: state.status,
		description: plan?.description ?? "",
		projectPath,
		startedAt: state.startedAt,
		updatedAt: new Date().toISOString(),
		featuresTotal: countTotalFeatures(plan),
		featuresCompleted: state.totalFeaturesCompleted,
	};

	if (existing >= 0) {
		entries[existing] = entry;
	} else {
		entries.unshift(entry);
	}

	saveRegistry(entries);
}

export function removeFromRegistry(missionId: string): void {
	const entries = loadRegistry();
	const filtered = entries.filter((e) => e.missionId !== missionId);
	if (filtered.length !== entries.length) {
		saveRegistry(filtered);
	}
}
