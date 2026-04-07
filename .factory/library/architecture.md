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

## Tools (8 registered)

1. submit_plan - Plan creation with validation
2. spawn_worker - Blocking worker execution
3. run_validation - Milestone command validation
4. commit_changes - Git operations
5. create_fix_feature - Fix feature creation
6. update_mission_state - State updates
7. complete_mission - Mission completion
8. ask_questions - Interactive questionnaire

## State Files (.pi/missions/)

- plan.json: Mission structure
- state.json: Runtime lifecycle
- config.json: User configuration
- plan-history.jsonl: Mutation log
- runtime/: Worker artifacts per feature/attempt

## Extension API Surface Used

- registerTool, registerCommand, registerShortcut
- on("before_agent_start") for protocol injection
- on("session_start") for state restoration
- appendEntry for session cache
- sendUserMessage for orchestrator messaging
- ctx.ui.setWidget, ctx.ui.custom for TUI
- exec() for validation commands
- setModel, getThinkingLevel, setThinkingLevel
