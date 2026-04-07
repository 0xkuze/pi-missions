# Architecture

pi-missions is a pi extension providing Factory AI Missions-inspired orchestration.

## Core Components

- **Entry point** (`extensions/index.ts`): Event wiring, tool registration, session lifecycle, crash recovery, widget rendering.
- **State machine** (`extensions/state/transitions.ts`): Deterministic transitions: idle -> planning -> draft_review -> approved -> executing <-> validating -> completed/failed/aborted. Pause overlay with resumeTargetState.
- **Persistence** (`extensions/state/manager.ts`): Filesystem-first (.pi/missions/), atomic writes (tmp+rename), TypeBox schema validation, in-memory caching.
- **Locking** (`extensions/state/lock.ts`): Advisory file lock via fs.open('wx'), PID-based liveness.

## Orchestrator

- The main session LLM augmented with mission tools via registerTool.
- Protocol injected via before_agent_start event per state.
- Protocol cached by composite key (state fields).
- Caveman mode for compressed protocol output.

## Workers

- Isolated pi processes: `pi --mode json -p --no-session --model <model> --skill <skill> --append-system-prompt <context> <prompt>`
- Result synthesis from NDJSON stdout event stream.
- Auto-commit after success, PID tracking for orphan cleanup.
- Per-feature validator (separate pi process for code review).

## Tools (11 registered)

1. submit_plan - Plan creation with validation
2. spawn_worker - Blocking worker execution
3. run_validation - Milestone command validation
4. commit_changes - Git operations
5. create_fix_feature - Fix feature creation
6. update_mission_state - State updates
7. complete_mission - Mission completion
8. ask_questions - Interactive questionnaire
9. update_library - Append content to knowledge library topics
10. configure_environment - Create/update environment descriptor
11. web_search - DuckDuckGo-based web search with optional library persistence

## State Files (.pi/missions/)

- plan.json: Mission structure
- state.json: Runtime lifecycle
- config.json: User configuration
- plan-history.jsonl: Mutation log
- environment.json: Environment descriptor (services, env vars, setup commands)
- library/: Knowledge library (architecture.md, environment.md, pitfalls.md, conventions.md, research.md)
- skills/: Living skill templates (.md files)
- runtime/: Worker artifacts per feature/attempt

## Protocol Injection Details

- Progressive injection: first turn gets full static + dynamic protocol; subsequent turns get dynamic-only (compact mode).
- Single compact-mode threshold: `contextUsagePercent > 60%` in ProtocolOptions. The legacy `isHighUsage` boolean was removed.
- Dynamic section uses `## MILESTONES`, `## {name} FEATURES`, and `## CURRENT FEATURE` markdown headers.
- Cache key includes `protocolVersion`, `turnCount` range, and `contextUsagePercent`.

## Validator Strictness

- Default validator behavior is strict (reject on timeout/abort/missing verdict). Tests that depend on old pass-on-error behavior must set `saveConfig(basePath, { validatorStrictness: 'lenient' })`.
- `synthesizeWorkerResult` defaults to strict mode for `report_result` extraction. Pass `{ legacyMode: true }` for backward-compat.

## Self-Correction

- `performSelfCorrection()` in spawn-worker.ts uses `addFixFeatureToPlan()` from create-fix.ts as the shared fix-feature creation helper. Changes to `addFixFeatureToPlan` affect both self-correction and the create_fix_feature tool.
- `performSelfCorrection` runs BEFORE `autoCompleteMilestone`, so a 'done' milestone is never left with a new 'pending' fix feature.

## Type Derivation

- `WorkerHandoff` is derived from `ReportResultSchema` via `type WorkerHandoff = Static<typeof ReportResultSchema>`. This prevents drift between the TypeBox schema and the TypeScript type.

## Extension API Surface Used

- registerTool, registerCommand, registerShortcut
- on("before_agent_start") for protocol injection
- on("session_start") for state restoration
- appendEntry for session cache
- sendUserMessage for orchestrator messaging
- ctx.ui.setWidget, ctx.ui.custom for TUI
- exec() for validation commands
- setModel, getThinkingLevel, setThinkingLevel
