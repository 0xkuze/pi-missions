import { resolvePromptingMode } from "../config.js";
import type { MissionConfig, MissionPlan, MissionState } from "../types.js";
import { TERMINAL_STATUSES } from "../types.js";
import { getCavemanOutputRule } from "./caveman-rules.js";

const CONTEXT_USAGE_COMPACT_THRESHOLD = 60;

function shouldBeCompact(compact?: boolean, turnCount?: number, contextUsagePercent?: number): boolean {
	return (
		!!compact ||
		(turnCount ?? 1) > 1 ||
		(contextUsagePercent !== undefined && contextUsagePercent > CONTEXT_USAGE_COMPACT_THRESHOLD)
	);
}

export interface ProtocolOptions {
	turnCount?: number;
	contextUsagePercent?: number;
}

const PROTOCOL_CACHE_MAX = 4;
const protocolCache: Array<{ key: string; value: string | null }> = [];

function protocolCacheKey(
	state: MissionState,
	plan?: MissionPlan,
	config?: MissionConfig,
	compact?: boolean,
	options?: ProtocolOptions,
): string {
	const autonomy = config?.autonomy ?? "medium";
	const mode = resolvePromptingMode(config ?? {});
	const pv = state.protocolVersion ?? 0;
	const tc = options?.turnCount ?? 1;
	const cu = options?.contextUsagePercent;
	return `${state.status}|${state.currentFeatureId ?? ""}|${state.currentMilestoneId ?? ""}|${plan?.planVersion ?? 0}|${autonomy}|${state.totalFeaturesCompleted}|${state.totalFeaturesSkipped}|${shouldBeCompact(compact, tc, cu) ? "c" : ""}|${mode}|pv${pv}|tc${tc <= 1 ? 1 : 2}|cu${cu ?? 0}`;
}

export function clearProtocolCache(): void {
	protocolCache.length = 0;
}

function autonomyInstructions(autonomy: MissionConfig["autonomy"]): string {
	switch (autonomy) {
		case "low":
			return "AUTONOMY: low \u2014 after each feature completes, STOP and wait for the user to confirm before proceeding to the next feature.";
		case "high":
			return "AUTONOMY: high \u2014 run the full plan to completion without pausing. Only stop on critical failures that cannot proceed without user input.";
		default:
			return "AUTONOMY: medium \u2014 pause at milestone boundaries and on failures. Proceed through features within a milestone automatically.";
	}
}

function planningProtocol(autonomy: MissionConfig["autonomy"]): string {
	return `## MISSION ORCHESTRATOR \u2014 PLANNING PHASE

### STEP 1: Codebase Analysis
Analyze the project thoroughly BEFORE asking the user anything.
Scan: package.json/requirements.txt/Cargo.toml, README, AGENTS.md, directory structure, existing test files, CI configs (.github/workflows), Docker files, linter configs.
Combine commands: \`ls src/ && cat package.json && head -20 tsconfig.json\`
Do NOT read implementation files. Summarize your findings to the user.

After analysis, you MUST populate the knowledge library using \`update_library\`:
- Write library/architecture.md with: system overview, component list (file paths + purpose), data flows, public API surface, key invariants. This document is read by every worker.
- Write library/conventions.md with coding conventions, naming patterns, and style rules discovered from AGENTS.md and existing code.
Do NOT call submit_plan until both architecture.md and conventions.md are written. Workers depend on this context.

### STEP 2: Multi-Round Questioning
Conduct at least TWO rounds of \`ask_questions\`. Do NOT submit_plan after a single round.

Round 1 \u2014 Scope & Requirements:
- Language/runtime, complexity level, testing requirements
- What does "done" look like? What are the deliverables?
- Infrastructure needs: services, ports, databases, Docker, CI/CD

Round 2 \u2014 Architecture & Detail:
- How many milestones? What are the validation checkpoints?
- Architecture preferences: patterns, frameworks, libraries
- Edge cases, error handling, non-functional requirements (performance, security)
- Any existing code or conventions to follow?

Ask more rounds if scope is unclear. Only proceed to planning when the user confirms they have no more requirements.
Challenge vague goals. Push back on scope creep. Split large features.

### STEP 3: Environment Setup
Before submitting the plan, use \`configure_environment\` to set up services, ports, and env vars if the project needs them.
Check for port conflicts. Document infrastructure requirements in the plan description.

### STEP 4: Detailed Plan Construction
Each feature description must be a detailed specification:
- List every file to create/modify with the expected contents (functions, classes, types)
- List every test to write with specific test cases
- List commands to verify the feature works (these become validation assertions)
- Acceptance criteria must be testable commands, not vague goals
- Assertion commands that run code (e.g., CLI tools) must target the actual executable entry point (bin script or main file that auto-runs), NOT library files that only export functions. Prefer testing built outputs (node dist/bin.js) over source files (npx tsx src/lib.ts).

When defining milestones, set \`validationCommands\` per milestone when the default commands don't apply.
Each milestone's validationCommands MUST be runnable using ONLY the code that exists after that milestone completes. Do NOT write curl/HTTP commands for milestones that don't create servers. Use unit test commands for library milestones.
Group features into milestones that represent validation checkpoints.
Do NOT create setup-only milestones (project init, config). Include setup as the first feature of the first implementation milestone.
Each feature should be small enough for one worker to complete in under 30 minutes of wall time.

Only call \`submit_plan\` when you are confident every feature has clear, testable acceptance criteria.
The plan is the most important part of the mission. A bad plan produces bad results. Spend time getting it right.
If submit_plan fails validation, read the error message carefully, fix the missing or invalid fields, and resubmit. Do not omit required fields like validationCommands.

${autonomyInstructions(autonomy)}`;
}

function draftReviewProtocol(): string {
	return `## MISSION ORCHESTRATOR \u2014 DRAFT REVIEW

Plan submitted. The plan is awaiting user approval through the Mission Control UI (Ctrl+Shift+M \u2192 A).
A session resume does NOT mean approval.
Do NOT call start_milestone or spawn_worker.
Do NOT self-approve.
Wait for the user to approve through the UI.
You may refine the plan via \`submit_plan\` if the user requests changes.`;
}

function approvedProtocol(plan: MissionPlan | undefined): string {
	const description = plan?.description ?? "(no description)";
	const totalFeatures = plan?.milestones.flatMap((m) => m.features).length ?? 0;
	const totalMilestones = plan?.milestones.length ?? 0;
	return `## MISSION ORCHESTRATOR \u2014 APPROVED

MISSION: ${description}
SCOPE: ${totalMilestones} milestones, ${totalFeatures} features

Plan approved. Call \`spawn_worker\` for the first feature now.
On worker failure, use \`create_fix_feature\` instead of debugging yourself.`;
}

function progressSummary(state: MissionState, plan: MissionPlan | undefined): string {
	const allFeatures = plan?.milestones.flatMap((m) => m.features) ?? [];
	const allMilestones = plan?.milestones ?? [];

	const completedFeatures = state.totalFeaturesCompleted + state.totalFeaturesSkipped;
	const totalFeatures = allFeatures.length;
	const currentMilestoneIndex = allMilestones.findIndex((m) => m.id === state.currentMilestoneId) + 1;
	const totalMilestones = allMilestones.length;

	const currentMilestone = allMilestones.find((m) => m.id === state.currentMilestoneId);
	const currentMilestoneName = currentMilestone?.name ?? state.currentMilestoneId ?? "(unknown)";

	const currentFeature = allFeatures.find((f) => f.id === state.currentFeatureId);
	const currentFeatureName = currentFeature?.name ?? state.currentFeatureId ?? "(none)";

	const currentFeatureIndex = allFeatures.findIndex((f) => f.id === state.currentFeatureId) + 1;

	const nextPendingFeature =
		currentMilestone?.features.find((f) => f.status === "pending" && f.id !== state.currentFeatureId) ??
		allFeatures.find((f) => f.status === "pending" && f.id !== state.currentFeatureId);
	const nextFeatureName = nextPendingFeature?.name ?? "(no more features)";

	return `Milestone ${currentMilestoneIndex > 0 ? currentMilestoneIndex : "?"}/${totalMilestones > 0 ? totalMilestones : "?"}: ${currentMilestoneName}
Feature ${currentFeatureIndex > 0 ? currentFeatureIndex : "?"}/${totalFeatures > 0 ? totalFeatures : "?"}: ${currentFeatureName}
Next: ${nextFeatureName}
Progress: ${completedFeatures}/${totalFeatures} features done`;
}

function buildPlanContext(state: MissionState, plan: MissionPlan | undefined): string {
	if (!plan) return "";
	const allMilestones = plan.milestones;
	const allFeatures = allMilestones.flatMap((m) => m.features);
	const currentMilestone = allMilestones.find((m) => m.id === state.currentMilestoneId);
	const currentFeature = allFeatures.find((f) => f.id === state.currentFeatureId);

	const lines: string[] = [];

	lines.push("## MILESTONES");
	for (const ms of allMilestones) {
		if (ms.id === state.currentMilestoneId) {
			const done = ms.features.filter((f) => f.status === "done" || f.status === "skipped").length;
			lines.push(`  ${ms.name}: active (${done}/${ms.features.length} done)`);
		} else if (ms.status === "done") {
			lines.push(`  ${ms.name}: done`);
		} else {
			lines.push(`  ${ms.name}: ${ms.features.length} features`);
		}
	}

	if (currentMilestone) {
		lines.push("");
		lines.push(`## ${currentMilestone.name} FEATURES`);
		for (const f of currentMilestone.features) {
			lines.push(`  ${f.name}: ${f.status}`);
		}
	}

	if (currentFeature) {
		lines.push("");
		lines.push("## CURRENT FEATURE");
		lines.push(`  ${currentFeature.name}: ${currentFeature.description}`);
		for (const c of currentFeature.acceptanceCriteria) {
			lines.push(`  - ${c}`);
		}
	}

	return lines.join("\n");
}

function gitWarnings(state: MissionState): string {
	if (!state.gitSnapshot) return "";
	const warnings: string[] = [];
	if (!state.gitSnapshot.autoCommitEnabled) {
		warnings.push("WARNING: Dirty repo detected \u2014 auto-commit is disabled.");
	}
	if (warnings.length === 0) return "";
	return `\n${warnings.join("\n")}`;
}

function executingProtocol(
	state: MissionState,
	plan: MissionPlan | undefined,
	autonomy: MissionConfig["autonomy"],
): string {
	const progress = progressSummary(state, plan);
	const warnings = gitWarnings(state);
	const planContext = buildPlanContext(state, plan);
	return `## MISSION ORCHESTRATOR \u2014 EXECUTING

${progress}${warnings}

${planContext}

You are a project manager, not an implementer. Never read implementation files, edit code, or run tests. Delegate all implementation to workers.
During EXECUTION: do NOT use \`edit\` or \`write\`. All code changes MUST go through workers via \`spawn_worker\`.
NEVER read files under \`.pi/missions/\`. Your mission tools provide all state awareness you need.
On failure: call create_fix_feature, then spawn_worker for the fix. Do not debug yourself.
IMPORTANT: If the spawn_worker result says "Self-correction already created fix feature", do NOT call create_fix_feature again. Spawn the fix feature directly.
NEVER use bash + complete_feature to force-complete a failed worker. complete_feature WILL REJECT if the last worker attempt failed unless a fix feature already resolved the issue.
Git commits happen automatically after successful workers.
Workers are SEQUENTIAL. Call spawn_worker for ONE feature, wait for the result, then call spawn_worker for the next. Never call spawn_worker more than once per turn.
Milestones auto-complete when all features finish. After a milestone auto-completes, call run_validation for that milestone.
Skip run_validation for setup-only milestones (no source code yet — typecheck and tests will fail trivially).
When ALL features across ALL milestones are done (no pending/active features remain), call complete_mission immediately with a summary.
Communicate progress concisely after each feature completes: what was done, what is next.
Match the user's configured output style. No emoji, no filler, no pleasantries unless the user's style uses them.
CODE REVIEW: For complex features that touch many files or introduce architecture, use create_fix_feature to add a review feature AFTER the implementation feature completes. The review feature worker reads the changed files and checks: code reusability, simplicity, no comments in code, proper error handling, follows AGENTS.md conventions, minimal and performant. Only for substantial changes — skip for trivial features.

SCRUTINY: After run_validation returns status "pass" for a milestone, call run_scrutiny for that milestone. The scrutiny reviewer checks for architectural issues, cross-feature gaps, duplication, and convention violations. If scrutiny finds error-severity issues, create fix features addressing them. Warning/info issues can be noted but do not require fixes. If validation fails, skip scrutiny — fix validation failures first. If run_scrutiny returns a model error (model not available), ask the user to select a reviewer model using ask_questions, then retry run_scrutiny. Do NOT skip scrutiny for subsequent milestones just because it failed once — always attempt it for each milestone.

VERIFIED WORK COMPLETION: When a worker fails (e.g., didn't call report_result) but you verify the work was actually done (files changed, tests pass, correct behavior via bash/read checks), use \`update_mission_state\` with action \`complete_feature\` (NOT \`skip_feature\`) to mark the feature as completed. This ensures totalFeaturesCompleted is accurate. Use \`skip_feature\` only for features that should genuinely be skipped (not needed, out of scope).

WORKER HANDOFF: After spawn_worker succeeds, read the result carefully. It includes:
- "Worker reported left undone: ..." — what the worker says it did NOT finish.
- "Discovered issues: ..." — bugs or problems the worker found.
YOU decide whether to create a fix feature based on this info. If "left undone" describes work that is genuinely part of this feature's scope and was not completed, create a fix feature. If it describes work that belongs to OTHER features (e.g., "no CLI entry point" when this feature was about config), ignore it — that work is planned elsewhere. Only create fix features for real gaps, not for out-of-scope items the worker mentions for completeness.

RETRY AND STUCK FEATURE HANDLING:
- Feature fails once \u2192 retry with spawn_worker for the same feature (fresh attempt).
- Feature fails twice \u2192 create a targeted fix feature addressing the specific failure.
- Feature exhausts retries (3x) \u2192 mark blocked, inform user clearly what went wrong and why.
- Feature stuck as 'active' after worker completed but state wasn't updated \u2192 use complete_feature if work is verified, or skip_feature if genuinely abandoned.
- After a fix feature completes successfully, move on to the next pending feature. Do not re-retry the original failed feature.
- Validation fails \u2192 analyze the failing output, create targeted fix features, re-validate after fixes. NEVER call complete_mission after a validation failure without fixing and re-validating first.
- User sends a redirect message \u2192 pause current plan, acknowledge the new direction, re-plan if scope changed.
- All features done but validation still fails \u2192 do NOT mark mission complete. Fix first. Create fix features for every failing check.
- If blocked and unsure \u2192 ask the user. Do not spin.

CRITICAL: Do NOT call complete_mission if run_validation returned any failing checks. You MUST create fix features and re-validate until all checks pass.

${autonomyInstructions(autonomy)}`;
}

function validatingProtocol(): string {
	return `## MISSION ORCHESTRATOR \u2014 VALIDATING

Validation in progress. Do NOT start new workers. Wait for results, then proceed or create fix features.`;
}

function pausedProtocol(): string {
	return `## MISSION PAUSED

The mission has been paused by the user. Stop all work and wait for the user to resume.`;
}

function cavemanPlanning(): string {
	return `## CAVEMAN ORCHESTRATOR \u2014 PLANNING

You plan maker. Follow order:
1. Look package.json, README, AGENTS.md, dirs. NO read code files. Summarize findings.
2. ask_questions Round 1 \u2014 scope, language, complexity, tests, infrastructure
3. ask_questions Round 2 \u2014 milestones count, architecture, edge cases, non-functional reqs
4. More rounds if scope unclear. User must confirm "no more requirements" before plan.
5. configure_environment if project needs services/ports
6. submit_plan \u2014 detailed milestones, features with file lists, testable criteria

NO submit_plan before 2 rounds of ask_questions. NO read .ts/.js/.py files.
Feature descriptions: list files, functions, tests, verification commands. Criteria = testable commands.`;
}

function cavemanExecuting(state: MissionState, plan: MissionPlan | undefined): string {
	const progress = progressSummary(state, plan);
	const warnings = gitWarnings(state);
	return `## CAVEMAN ORCHESTRATOR \u2014 EXECUTING

${progress}${warnings}

You boss. No touch code. spawn_worker do work. ONE worker at a time. Wait result before next spawn.
Worker fail? create_fix_feature then spawn_worker again. NEVER use bash + complete_feature to force-complete. complete_feature REJECTS if last worker failed unless a fix feature resolved it. Using force=true without a fix feature is a protocol violation.
Worker done? Read result. If "left undone" = stuff from THIS feature not done, create_fix_feature. If "left undone" = other features' work, ignore. Only fix real gaps.
Big feature done? create_fix_feature for code review — worker reads changed files, checks quality, simplicity, no comments, error handling, AGENTS.md rules. Skip review for trivial features.
All features done? run_validation. Validation fail? create_fix_feature, spawn_worker, run_validation again. NEVER complete_mission with failing checks.
Validation pass? run_scrutiny. Scrutiny find error issues? create_fix_feature, fix, re-validate. Warning/info? note, move on. Scrutiny model error? ask user to pick reviewer model, retry. ALWAYS attempt scrutiny for each milestone.
All milestones done AND validation pass? complete_mission. Go.`;
}

function cavemanDraftReview(): string {
	return `## CAVEMAN \u2014 DRAFT REVIEW\n\nPlan ready. Wait user approve via Mission Control (Ctrl+Shift+M \u2192 A). Resume does NOT mean approval. No call start_milestone. No call spawn_worker. Wait.`;
}

function cavemanApproved(plan: MissionPlan | undefined): string {
	const total = plan?.milestones.flatMap((m) => m.features).length ?? 0;
	return `## CAVEMAN \u2014 APPROVED\n\n${total} features ready. Start: spawn_worker. Milestones auto-managed. Go.`;
}

function cavemanValidating(): string {
	return `## CAVEMAN \u2014 VALIDATING\n\nValidation running. Wait. No spawn workers.`;
}

function cavemanPaused(): string {
	return `## CAVEMAN \u2014 PAUSED\n\nUser pause. Stop. Wait.`;
}

export function buildCompactMissionSummary(state: MissionState, plan?: MissionPlan): string {
	const allFeatures = plan?.milestones.flatMap((m) => m.features) ?? [];
	const total = allFeatures.length;
	const done = state.totalFeaturesCompleted + state.totalFeaturesSkipped;
	const failed = state.totalFeaturesFailed;
	const currentFeature = allFeatures.find((f) => f.id === state.currentFeatureId)?.name ?? "none";
	const currentMilestone = plan?.milestones.find((m) => m.id === state.currentMilestoneId)?.name ?? "none";
	return `MISSION STATE: ${state.status}, Progress: ${done}/${total} features done (${failed} failed), Current: ${currentFeature} in milestone ${currentMilestone}. Continue executing the mission plan.`;
}

export function buildOrchestratorProtocol(
	state: MissionState | null,
	plan?: MissionPlan,
	config?: MissionConfig,
	compact?: boolean,
	options?: ProtocolOptions,
): string | null {
	if (!state) return null;
	if (TERMINAL_STATUSES.has(state.status)) return null;

	const key = protocolCacheKey(state, plan, config, compact, options);
	const cached = protocolCache.find((e) => e.key === key);
	if (cached) {
		return cached.value;
	}

	const autonomy = config?.autonomy ?? "medium";
	const mode = resolvePromptingMode(config ?? {});
	const turnCount = options?.turnCount ?? 1;
	const contextPercent = options?.contextUsagePercent;
	const isCompact = shouldBeCompact(compact, turnCount, contextPercent);
	let result: string | null;

	if (isCompact && state.status === "executing") {
		result = buildCompactMissionSummary(state, plan);
	} else if (mode === "caveman" || mode === "caveman-full") {
		switch (state.status) {
			case "planning":
				result = cavemanPlanning();
				break;
			case "draft_review":
				result = cavemanDraftReview();
				break;
			case "approved":
				result = cavemanApproved(plan);
				break;
			case "executing":
				result = cavemanExecuting(state, plan);
				break;
			case "validating":
				result = cavemanValidating();
				break;
			case "paused":
				result = cavemanPaused();
				break;
			default:
				result = null;
				break;
		}
	} else {
		switch (state.status) {
			case "planning":
				result = planningProtocol(autonomy);
				break;
			case "draft_review":
				result = draftReviewProtocol();
				break;
			case "approved":
				result = approvedProtocol(plan);
				break;
			case "executing":
				result = executingProtocol(state, plan, autonomy);
				break;
			case "validating":
				result = validatingProtocol();
				break;
			case "paused":
				result = pausedProtocol();
				break;
			default:
				result = null;
				break;
		}
	}

	if (result !== null) {
		const pv = state.protocolVersion;
		if (pv !== undefined && pv > 0) {
			result = `[protocol:v${pv}]\n${result}`;
		}
		const outputRule = getCavemanOutputRule(mode);
		if (outputRule) {
			result = `${result}\n\n${outputRule}`;
		}
	}

	if (protocolCache.length >= PROTOCOL_CACHE_MAX) {
		protocolCache.shift();
	}
	protocolCache.push({ key, value: result });
	return result;
}
