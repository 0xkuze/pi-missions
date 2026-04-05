# pi-missions Architecture

## System Overview

pi-missions is a pi extension that brings Factory AI Missions-style orchestration to the pi terminal coding agent. It turns large, multi-step goals into structured plans and executes them through isolated worker processes with validation checkpoints.

The extension plugs into pi's extension API. It registers LLM-callable tools, slash commands, keyboard shortcuts, event handlers, and custom TUI views. The entry point is `extensions/index.ts`, which exports a default function receiving `ExtensionAPI`.

pi-missions does not introduce a separate orchestrator process. The main pi session's LLM *is* the orchestrator — the extension augments it with mission-specific tools and a state-aware system prompt protocol.

---

## Component Relationships

The system is organized into these major modules:

- **tools/** — One file per orchestrator tool (`submit_plan`, `spawn_worker`, `run_validation`, `commit_changes`, `create_fix_feature`, `update_mission_state`, `complete_mission`). Tools are the primary interface between the orchestrator LLM and the extension logic.
- **orchestrator/** — Generates the system prompt protocol injected per LLM turn, and generates worker skill/prompt files for each feature.
- **state/** — Owns all filesystem persistence: reading/writing state and plan files, file locking, and the append-only plan mutation history.
- **ui/** — The always-visible widget, the Mission Control overlay, and all supporting views (draft review, validation, blocked, completion report, progress log).
- **git.ts** — Git operations: snapshots, diffs, selective staging, commit creation. Degrades gracefully when git is unavailable.
- **config.ts** — Loads `config.json`, discovers validation commands from the project, resolves model assignments.
- **commands.ts** — Registers all slash commands (`/mission`, `/mission-approve`, `/mission-pause`, etc.).
- **report.ts** — Generates the final `report.md` at mission completion.
- **utils.ts** — Shared helpers (ID generation, duration formatting, etc.).
- **types.ts** — All interfaces and type definitions. Single source of truth for data shapes.

Dependency flow: Tools depend on state, orchestrator, git, and config. UI depends on state. Commands depend on tools and state. The orchestrator module depends on state. Report depends on state and git. Nothing depends on tools or commands (they are leaf consumers).

---

## Data Flows

### Mission Lifecycle

1. User runs `/mission <description>`. The extension transitions state to `planning` and injects the planning protocol into the system prompt.
2. The orchestrator LLM analyzes the codebase (using standard pi tools), asks clarifying questions, and calls `submit_plan` with a structured plan.
3. The extension writes `plan.json`, logs the mutation, transitions to `draft_review`, and updates the widget.
4. User approves via `/mission-approve`. State moves to `approved`.
5. The orchestrator begins calling `spawn_worker` for each feature sequentially. State moves to `executing`.
6. At milestone boundaries, the orchestrator calls `run_validation`. State moves to `validating`, then back to `executing`.
7. If validation fails, the orchestrator calls `create_fix_feature` and spawns workers for fixes.
8. When all work is done, the orchestrator calls `complete_mission`. The extension generates a report and transitions to `completed`.

### Worker Execution

1. The orchestrator calls `spawn_worker` with a feature ID.
2. The extension reads the feature definition from `plan.json` and generates a worker skill file and prompt.
3. A pi child process is spawned with `--mode json -p --no-session` and the generated skill/prompt.
4. The tool blocks, capturing the worker's stdout JSON event stream and stderr.
5. When the worker exits, the extension synthesizes a `WorkerResult` from the captured events (exit code, tool calls, file changes, final message).
6. Logs and result are written to the runtime directory. Feature status and state counters are updated.
7. The `WorkerResult` is returned to the orchestrator, which decides what to do next.

### State Persistence

1. Every state change writes to `.pi/missions/state.json` (or `plan.json`) on disk first.
2. Immediately after the filesystem write, the extension calls `pi.appendEntry()` to cache the state in the session.
3. On session start, the extension checks for `.pi/missions/state.json` on disk. If found, it loads from there (authoritative). If not, it falls back to session entry cache.
4. Plan mutations are additionally appended to `plan-history.jsonl` for auditability.

---

## State Machine

A mission progresses through these states:

```
idle → planning → draft_review → approved → executing ⇄ validating → completed
```

Additional terminal states: `failed`, `aborted`.

Overlay state: `paused` (can overlay any non-terminal state; stores `resumeTargetState` to know where to resume).

**Transitions:**

| From | To | Trigger |
|------|----|---------|
| idle | planning | `/mission <desc>` command |
| planning | draft_review | `submit_plan` tool call |
| draft_review | approved | `/mission-approve` command |
| approved | executing | First `spawn_worker` tool call |
| executing | validating | `run_validation` tool call |
| validating | executing | Validation returns, orchestrator continues |
| executing | completed | `complete_mission` tool call |
| any | paused | `/mission-pause` command |
| paused | (resume target) | `/mission-resume` command |
| any | failed | Unrecoverable error |
| any | aborted | `/mission-reset` command |

All transitions are performed by extension code in response to tool calls or commands. The LLM never writes state files directly.

---

## Persistence Model

### Filesystem Layout

```
.pi/missions/
  plan.json                 # Mission structure (milestones, features, validation)
  state.json                # Runtime lifecycle state, counters, progress log
  config.json               # Model assignments, validation commands, preferences
  plan-history.jsonl         # Append-only log of all plan mutations
  report.md                 # Generated at completion
  active-session.json        # Lock metadata (session ID, PID, heartbeat)
  lock                       # Advisory file lock
  runtime/
    <feature-id>/
      <attempt>/
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
          <label>-stdout.log
          <label>-stderr.log
          result.json
```

### Source of Truth Hierarchy

- `plan.json` is authoritative for plan structure.
- `state.json` is authoritative for runtime state.
- Session entries (`pi.appendEntry`) are a cache for fast UI restore within a session. Never authoritative.
- `plan-history.jsonl` is an audit log; not used for state reconstruction.

### Locking

An advisory file lock on `.pi/missions/lock` (via `proper-lockfile`) ensures only one orchestrator is active per mission. The lock auto-releases on process exit, including crashes. `active-session.json` stores metadata (PID, session ID, heartbeat) so a new session can detect stale locks from dead processes.

### Crash Recovery

On session start, if `state.json` shows `executing` with a `currentFeatureId`:
- If the feature's `result.json` exists: reconcile (mark done or failed based on the result).
- If no `result.json`: mark the attempt as `interrupted`.
- The orchestrator receives recovery context in its system prompt and decides how to proceed.

---

## Worker Isolation

Workers are spawned as separate pi child processes via `node:child_process.spawn`. Each worker:

- Runs in the same project working directory as the main session.
- Gets a dedicated model assignment, a generated skill file, and a generated context file.
- Has access to standard pi tools (read, bash, edit, write) but no mission tools.
- Has no knowledge of missions, milestones, orchestration, or the `.pi/missions/` directory.
- Runs in `--mode json -p --no-session` mode, producing a JSON event stream on stdout.

The extension captures the event stream and synthesizes a `WorkerResult` (status, files changed, commands run, summary, metrics). Workers never commit — the orchestrator decides when to commit via the `commit_changes` tool after reviewing results.

Features execute sequentially. One worker runs at a time because workers share the same working directory.

---

## Key Invariants

1. **All state transitions flow through extension code** — triggered by tool calls or commands, never by parsing LLM output.
2. **Filesystem is the source of truth** — session entries are a cache. State survives across sessions.
3. **Workers are ignorant of missions** — they receive a task, execute it, and exit. No mission awareness leaks into worker prompts.
4. **Workers never commit** — git operations are exclusively handled by the orchestrator via extension tools.
5. **One orchestrator per mission** — enforced by the advisory file lock.
6. **One worker at a time** — features execute sequentially; no parallel workers.
7. **Plan mutations are append-only** — every change is logged to `plan-history.jsonl` with a version, timestamp, and actor.
8. **Completed work is immutable** — completed features and milestones cannot be deleted or have their acceptance criteria changed.
9. **User approval is explicit** — the extension never auto-approves a plan from LLM output. The user must run `/mission-approve` or confirm through the UI.
10. **Git degrades gracefully** — all git features are optional. The system works without git, just without commits and git-based change tracking.
