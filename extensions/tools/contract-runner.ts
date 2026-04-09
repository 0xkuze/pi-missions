import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, saveContract } from "../state/manager.js";
import type { AssertionResultData, ValidationAssertion } from "../types.js";
import { nowISO } from "../utils.js";
import type { ExecFn } from "./run-validation.js";

export interface RunContractOptions {
	basePath: string;
	milestoneId: string;
	projectDir: string;
	timeoutMs?: number;
	milestoneFeatureIds?: string[];
	skippedFeatureIds?: Set<string>;
	blockedFeatureIds?: Set<string>;
	updateContract?: boolean;
}

const DEFAULT_TIMEOUT_MS = 120000;

function checkAssertion(
	assertion: ValidationAssertion,
	result: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean },
): "pass" | "fail" | "error" {
	if (result.timedOut) return "error";
	if (assertion.expect.exitCode !== undefined && result.exitCode !== assertion.expect.exitCode) return "fail";
	if (assertion.expect.stdoutContains !== undefined) {
		if (!result.stdout.includes(assertion.expect.stdoutContains)) return "fail";
	}
	if (assertion.expect.stdoutNotContains !== undefined) {
		if (result.stdout.includes(assertion.expect.stdoutNotContains)) return "fail";
	}
	if (assertion.expect.stderrContains !== undefined && !result.stderr.includes(assertion.expect.stderrContains))
		return "fail";
	return "pass";
}

function writeEvidenceFiles(basePath: string, milestoneId: string, result: AssertionResultData): void {
	const evidenceDir = join(basePath, "runtime", "validation", milestoneId, "assertions");
	mkdirSync(evidenceDir, { recursive: true });
	writeFileSync(join(evidenceDir, `${result.assertionId}-stdout.log`), result.stdout, "utf8");
	writeFileSync(join(evidenceDir, `${result.assertionId}-stderr.log`), result.stderr, "utf8");
	writeFileSync(join(evidenceDir, `${result.assertionId}-result.json`), JSON.stringify(result, null, 2), "utf8");
}

function shouldRunAssertion(
	assertion: ValidationAssertion,
	milestoneFeatureIds?: string[],
	skippedFeatureIds?: Set<string>,
	blockedFeatureIds?: Set<string>,
): boolean {
	if (milestoneFeatureIds && !milestoneFeatureIds.includes(assertion.featureId)) return false;
	if (skippedFeatureIds?.has(assertion.featureId)) return false;
	if (blockedFeatureIds?.has(assertion.featureId)) return false;
	return true;
}

export async function runContractAssertions(
	assertions: ValidationAssertion[],
	exec: ExecFn,
	options: RunContractOptions,
): Promise<AssertionResultData[]> {
	const {
		basePath,
		milestoneId,
		projectDir,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		milestoneFeatureIds,
		skippedFeatureIds,
		blockedFeatureIds,
		updateContract = false,
	} = options;

	const filtered = assertions.filter((a) =>
		shouldRunAssertion(a, milestoneFeatureIds, skippedFeatureIds, blockedFeatureIds),
	);

	const results: AssertionResultData[] = [];

	for (const assertion of filtered) {
		const start = Date.now();
		const execResult = await exec(assertion.command, projectDir, timeoutMs);
		const durationMs = Date.now() - start;
		const timestamp = nowISO();

		const status = checkAssertion(assertion, execResult);

		const result: AssertionResultData = {
			assertionId: assertion.id,
			status,
			exitCode: execResult.exitCode,
			stdout: execResult.stdout,
			stderr: execResult.stderr,
			timedOut: execResult.timedOut,
			durationMs,
			timestamp,
			command: assertion.command,
		};

		writeEvidenceFiles(basePath, milestoneId, result);
		results.push(result);
	}

	if (updateContract && results.length > 0) {
		const contract = loadContract(basePath);
		if (contract) {
			const statusMap = new Map(results.map((r) => [r.assertionId, r.status]));
			const updatedAssertions = contract.assertions.map((a) => ({
				...a,
				status: statusMap.get(a.id) ?? a.status,
			}));
			saveContract(basePath, { assertions: updatedAssertions });
		}
	}

	return results;
}
