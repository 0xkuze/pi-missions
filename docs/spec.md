# pi-missions — Technical Specification v3

## Overview

`pi-missions` is a Factory AI Missions-inspired orchestration extension for pi. The user describes a large goal, collaborates with an LLM-driven orchestrator to create a structured plan, approves that plan, and the system executes work through isolated worker processes with validation checkpoints and real-time mission control.

This specification supersedes v2. It incorporates findings from:

- Factory AI Droid's actual Missions product behavior and documentation
- Pi's extension API capabilities and limitations (ExtensionAPI, tools, events, UI)
- Architectural analysis of the itisbryan/pi-missions reference implementation
- Explicit design decisions made during the planning phase

---

## Design Decisions Record

These decisions were made explicitly and are not open for re-evaluation during implementation.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Worker execution | Real spawned pi processes (`pi --mode json -p --no-session`) | True isolation, clean context per feature, structured results. Matches Droid. |
| State persistence | Filesystem primary (`.pi/missions/`) + session entry cache | Survives session switches, externally inspectable, fast UI restore. |
| Plan creation | Custom LLM tool (`submit_plan`) | Machine-parseable, reliable. No regex or structured output parsing. |
| Execution loop | LLM-driven orchestrator with mission-specific tools | Orchestrator LLM decides what to do. Extension provides tools it calls. |
| Starting point | From scratch | itisbryan architecture (single-session, regex detection) is incompatible. |
| Scope | All 4 implementation phases | Full system including mission control overlay, all views, reporting. |
| Orchestrator tools | Full mission toolset + standard pi tools (read, bash, edit, write) | Orchestrator needs codebase access for planning and decision-making. |
| Worker spawning | Blocking `spawn_worker` tool | Tool blocks until worker process completes and returns WorkerResult. |
| Validation trigger | Orchestrator tool call (`run_validation`) | Consistent with LLM-driven design. Orchestrator sees results and decides. |
| Worker tools | Standard pi tools (read, bash, edit, write) | Workers are full coding agents, scoped by prompt/skill. |
| Mission Control UI | Full custom TUI overlay with pi-tui components | Multi-panel layout with keyboard shortcuts. |
| Model config | Config file defaults + planning confirmation + runtime changes | Flexible, user-friendly, progressive disclosure. |

---

## Product Goals

The extension provides:

1. A planning-first workflow where the LLM orchestrator converses with the user, analyzes the codebase, and proposes a structured plan
2. A structured mission model: milestones containing features, with validation at milestone boundaries
3. Real isolated worker execution per feature via spawned pi processes
4. Validation at milestone boundaries via orchestrator-triggered commands
5. User intervention: pause, resume, skip, redirect, re-plan, model switching
6. Resume-safe persistence via filesystem state files with session entry caching
7. A mission control TUI overlay that makes long-running work visible and controllable

The extension does not rely on regex parsing of LLM output for state transitions. All state changes flow through explicit tool calls made by the orchestrator LLM.

---

## How Droid Missions Works (Reference)

Factory AI's Droid Missions, the system we are replicating, works as follows:

1. User runs `/enter-mission` and describes a goal
2. Droid conducts a **conversational planning phase** -- asks clarifying questions, probes constraints, iterates on scope. Not a one-shot questionnaire.
3. Droid produces a **structured plan**: features organized into milestones
4. User **approves** the plan
5. Droid enters **Mission Control** and begins execution
6. Each feature gets a **fresh worker session** with clean context
7. **Validation workers** run at milestone boundaries (tests, lint, typecheck, and optionally computer-use for visual QA)
8. Orchestrator creates **fix features** when validation fails
9. User acts as **project manager**: monitoring, unblocking, redirecting
10. **Multi-model**: different models for orchestrator, workers, validators
11. **Skill-aware**: existing skills leveraged, new ones developed during planning
12. **Config inheritance**: MCP, skills, hooks, AGENTS.md carry into missions
13. **Duration profile**: median ~2 hours, 14% run >24 hours, longest 16 days
14. **Cost heuristic**: `total_runs ~ #features + 2 * #milestones`

Our implementation preserves this core interaction model while fitting into pi's terminal extension architecture.

---

## Core Architecture

### The Orchestrator is the Main Session LLM

The orchestrator is not a separate process or code module. It is the main pi session's LLM, augmented with mission-specific tools via the extension's `registerTool` API. The extension injects an orchestrator protocol into the system prompt via the `before_agent_start` event.

When the user starts a mission, the orchestrator LLM:

- Analyzes the codebase using standard pi tools (read, bash, grep)
- Asks the user clarifying questions via normal conversation
- Submits a structured plan by calling the `submit_plan` tool
- After approval, drives execution by calling `spawn_worker`, `run_validation`, `commit_changes`, etc.
- Makes decisions about retries, fix features, re-planning, and completion

The extension provides the tools. The LLM decides when and how to use them.

### Workers are Isolated Pi Processes

Each feature is executed by a separate pi process spawned via `node:child_process`:

```
spawn("pi", [
  "--mode", "json",
  "-p",
  "--no-session",
  "--model", workerModelId,
  "--skill", workerSkillPath,
  "--append-system-prompt", workerContextPath,
  featurePrompt
])
```

Workers get standard pi tools (read, bash, edit, write) and operate on the project working directory. They are full coding agents scoped to a single feature through their prompt and skill.

Workers do not know about missions, milestones, or mission directories. They receive a task description and execute it.

The pi binary path is resolved using the same pattern as pi's subagent example: `getPiInvocation()` from `@mariozechner/pi-coding-agent` or by resolving `process.argv[0]` / `process.execPath`. The exact mechanism depends on the pi version available at implementation time.

### Validation is Command Execution

Validation runs shell commands (typecheck, lint, test, build) via the extension's `exec()` API. No LLM is needed for validation in v1. The orchestrator LLM calls `run_validation(milestoneId)`, the extension runs the commands and returns structured results, and the orchestrator decides what to do with failures.

### Persistence is Filesystem-First

The canonical sources of truth are files under `.pi/missions/`:

- `plan.json` — mission structure, milestones, features
- `state.json` — current lifecycle state, progress counters
- `config.json` — user configuration, model assignments, validation commands
- `plan-history.jsonl` — append-only plan mutation log
- `lock` — advisory file lock (via `proper-lockfile`)
- `active-session.json` — lock metadata (session ID, timestamps)
- `report.md` — final human-readable report

Session entries (`pi.appendEntry`) serve as a fast-restore cache for UI state within a session. On session start, the extension checks `.pi/missions/state.json` first. If it exists and is valid, state is loaded from disk. Session entries are written alongside filesystem writes for widget restoration after `/compact`.

### Why Not Session Entries as Primary Store

Session entries are tied to a single session file. If the user starts a new session in the same repo, session entries from the previous session are not available. Filesystem state survives across sessions, can be inspected with standard tools, and serves as the unambiguous source of truth.

### Why Not Regex Detection

The v1/itisbryan approach detects phase transitions by pattern-matching LLM output text. This is fundamentally fragile:

- LLMs phrase things unpredictably
- A missed detection silently stalls the mission
- A false positive advances state incorrectly
- It couples state management to natural language, violating the spec's own principle

With LLM-driven orchestrator tools, all state transitions are explicit tool calls. The extension knows exactly when state changes because it implements the tool that changes it.

---

## Mission Lifecycle

### State Machine

```
idle
  -> planning         (user runs /mission <description>)
  -> draft_review     (orchestrator calls submit_plan)
  -> approved         (user runs /mission-approve or approves in conversation)
  -> executing        (orchestrator calls spawn_worker for first feature)
  -> validating       (orchestrator calls run_validation)
  -> paused           (user pauses; overlay state with resumeTargetState)
  -> completed        (orchestrator calls complete_mission)
  -> failed           (unrecoverable error)
  -> aborted          (user runs /mission-reset or aborts)
```

### State Definitions

| State | Definition |
|-------|------------|
| `idle` | No active mission in the current repository |
| `planning` | Orchestrator LLM is analyzing the codebase and conversing with user |
| `draft_review` | A concrete plan exists (plan.json written) and awaits approval |
| `approved` | Plan approved, orchestrator may begin execution. Transient state -- orchestrator immediately proceeds to call `spawn_worker` |
| `executing` | A worker is running or the orchestrator is between features |
| `validating` | Milestone validation commands are running |
| `paused` | Execution suspended. `resumeTargetState` preserves where to return |
| `completed` | All work and validations succeeded, or remaining work explicitly accepted |
| `failed` | System cannot proceed without user resolution |
| `aborted` | User explicitly terminated the mission |

### Pause Overlay Model

`paused` is a runtime overlay state, not a boolean flag. It stores `resumeTargetState` indicating which state to return to on resume.

Examples:

- Paused while executing -> resumes to `executing`
- Paused while validating -> resumes to `validating`
- Paused during draft review -> resumes to `draft_review`

### State Transitions and Who Triggers Them

| Transition | Triggered By |
|------------|--------------|
| `idle` -> `planning` | Extension code (on `/mission <desc>` command) |
| `planning` -> `draft_review` | Extension code (when `submit_plan` tool is called by LLM) |
| `draft_review` -> `approved` | Extension code (on `/mission-approve` command or user confirmation) |
| `approved` -> `executing` | Extension code (when `spawn_worker` tool is first called by LLM) |
| `executing` -> `validating` | Extension code (when `run_validation` tool is called by LLM) |
| `validating` -> `executing` | Extension code (when `run_validation` returns and LLM continues with next feature or fix) |
| any -> `paused` | Extension code (on `/mission-pause` command) |
| `paused` -> `resumeTargetState` | Extension code (on `/mission-resume` command) |
| `executing` -> `completed` | Extension code (when `complete_mission` tool is called by LLM) |
| any -> `failed` | Extension code (on unrecoverable error detection) |
| any -> `aborted` | Extension code (on `/mission-reset` command) |

All transitions are performed by extension code in response to tool calls or commands. The LLM never directly writes state files.

### Allowed Commands by State

| State | Allowed commands |
|-------|-----------------|
| `idle` | `/mission` |
| `planning` | `/mission`, `/mission-status`, `/mission-pause`, `/mission-reset` |
| `draft_review` | `/mission`, `/mission-status`, `/mission-plan`, `/mission-approve`, `/mission-pause`, `/mission-reset` |
| `approved` | `/mission`, `/mission-status`, `/mission-plan`, `/mission-pause`, `/mission-reset` |
| `executing` | `/mission`, `/mission-status`, `/mission-plan`, `/mission-pause`, `/mission-skip`, `/mission-reset` |
| `validating` | `/mission`, `/mission-status`, `/mission-pause`, `/mission-reset` |
| `paused` | `/mission`, `/mission-status`, `/mission-resume`, `/mission-plan`, `/mission-reset` |
| terminal states | `/mission`, `/mission-status`, `/mission-reset` |

Redirect is handled through Mission Control overlay, not a separate command.

---

## Orchestrator Tool Definitions

The extension registers these tools via `pi.registerTool()`. The orchestrator LLM calls them to drive the mission. Each tool is implemented as extension TypeScript code.

### submit_plan

Called by the orchestrator after the planning conversation to submit a structured plan.

```typescript
interface SubmitPlanParams {
  description: string;
  milestones: Array<{
    id: string;
    name: string;
    description: string;
    features: Array<{
      id: string;
      name: string;
      description: string;
      acceptanceCriteria: string[];
      relevantFiles: string[];
      dependencies: string[];        // feature IDs this depends on
      estimatedComplexity: "low" | "medium" | "high";
    }>;
    validationCommands?: string[];   // override per-milestone if needed
  }>;
  validationCommands: string[];      // project-level defaults
  modelSuggestions?: {
    orchestrator?: string;
    worker?: string;
    validator?: string;
  };
}
```

**Extension behavior on call:**

1. Validate the plan structure
2. Write `plan.json`
3. Append mutation to `plan-history.jsonl`
4. Transition state to `draft_review`
5. Update widget to show draft plan summary
6. Return confirmation message to orchestrator

### spawn_worker

Called by the orchestrator to execute a single feature. **Blocks until worker completes.**

```typescript
interface SpawnWorkerParams {
  featureId: string;
  additionalContext?: string;   // extra guidance for retry attempts
}
```

**Extension behavior on call:**

1. Read feature definition from `plan.json`
2. Generate worker skill file (`.pi/missions/runtime/<featureId>/<attempt>/worker-skill.md`)
3. Generate worker prompt (`.pi/missions/runtime/<featureId>/<attempt>/worker-prompt.md`)
4. Resolve worker model from config (fallback to current model)
5. Spawn pi process: `pi --mode json -p --no-session --model <model> --skill <skill> --append-system-prompt <context> <prompt>`
6. Capture stdout JSON event stream, stderr
7. Write `stdout.log`, `stderr.log`
8. **Block** until process exits
9. Synthesize `result.json` from: exit code, captured events (tool calls, file changes), final message
10. Write `result.json`, `metadata.json`
11. Update feature status in `plan.json` and `state.json`
12. Append progress event
13. Update widget
14. Return `WorkerResult` to orchestrator LLM

### run_validation

Called by the orchestrator at milestone boundaries.

```typescript
interface RunValidationParams {
  milestoneId: string;
}
```

**Extension behavior on call:**

1. Resolve validation commands: milestone-specific overrides > plan-level > config > auto-detected
2. Run commands in normalized order: typecheck, lint, test, build
3. Run ALL commands (no fail-fast). Each has a configurable timeout.
4. Capture stdout/stderr for each command
5. Write results to `.pi/missions/runtime/validation/<milestoneId>/<timestamp>/`
6. Transition state to `validating` at start, back to `executing` when done. Widget updates in real-time during the blocking call even though the orchestrator LLM is waiting.
7. Return structured `ValidationResult` to orchestrator

### commit_changes

Called by the orchestrator after a successful worker result.

```typescript
interface CommitChangesParams {
  featureId: string;
  message?: string;   // override default commit message
}
```

**Extension behavior on call:**

1. Check if git is available and auto-commit is enabled
2. Run `git diff --name-only` to determine changed files
3. If possible, stage only files changed by this feature (compare against pre-worker snapshot)
4. If repository was dirty pre-mission, skip commit and return warning
5. Commit with message: `mission: <feature-name>` (or `mission: fix <feature-name>` for fix features)
6. Return commit SHA or skip reason

### create_fix_feature

Called by the orchestrator when validation fails or a worker reports issues.

```typescript
interface CreateFixFeatureParams {
  milestoneId: string;
  name: string;
  description: string;
  acceptanceCriteria: string[];
  relevantFiles: string[];
  sourceKind: "worker-failure" | "validation-failure";
  sourceFeatureId?: string;
}
```

**Extension behavior on call:**

1. Generate feature ID
2. Add feature to the milestone in `plan.json`
3. Set `fixOrigin` on the feature
4. Append mutation to `plan-history.jsonl`
5. Update state counters
6. Return the new feature definition

### update_mission_state

Called by the orchestrator to communicate status changes and decisions.

```typescript
interface UpdateMissionStateParams {
  action: "start_milestone" | "complete_milestone" | "skip_feature" | "block_feature" | "note";
  targetId: string;          // milestone or feature ID
  reason?: string;
}
```

**Extension behavior on call:**

1. Update the relevant entity status in `plan.json`
2. Update `state.json`
3. Append progress event
4. Update widget
5. Return confirmation

### complete_mission

Called by the orchestrator when all planned work is done.

```typescript
interface CompleteMissionParams {
  summary: string;
  remainingNotes?: string[];
}
```

**Extension behavior on call:**

1. Transition state to `completed`
2. Generate `.pi/missions/report.md`
3. Update widget to completion state
4. Show completion report view
5. Return final summary

---

## Worker Execution Contract

### Worker Invocation

Workers are spawned as pi child processes with:

- Project working directory (same as the main session)
- Specific model assignment for worker role
- Generated feature skill (`--skill <path>`)
- Generated system prompt context (`--append-system-prompt <path>`)
- Feature prompt as the initial message

The worker command:

```
pi --mode json -p --no-session \
  --model <worker-model> \
  --skill .pi/missions/runtime/<featureId>/<attempt>/worker-skill.md \
  --append-system-prompt .pi/missions/runtime/<featureId>/<attempt>/worker-context.md \
  "<feature prompt text>"
```

### Worker Skill Generation

The extension generates a worker skill file that:

- Describes the feature to implement
- Lists acceptance criteria
- Lists relevant files
- Provides project conventions (from AGENTS.md if present)
- Instructs the worker to be focused and not modify unrelated files
- Does NOT mention missions, orchestration, or state management

### Worker Result Synthesis

Workers do not write `result.json` themselves. They are unaware of the mission system. The extension synthesizes results by:

1. Capturing the JSON event stream from the worker's stdout
2. Tracking all tool calls (file reads, edits, writes, bash commands)
3. Recording the exit code
4. Extracting the worker's final assistant message as a summary
5. Building `WorkerResult` from these signals

### Worker Result Schema

```typescript
interface WorkerResult {
  status: "success" | "failure" | "blocked";
  summary: string;
  filesChanged: string[];
  commandsRun: Array<{
    command: string;
    exitCode: number | null;
  }>;
  notes?: string[];
  error?: {
    kind: "tool" | "validation" | "environment" | "unknown";
    message: string;
    details?: string;
  };
  metrics: {
    durationMs: number;
    tokensUsed?: number;
    estimatedCost?: number;
  };
}
```

### Worker Success Rules

A worker attempt is successful only if:

1. Process exit code is `0`
2. No fatal tool errors in the event stream
3. The synthesized result status is `"success"`

If any condition fails, the attempt is marked failed. The orchestrator LLM receives the full result and decides whether to retry, create a fix feature, or escalate.

### Worker Commit Policy

Workers never commit. After a successful worker result, the orchestrator LLM may call `commit_changes` to create a git checkpoint.

### Metrics

Duration is always captured. Token count and cost are captured when available from the worker's JSON event stream. These fields are optional -- the system does not promise precise cost tracking.

---

## Validation Contract

### Validation Commands

Commands run in normalized order when available:

1. `typecheck`
2. `lint`
3. `test`
4. `build`

### Validation Discovery Priority

1. Explicit commands in `config.json`
2. Commands approved during planning (stored in `plan.json`)
3. Auto-detected from project:
   - `package.json` scripts (`typecheck`, `lint`, `test`, `build`)
   - `Makefile` targets
   - Ecosystem defaults (`cargo test`, `go test ./...`, `pytest`, `bun test`, etc.)

### Validation Execution Rules

- Run all commands. Do not fail fast.
- Each command has a configurable timeout (default: 120 seconds).
- Each command's stdout and stderr are captured to files.
- Aggregate pass/fail is determined after all commands finish.

### Validation Result Schema

```typescript
interface ValidationResult {
  status: "pass" | "fail";
  milestoneId: string;
  commands: Array<{
    label: string;
    command: string;
    exitCode: number | null;
    durationMs: number;
    timedOut: boolean;
    stdoutPath: string;
    stderrPath: string;
  }>;
  summary: string;
  failingChecks: string[];
}
```

### Validation Failure Flow

When validation fails:

1. `run_validation` tool returns the structured failure result to the orchestrator
2. The orchestrator LLM analyzes failing checks
3. The orchestrator calls `create_fix_feature` for one or more fix features
4. The orchestrator calls `spawn_worker` for each fix feature
5. The orchestrator calls `run_validation` again after fixes
6. This cycle continues until validation passes or the orchestrator decides to escalate

The orchestrator, being an LLM, can make nuanced decisions about whether failures are worth fixing, whether to retry, or whether to ask the user for guidance.

---

## Git Safety Rules

### Default Behavior

Git integration is enabled only when the project is a git repository. Detection: check if `git rev-parse --is-inside-work-tree` succeeds.

### Pre-Mission Snapshot

Before the first worker spawns, the extension captures:

- `git status --porcelain` (dirty file list)
- `git stash list` (stash state)
- `git rev-parse HEAD` (current commit)

This snapshot enables per-feature file change tracking.

### Dirty Repo Policy

If the repository is dirty before mission start:

- The mission may still start
- The system shows a warning in planning and draft review
- Auto-commit is disabled by default
- Reporting still includes changed files via filesystem diffing

Auto-commit may be re-enabled only if the user explicitly opts in via config or confirmation.

### Per-Feature Change Tracking

Before each worker spawn, the extension runs `git diff --name-only HEAD` (or `git status --porcelain` if dirty). After the worker completes, it runs the same command. The delta is the set of files changed by that worker.

This approach works even in a dirty repository (tracking incremental changes) and does not rely on the worker reporting files accurately.

### Commit Scope

When auto-commit is enabled:

- Stage only the files identified by per-feature change tracking
- Never run `git add -A` in a dirty repository
- Normal feature commit message: `mission: <feature-name>`
- Fix feature commit message: `mission: fix <feature-name>`

### Out-of-Scope File Changes

If a worker changes files outside the feature's `relevantFiles` set:

- Do not block
- Record the deviation in the runtime log and report
- Surface a warning in Mission Control

### No-Git Mode

If the project is not a git repository:

- Mission execution still works
- Validation still works
- Reporting uses filesystem-level change summaries
- Commit tools return a skip message
- No git-related warnings or errors

---

## Persistence, Locking, and Resume

### Directory Layout

```
.pi/missions/
  plan.json                          # Mission structure
  state.json                         # Runtime lifecycle state
  config.json                        # User configuration
  plan-history.jsonl                 # Append-only mutation log
  report.md                          # Final report
  active-session.json                # Lock metadata
  lock                               # Advisory file lock (proper-lockfile)
  runtime/
    <feature-id>/
      <attempt-number>/
        worker-skill.md
        worker-context.md
        worker-prompt.md
        stdout.log
        stderr.log
        result.json
        metadata.json
    validation/
      <milestone-id>/
        <timestamp>/
          <command-label>-stdout.log
          <command-label>-stderr.log
          result.json
```

### File Roles

| File | Role |
|------|------|
| `plan.json` | Mission structure: milestones, features, dependencies, validation definitions |
| `state.json` | Current lifecycle state, active milestone/feature, counters, timestamps |
| `config.json` | Model assignments, validation commands, autonomy level, user preferences |
| `plan-history.jsonl` | Append-only log of all plan mutations with timestamps and actors |
| `active-session.json` | Active orchestrator session ID, start time, last heartbeat |
| `lock` | Advisory file lock managed by `proper-lockfile` |
| `report.md` | Generated at mission completion |

### Locking

The extension uses `proper-lockfile` (or equivalent) on `.pi/missions/lock` to ensure only one active orchestrator per mission. This is a filesystem advisory lock that is automatically released when the process exits, even on crash.

`active-session.json` stores metadata for informational purposes:

```typescript
interface ActiveSession {
  sessionId: string;
  pid: number;
  startedAt: string;
  lastHeartbeatAt: string;
}
```

### Active Session Policy

If a new pi session opens in a repo with an active mission lock:

1. The extension attempts to acquire the lock
2. If locked, it reads `active-session.json` and checks if the owning PID is still alive
3. If PID is alive: offer to observe (read-only) or wait
4. If PID is dead (stale lock): offer to take over or reset

### Session Entry Cache

On every filesystem state write, the extension also calls `pi.appendEntry("mission-state-cache", state)`. On `session_start`, the extension:

1. Checks if `.pi/missions/state.json` exists
2. If yes: loads from filesystem (authoritative)
3. If no: checks session entries for cached state (recovery fallback)
4. Updates widget from loaded state

### Crash Recovery

If the orchestrator crashes mid-feature:

1. The `proper-lockfile` lock is automatically released
2. On next session start, the extension reads `state.json`
3. If `state.json.status === "executing"` and `currentFeatureId` is set:
   a. Check the feature's runtime directory for `result.json`
   b. If a complete `result.json` exists: reconcile (mark feature done/failed based on result)
   c. If no `result.json`: mark the attempt as `interrupted`
4. The extension injects the recovery context into the system prompt
5. The orchestrator LLM sees the current state and decides to resume, retry, or ask the user

### Reconciliation Rules

If state diverges:

- `plan.json` wins for plan structure
- `state.json` wins for runtime state
- Session entries are hints only, never authoritative
- If `state.json` references a feature missing from `plan.json`, the mission enters `failed` with a recovery prompt

---

## Planning Model

### Planning Flow

1. User runs `/mission "Build a CRM"`
2. Extension transitions state to `planning`
3. Extension injects orchestrator planning protocol via `before_agent_start`
4. Orchestrator LLM has access to all standard pi tools (read, bash, grep, etc.) plus mission tools
5. Orchestrator analyzes the codebase, asks clarifying questions, discusses scope
6. Orchestrator calls `submit_plan` with the structured plan
7. Extension writes `plan.json`, transitions to `draft_review`
8. Extension shows draft plan in UI (widget + optional overlay)
9. User reviews and approves via `/mission-approve` or conversation

This is a **conversation**, not a questionnaire. The orchestrator LLM drives the planning dialogue. The extension only intervenes to inject protocol and process tool calls.

### Draft Plan Approval

Approval is explicit and happens through:

- `/mission-approve` command
- User confirms in Mission Control overlay
- Orchestrator may suggest approval in conversation, but the extension does NOT auto-approve from LLM output. The user must explicitly approve.

On approval:

1. `plan.json.approvedAt` is set
2. `state.json.status` transitions to `approved`
3. The orchestrator protocol switches from planning to execution mode
4. The orchestrator LLM begins calling `spawn_worker` for the first feature

### Plan Mutation Model

Plan changes are versioned. Every mutation appends to `plan-history.jsonl`:

```typescript
interface PlanMutation {
  planVersion: number;
  timestamp: string;
  actor: "user" | "orchestrator";
  kind:
    | "plan-created"
    | "plan-approved"
    | "add-milestone"
    | "remove-milestone"
    | "reorder-milestone"
    | "add-feature"
    | "remove-feature"
    | "reorder-feature"
    | "edit-feature"
    | "add-fix-feature"
    | "edit-validation"
    | "feature-status-change"
    | "milestone-status-change";
  summary: string;
  payload: Record<string, unknown>;
}
```

The extension writes mutations inside tool implementations. The orchestrator LLM does not write to `plan-history.jsonl` directly.

### Re-Planning Restrictions

Forbidden mutations (enforced by extension code in tool implementations):

- Deleting completed features
- Changing acceptance criteria of completed features
- Moving completed features to other milestones
- Deleting completed milestones

Allowed mutations apply only to `pending` or `active` work.

### Fix Features

Fix features track their origin:

```typescript
interface FixFeatureOrigin {
  sourceKind: "worker-failure" | "validation-failure";
  sourceFeatureId?: string;
  sourceMilestoneId?: string;
  validationOutput?: string;
}
```

---

## Model Configuration

### Configuration Hierarchy

1. **Config file** (`.pi/missions/config.json`): persistent defaults
2. **Planning conversation**: orchestrator may suggest models in `submit_plan`
3. **Runtime override**: user changes models via Mission Control overlay

### Config Schema

```typescript
interface MissionConfig {
  models?: {
    orchestrator?: string;   // model ID or pattern
    worker?: string;
    validator?: string;      // reserved for future LLM-powered validation
  };
  validation?: {
    commands?: string[];
    timeoutMs?: number;      // per-command timeout, default 120000
  };
  autonomy?: "low" | "medium" | "high";
  git?: {
    autoCommit?: boolean;    // default: true if repo clean, false if dirty
  };
  maxRetries?: number;       // per-feature retry limit, default 3
}
```

### Model Resolution

When the extension needs a model ID (for worker spawning):

1. Check `config.json` for explicit assignment
2. Check `plan.json.modelAssignment` if set during planning
3. Fall back to the current session model

Model IDs are resolved against `ctx.modelRegistry` at spawn time. If a configured model is not available, the extension logs a warning and falls back.

### Autonomy Levels

| Level | Behavior |
|-------|----------|
| `low` | Orchestrator pauses after every feature for user confirmation |
| `medium` | Orchestrator pauses at milestone boundaries and on failures |
| `high` | Orchestrator runs to completion, only pauses on critical failures |

Autonomy is enforced through the orchestrator protocol injected into the system prompt. The extension does not programmatically gate execution -- it instructs the LLM when to pause and wait for user input.

---

## User Interface

### UI Principles

The UI is operational, not decorative. It answers:

1. What is the mission trying to do?
2. What phase is it in right now?
3. What is currently running or blocked?
4. What completed recently?
5. What can I do next?

### Always-Visible Widget

The widget is rendered via `ctx.ui.setWidget("mission", lines)` and shows compact, stateful progress.

States:

```
● Running  ██████▓░░░  4/10 features  ·  Milestone: auth  ·  Feature: jwt-tokens
⏸ Paused   ██████▓░░░  4/10 features  ·  waiting for input
⏳ Planning ·  analyzing codebase...
📋 Draft    ·  2 milestones, 8 features  ·  awaiting approval
✓ Done     ██████████  10/10 features ·  report ready
✗ Failed   ██████░░░░  6/10 features  ·  blocked on jwt-tokens
```

Progress bar characters: `█` done, `▓` active, `░` pending/skipped.

### Mission Control Overlay (Ctrl+Shift+M)

Full custom TUI overlay built with pi-tui components. Opened via `ctx.ui.custom()` with `overlay: true`.

Layout:

```
┌─ Current Feature ──────────────────┐ ┌─ Mission Outline ────────┐
│ jwt-tokens                          │ │ Milestone 1: Foundation  │
│ Milestone: auth                     │ │  ✓ user-model            │
│ Worker: claude-sonnet-4             │ │  ✓ password-hashing      │
│ Attempt: 1/3                        │ │  ✓ login-endpoint        │
│                                     │ │  ● jwt-tokens            │
│ Acceptance Criteria                 │ │  ○ refresh-tokens        │
│  • JWT signing with RS256           │ │                          │
│  • Token refresh endpoint           │ │ Milestone 2: Validation  │
│  • 15m access / 7d refresh          │ │  ○ auth audit            │
│                                     │ ├─ Progress Log ──────────┤
│ Warnings                            │ │ 2m   ✓ user-model done   │
│  • Repo dirty: auto-commit off      │ │ 5m   ✓ password-hashing  │
└─────────────────────────────────────┘ │ 14m  ● jwt-tokens start  │
                                        └──────────────────────────┘
P: Pause  S: Skip  D: Done  R: Redirect
M: Models  V: Validate  L: Logs  Esc: Close
```

Keyboard actions within the overlay:

| Key | Action |
|-----|--------|
| `P` | Pause/Resume mission |
| `S` | Skip current feature |
| `D` | Mark mission done |
| `R` | Redirect: open input for new instruction, sent to orchestrator via `pi.sendUserMessage()` |
| `M` | Open model assignment sub-view |
| `V` | Show validation results |
| `L` | Show worker logs |
| `Esc` | Close overlay |

The overlay reads state from `.pi/missions/state.json` and `plan.json`. It refreshes on a polling interval while open.

### Planning Setup View

Shown when a new mission begins. This is the conversational planning phase where the orchestrator LLM is driving.

```
┌─ Mission Setup ───────────────────────────────────────────────┐
│ Goal: Build a multi-tenant auth system                       │
│                                                              │
│ Orchestrator is analyzing the codebase and gathering         │
│ constraints before drafting a plan.                          │
│                                                              │
│ The orchestrator will ask you questions in the chat.         │
│ Answer them to help refine the plan.                         │
│                                                              │
│ Context discovered                                           │
│ • Next.js app                                                │
│ • Prisma schema present                                      │
│ • Existing auth middleware found                             │
└──────────────────────────────────────────────────────────────┘
```

This view is informational. The actual conversation happens in the normal pi chat.

### Draft Plan Review View

Displayed after `submit_plan` is called, before approval.

```
┌─ Draft Mission Plan ──────────────────────────────────────────┐
│ Mission: Build multi-tenant auth system                      │
│                                                              │
│ Milestone 1: Foundation (3 features)                         │
│  • user-model: Create User entity and migration              │
│  • tenant-model: Create Tenant entity with relations         │
│  • session-strategy: Implement session management            │
│                                                              │
│ Milestone 2: Auth Flows (3 features)                         │
│  • login-endpoint: Email/password login                      │
│  • refresh-tokens: JWT refresh token rotation                │
│  • role-checks: RBAC middleware                              │
│                                                              │
│ Validation                                                   │
│  • npm run typecheck                                         │
│  • npm test                                                  │
│  • npm run lint                                              │
│                                                              │
│ Models                                                       │
│  • Worker: claude-sonnet-4                                   │
│  • Estimated runs: 6 features + 4 validations = ~10         │
└──────────────────────────────────────────────────────────────┘
A: approve   Esc: back to chat (continue planning)
```

### Validation View

Shown when validation is running.

```
┌─ Milestone Validation ────────────────────────────────────────┐
│ Milestone: Auth Flows                                        │
│                                                              │
│ Running checks                                               │
│ ✓ typecheck ·························· 2.1s                  │
│ ● test ·······························                       │
│ ○ build                                                      │
│                                                              │
│ Failures will generate fix features before the mission       │
│ can proceed.                                                 │
└──────────────────────────────────────────────────────────────┘
```

### Blocked Mission View

Shown when a feature exhausts retries or hits an unrecoverable error.

```
┌─ Mission Blocked ─────────────────────────────────────────────┐
│ Feature: refresh-tokens                                      │
│ Attempts: 3/3 failed                                         │
│                                                              │
│ Last failure                                                 │
│ • auth.refresh.spec.ts failed                                │
│ • token expiry logic inconsistent with session store         │
│                                                              │
│ The orchestrator is waiting for your guidance.               │
│ You can type a message in the chat, or use an action below.  │
└──────────────────────────────────────────────────────────────┘
R: retry with guidance   S: skip feature   Esc: back to chat
```

### Completion Report View

```
┌─ Mission Complete ────────────────────────────────────────────┐
│ Goal: Build multi-tenant auth system                         │
│ Duration: 1h 24m                                             │
│ Features: 9 completed, 1 skipped, 2 fix features             │
│ Validation: 3/3 milestones passed                            │
│                                                              │
│ Output                                                       │
│ • .pi/missions/report.md                                     │
│ • 11 commits created                                         │
└──────────────────────────────────────────────────────────────┘
O: open report   Esc: close
```

---

## Commands

| Command | Description |
|---------|-------------|
| `/mission <description>` | Start a new mission (enters planning phase) |
| `/mission` | Quick mission status (show widget info) |
| `/mission-status` | Detailed status overlay |
| `/mission-plan` | View current plan |
| `/mission-approve` | Approve draft plan and begin execution |
| `/mission-pause` | Pause mission |
| `/mission-resume` | Resume mission |
| `/mission-skip` | Skip current feature |
| `/mission-reset` | Clear mission state and files |

### Keyboard Shortcut

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+M` | Open Mission Control overlay |

### Command Behavior Details

**`/mission <description>`**: If no active mission, transitions to `planning` and sends the description as the orchestrator's initial prompt. If a mission exists, shows quick status.

**`/mission-approve`**: Only valid in `draft_review`. Transitions to `approved`. Injects an approval message into the conversation so the orchestrator LLM knows to begin execution.

**`/mission-pause`**: Captures `resumeTargetState` from current state, transitions to `paused`. Injects a pause notice into the system prompt telling the orchestrator to stop work. If a worker is currently running, the worker is NOT killed -- it completes, but the orchestrator won't spawn the next one.

**`/mission-resume`**: Transitions from `paused` back to `resumeTargetState`. Removes the pause notice from the system prompt. Sends a resume message to the orchestrator.

**`/mission-skip`**: Marks the current feature as `skipped` in `plan.json`. Updates state. The orchestrator LLM is informed and moves to the next feature.

**`/mission-reset`**: Confirms with user. Removes `.pi/missions/` directory. Clears widget. Clears session name. Appends a null session entry to prevent stale cache restoration.

---

## System Prompt Injection

### Mechanism

The extension uses `pi.on("before_agent_start", handler)` to append orchestrator protocol to the system prompt on every LLM turn.

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  const state = loadStateFromDisk();
  if (!state || isTerminalState(state.status)) return;

  const protocol = buildOrchestratorProtocol(state);
  return {
    systemPrompt: event.systemPrompt + "\n\n" + protocol,
  };
});
```

### Protocol Content by State

| State | Protocol injected |
|-------|-------------------|
| `planning` | Planning protocol: analyze codebase, ask questions, call `submit_plan` when ready |
| `draft_review` | Draft review protocol: plan is awaiting approval, do not begin execution |
| `approved` | Execution protocol: plan approved, begin executing features by calling `spawn_worker` |
| `executing` | Execution protocol: current progress, which feature to work on next, tool usage guidance |
| `validating` | Validation protocol: validation in progress, wait for results |
| `paused` | Pause notice: stop all work, wait for user to resume |

### Protocol Sizing

The injected protocol is kept concise to minimize context usage:

- Planning protocol: ~500 tokens (codebase analysis guidance + tool usage)
- Execution protocol: ~300 tokens (current state + next steps + tool reference)
- Pause notice: ~50 tokens

The protocol includes the current mission state summary (milestone/feature progress, warnings) to give the orchestrator full situational awareness each turn.

---

## Data Models

### MissionPlan

```typescript
interface MissionPlan {
  id: string;
  description: string;
  planVersion: number;
  milestones: Milestone[];
  validationCommands: string[];
  modelAssignment: ModelAssignment;
  createdAt: string;
  approvedAt?: string;
}
```

### Milestone

```typescript
interface Milestone {
  id: string;
  name: string;
  description: string;
  features: Feature[];
  validationCommands?: string[];   // per-milestone override
  status: "pending" | "active" | "done" | "failed";
  startedAt?: string;
  completedAt?: string;
}
```

### Feature

```typescript
interface Feature {
  id: string;
  name: string;
  description: string;
  acceptanceCriteria: string[];
  relevantFiles: string[];
  dependencies: string[];
  estimatedComplexity: "low" | "medium" | "high";
  status: "pending" | "active" | "done" | "failed" | "skipped" | "blocked";
  fixOrigin?: FixFeatureOrigin;
  attempts: WorkerAttempt[];
  startedAt?: string;
  completedAt?: string;
}
```

### WorkerAttempt

```typescript
interface WorkerAttempt {
  attemptNumber: number;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  resultPath: string;
  stdoutPath: string;
  stderrPath: string;
  durationMs?: number;
  model?: string;
  status: "running" | "success" | "failure" | "interrupted";
}
```

### MissionState

```typescript
interface MissionState {
  missionId: string;
  status: MissionStatus;
  resumeTargetState?: ResumeTargetState;
  currentMilestoneId?: string;
  currentFeatureId?: string;
  progressLog: ProgressEvent[];
  startedAt: string;
  completedAt?: string;
  totalFeaturesCompleted: number;
  totalFeaturesFailed: number;
  totalFeaturesSkipped: number;
  totalFixFeaturesCreated: number;
  gitSnapshot?: GitSnapshot;
}

type MissionStatus =
  | "planning"
  | "draft_review"
  | "approved"
  | "executing"
  | "validating"
  | "paused"
  | "completed"
  | "failed"
  | "aborted";

type ResumeTargetState =
  | "planning"
  | "draft_review"
  | "executing"
  | "validating";
```

### ModelAssignment

```typescript
interface ModelAssignment {
  orchestrator?: string;
  worker?: string;
  validator?: string;
}
```

### GitSnapshot

```typescript
interface GitSnapshot {
  headCommit: string;
  dirtyFiles: string[];
  autoCommitEnabled: boolean;
}
```

### ProgressEvent

```typescript
interface ProgressEvent {
  timestamp: string;
  type: ProgressEventType;
  detail: string;
  metadata?: Record<string, unknown>;
}

type ProgressEventType =
  | "mission_started"
  | "planning_started"
  | "plan_submitted"
  | "plan_approved"
  | "feature_start"
  | "feature_complete"
  | "feature_failed"
  | "feature_skipped"
  | "feature_blocked"
  | "fix_feature_created"
  | "milestone_start"
  | "milestone_complete"
  | "validation_start"
  | "validation_pass"
  | "validation_fail"
  | "commit_created"
  | "pause"
  | "resume"
  | "redirect"
  | "plan_mutated"
  | "mission_complete"
  | "mission_failed"
  | "mission_aborted"
  | "worker_spawn"
  | "worker_complete";
```

### FixFeatureOrigin

```typescript
interface FixFeatureOrigin {
  sourceKind: "worker-failure" | "validation-failure";
  sourceFeatureId?: string;
  sourceMilestoneId?: string;
  validationOutput?: string;
}
```

---

## Parallelism Model

### v1 Rule

Features run sequentially. The `spawn_worker` tool blocks until the worker completes. The orchestrator LLM calls `spawn_worker` one feature at a time.

### Why Sequential

- Workers share the same working directory -- parallel workers would create file conflicts
- Blocking tools are simpler to implement and reason about
- Droid found that "serial execution with targeted parallelization has worked better than broad parallelism"

### Future-Compatible Design

The `Feature` model includes an `estimatedComplexity` field (not `parallelizable`). If parallel execution is added later, it would use isolated git worktrees per worker. The plan structure already supports dependency ordering.

---

## Reporting

At mission completion, the extension generates `.pi/missions/report.md` containing:

- Mission goal
- Start and end time, total duration
- Milestone outcomes (pass/fail, duration)
- Feature outcomes (success/failure/skipped, attempt counts, duration)
- Fix features created and their outcomes
- Validation command results per milestone
- Changed files summary (aggregated across all features)
- Git commit summary (SHAs and messages) if available
- Notable deviations or warnings (out-of-scope file changes, dirty repo, etc.)
- Per-feature metrics (duration, tokens if available)

Token and cost totals are included when available but are explicitly optional.

---

## Extension Package Structure

```
pi-missions/
  extensions/
    index.ts                  # Entry point: event wiring, tool registration, commands
    types.ts                  # All interfaces and type definitions
    tools/
      submit-plan.ts          # submit_plan tool implementation
      spawn-worker.ts         # spawn_worker tool (process spawning, blocking, result synthesis)
      run-validation.ts       # run_validation tool (command execution)
      commit-changes.ts       # commit_changes tool (git operations)
      create-fix.ts           # create_fix_feature tool
      update-state.ts         # update_mission_state tool
      complete.ts             # complete_mission tool
    orchestrator/
      protocol.ts             # System prompt generation per state
      worker-prompt.ts        # Worker skill and prompt generation
    state/
      manager.ts              # Filesystem read/write + session entry cache
      lock.ts                 # File locking via proper-lockfile
      plan-history.ts         # Append-only mutation log
    ui/
      widget.ts               # Always-visible progress widget
      mission-control.ts      # Full TUI overlay (Ctrl+Shift+M)
      draft-review.ts         # Draft plan review component
      validation-view.ts      # Validation progress component
      blocked-view.ts         # Blocked mission component
      report-view.ts          # Completion report component
      progress-log.ts         # Event timeline with relative timestamps
    git.ts                    # Git operations (status, diff, commit, snapshot)
    config.ts                 # Config loading, validation discovery, defaults
    commands.ts               # Slash commands registration
    report.ts                 # Report generation (.md)
    utils.ts                  # Shared helpers (formatDuration, generateId, etc.)
  package.json
  tsconfig.json
  vitest.config.ts
```

### Why This Structure

- **tools/**: Each orchestrator tool is a separate module. Tools are the primary interaction surface and each encapsulates significant logic.
- **orchestrator/**: Protocol and worker prompt generation are orchestrator-specific concerns.
- **state/**: Persistence is complex enough to warrant its own directory (filesystem, locking, history).
- **ui/**: Each view is a separate component. Mission Control is the most complex piece.
- Top-level modules (git, config, commands, report, utils) are shared concerns.

---

## Implementation Phases

### Phase 1 — Executable Core

**Goal:** A working mission that can plan, approve, execute features, and complete.

- [ ] Types and schemas (`types.ts`)
- [ ] Filesystem state management (`state/manager.ts`)
- [ ] File locking (`state/lock.ts`)
- [ ] Config loading and defaults (`config.ts`)
- [ ] Orchestrator protocol generation (`orchestrator/protocol.ts`)
- [ ] Worker prompt/skill generation (`orchestrator/worker-prompt.ts`)
- [ ] `submit_plan` tool (`tools/submit-plan.ts`)
- [ ] `spawn_worker` tool with blocking execution (`tools/spawn-worker.ts`)
- [ ] `update_mission_state` tool (`tools/update-state.ts`)
- [ ] `complete_mission` tool (`tools/complete.ts`)
- [ ] `/mission`, `/mission-approve`, `/mission-pause`, `/mission-resume`, `/mission-reset` commands
- [ ] Basic widget (progress bar, status)
- [ ] Extension entry point with event wiring (`index.ts`)
- [ ] Plan history logging (`state/plan-history.ts`)

### Phase 2 — Validation, Git, and Resilience

**Goal:** Milestone validation, git safety, retries, and blocked-state handling.

- [ ] Validation discovery from project files (`config.ts`)
- [ ] `run_validation` tool (`tools/run-validation.ts`)
- [ ] `commit_changes` tool (`tools/commit-changes.ts`)
- [ ] `create_fix_feature` tool (`tools/create-fix.ts`)
- [ ] Git snapshot and per-feature change tracking (`git.ts`)
- [ ] Git safety rules (dirty repo, selective staging)
- [ ] Feature retry logic in `spawn_worker`
- [ ] `/mission-skip` command
- [ ] Crash recovery on session start
- [ ] Blocked state detection and handling

### Phase 3 — Full UX

**Goal:** Complete Mission Control overlay and all supporting views.

- [ ] Mission Control overlay with pi-tui components (`ui/mission-control.ts`)
- [ ] Draft plan review view (`ui/draft-review.ts`)
- [ ] Validation progress view (`ui/validation-view.ts`)
- [ ] Blocked mission view (`ui/blocked-view.ts`)
- [ ] Completion report view (`ui/report-view.ts`)
- [ ] Progress log timeline (`ui/progress-log.ts`)
- [ ] `Ctrl+Shift+M` keyboard shortcut
- [ ] Model switching sub-view in Mission Control
- [ ] Redirect flow in Mission Control

### Phase 4 — Advanced Operations

**Goal:** Polish, reporting, and advanced mission management.

- [ ] Report generation (`report.ts`)
- [ ] `/mission-status` detailed status overlay
- [ ] `/mission-plan` plan viewer
- [ ] Plan mutation history viewer
- [ ] Observe/takeover flow for multi-session scenarios
- [ ] Model configuration via config file with smart defaults
- [ ] Autonomy level enforcement in orchestrator protocol
- [ ] Metrics collection (tokens, cost, duration per feature)
- [ ] Re-scope support (add/remove features mid-mission)

---

## Technical Constraints

| Constraint | Detail |
|------------|--------|
| Pi version | Requires extension API compatible with current pi-mono coding-agent (v0.64.0+) |
| Runtime | Extension runs in main pi process. Workers run as child pi processes. |
| Dependencies | Minimal. `proper-lockfile` for locking (or simple `fs.open` with exclusive flag as zero-dependency alternative). Pi-native APIs and filesystem for everything else. |
| Platform | macOS, Linux, Windows where pi runs |
| Git | Optional. All git behavior degrades safely when unavailable. |
| Node.js | Workers spawned via `node:child_process`. `spawn` with stdio pipes. |
| TypeBox | Used for runtime schema validation of persisted state |
| pi-tui | Used for Mission Control overlay and all custom UI components |

### Pi Extension API Surface Used

| API | Purpose |
|-----|---------|
| `pi.registerTool()` | Register orchestrator tools (submit_plan, spawn_worker, etc.) |
| `pi.registerCommand()` | Register slash commands (/mission, /mission-approve, etc.) |
| `pi.registerShortcut()` | Register Ctrl+Shift+M |
| `pi.on("before_agent_start")` | Inject orchestrator protocol into system prompt |
| `pi.on("session_start")` | Restore state from filesystem on session load |
| `pi.on("session_compact")` | Re-cache state after compaction |
| `pi.appendEntry()` | Cache state in session entries |
| `pi.sendUserMessage()` | Send messages to orchestrator (kickoff, redirect, resume) |
| `pi.setSessionName()` | Set session name to mission description |
| `pi.setModel()` | Switch model for different roles |
| `pi.getThinkingLevel()` / `pi.setThinkingLevel()` | Adjust thinking for orchestrator vs worker |
| `pi.exec()` | Run validation commands |
| `ctx.ui.setWidget()` | Always-visible progress widget |
| `ctx.ui.custom()` | Mission Control overlay and all custom views |
| `ctx.ui.notify()` | Notifications |
| `ctx.ui.confirm()` | Confirmation dialogs (approve, skip, reset) |
| `ctx.ui.select()` | Selection menus |
| `ctx.ui.input()` | Text input (redirect messages) |
| `ctx.sessionManager.getEntries()` | Read session entries for state cache restoration |
| `ctx.modelRegistry` | Model lookup for assignment and switching |

---

## Differences from Droid Missions

| Aspect | Droid | pi-missions |
|--------|-------|-------------|
| Runtime | Cloud containers or local | Local only (pi process) |
| Worker isolation | Separate sessions with own context | Spawned pi processes (`pi -p --mode json --no-session`) |
| Computer use | Native browser automation for visual QA | Not in scope. Validation is command-based only. |
| Parallelism | Targeted parallelization within milestones | Sequential only in v1 |
| Skill learning | Skills developed and refined during execution | Worker skills generated per feature, not persistent across missions |
| Sub-orchestrators | Possible recursive depth | Single orchestrator only |
| UI | IDE integration + CLI | Terminal TUI only |
| Multi-day persistence | Cloud-managed state | Filesystem state under `.pi/missions/` |
| Telemetry | OpenTelemetry integration | Local metrics only |
| Enterprise features | SSO, RBAC, audit logging, deployment options | None |

---

## Glossary

| Term | Definition |
|------|------------|
| **Mission** | A complete orchestrated project execution, from planning through completion |
| **Milestone** | A validation checkpoint grouping related features |
| **Feature** | An atomic unit of implementation work executed by a single worker |
| **Fix Feature** | A feature created in response to a worker failure or validation failure |
| **Orchestrator** | The main session LLM augmented with mission tools |
| **Worker** | An isolated pi process executing a single feature |
| **Validation** | Running configured commands at milestone boundaries to verify correctness |
| **Mission Control** | The TUI overlay for monitoring and controlling a running mission |
| **Plan** | The structured breakdown of a mission into milestones and features |
| **Draft Review** | The state where a plan exists but has not been approved for execution |
