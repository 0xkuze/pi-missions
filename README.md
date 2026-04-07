<p align="center">
  <img src="https://img.shields.io/badge/pi-missions-7c3aed?style=for-the-badge&labelColor=1e1e2e" alt="pi-missions" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/tests-1861_passing-brightgreen?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/test_files-52-blue?style=flat-square" alt="Test Files" />
  <img src="https://img.shields.io/badge/source_files-45-blue?style=flat-square" alt="Source Files" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/runtime-Node.js-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/tests-Bun-f9f1e1?style=flat-square&logo=bun&logoColor=black" alt="Bun" />
  <img src="https://img.shields.io/badge/lint-Biome-60a5fa?style=flat-square&logo=biome&logoColor=white" alt="Biome" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

# pi-missions

Structured orchestration for [pi](https://github.com/mariozechner/pi-coding-agent), inspired by [Factory AI Missions](https://www.factory.ai/). Describe a goal, get a plan, execute with isolated workers, validate at every checkpoint.

## Features

- **Planning-first workflow** — The orchestrator reads your codebase, asks clarifying questions via interactive overlays, and produces a structured plan before writing any code.
- **Structured missions** — Goals decompose into milestones containing features. Validation checkpoints run at every milestone boundary.
- **Isolated workers** — Each feature runs in a fresh pi process with clean context. No cross-contamination between tasks.
- **Automated validation** — Typecheck, lint, test, and build run at milestone boundaries. Failures generate fix features automatically.
- **Worker validation** — After each worker completes, a separate validator worker reviews the output against acceptance criteria and can request fixes before the feature is marked done.
- **Mission Control TUI** — A full terminal overlay (`Ctrl+Shift+M`) for monitoring progress, pausing, resuming, redirecting, switching models, viewing logs, and managing missions.
- **Self-healing execution** — When workers fail or validation catches regressions, the orchestrator creates targeted fix features and retries (up to configurable max retries).
- **Crash-safe persistence** — All state lives on the filesystem under `.pi/missions/`. Survives session switches, crashes, and `/compact`. Auto-resumes from pause on session restart.
- **Git safety** — Pre-mission snapshots, auto-init for non-git repos, per-feature change tracking, selective staging (never `git add -A`), dirty-repo awareness, and auto-commit after successful workers.
- **Multi-model support** — Assign different models to orchestrator, worker, and validator roles. Assign models by feature complexity (low/medium/high). Switch models mid-mission from Mission Control.
- **Onboarding overlay** — First-run setup wizard for choosing models, prompting mode, and spawn-and-learn preference. Configuration persists globally at `~/.pi/missions/global-config.json`.
- **Prompting modes** — Three modes: `default` (full verbose protocol), `caveman` (terse micro-rule), and `caveman-full` (terse with detailed grammar rules). Configurable per-mission or globally.
- **Interactive questionnaires** — The `ask_questions` tool presents structured questionnaires with selectable options so the orchestrator gathers exact constraints upfront.
- **Mission registry** — Cross-project registry at `~/.pi/missions/registry.json` tracks all missions. Mission Control shows a mission list when no mission is active.
- **Orphaned worker cleanup** — Detects and kills orphaned worker processes from crashed sessions via PID file tracking.
- **Completion reports** — Each mission produces a markdown report with timings, outcomes, fix features, git commits, and warnings.
- **Context-aware compaction** — Injects mission state summary into `/compact` so the orchestrator retains awareness after context compaction.
- **User input transformation** — Messages sent during execution are prefixed with `[User instruction during mission execution]` so the orchestrator interprets them as redirects.

## How It Works

### The Lifecycle

1. **Activate** — Run `/mission-mode` to activate mission mode. First-time use shows the onboarding overlay to configure models and preferences.
2. **Plan** — Describe a goal in Mission Control (`Ctrl+Shift+M → N`) or the orchestrator picks it up. The orchestrator explores your codebase, asks questions via the `ask_questions` overlay, and drafts a plan with milestones and features.
3. **Review** — The draft plan is shown in a review overlay. Approve it from Mission Control (`A` key) or the draft review overlay.
4. **Execute** — The orchestrator spawns isolated workers one feature at a time. Each worker gets a generated skill and prompt scoped to its task. After success, a validator worker optionally reviews the output. Auto-commit happens if the repo is clean.
5. **Validate** — At milestone boundaries, validation commands run automatically. Failures trigger fix feature creation.
6. **Complete** — A markdown report is generated at `.pi/missions/report.md` covering timings, outcomes, and git history.

### Orchestrator and Workers

The orchestrator is the main pi session LLM, augmented with mission-specific tools via the extension. It never writes code directly during execution — all implementation is delegated to workers.

Workers are spawned as isolated pi processes:

```
pi --mode json -p --no-session \
  --model <worker-model> \
  --skill .pi/missions/runtime/<featureId>/<attempt>/worker-skill.md \
  --append-system-prompt .pi/missions/runtime/<featureId>/<attempt>/worker-context.md \
  "<feature prompt>"
```

Workers have standard pi tools (read, bash, edit, write) and operate on the same project directory. They don't know about missions — they receive a task and execute it. The orchestrator's `edit` and `write` tools are restricted during execution to enforce delegation.

## Installation

### Prerequisites

- [pi](https://github.com/mariozechner/pi-coding-agent) with extension support
- Node.js 18+
- Git (optional — missions work without it, git features degrade gracefully)

### Install

```bash
pi install pi-missions
```

### From Source

```bash
git clone https://github.com/0xkuze/pi-missions.git
cd pi-missions
bun install
```

## Commands

### Slash Commands

| Command | Description |
|---------|-------------|
| `/mission-mode` | Toggle mission mode on or off. Activates/deactivates mission tools and protocol injection. Pauses active missions on deactivation. |

All other mission actions (start, approve, pause, resume, skip, redirect, reset, model switching) are handled through **Mission Control** (`Ctrl+Shift+M`).

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+M` | Open Mission Control overlay |

### Mission Control Actions

| Key | Action |
|-----|--------|
| `P` | Pause / Resume |
| `S` | Skip current feature |
| `D` | Mark mission done (sends complete_mission instruction) |
| `R` | Redirect (send new instructions to the orchestrator) |
| `M` | Open model assignment view |
| `V` | Show validation results |
| `L` | Show progress logs |
| `H` | Show plan mutation history |
| `X` | Reset mission (with confirmation) |
| `N` | New mission (from mission list view) |
| `Tab` | Switch active pane (left / right-top / right-bottom) |
| `Esc` | Close overlay or go back |

Mission Control supports mouse wheel scrolling on individual panes and arrow key / page up/down navigation within the active pane.

## State Machine

Every mission follows a deterministic state machine. All transitions are triggered by explicit tool calls or commands, never by parsing LLM output.

```
idle → planning → draft_review → approved → executing ⇄ validating → completed
                                                ↑                          
                                                └── fix features ──────────┘

Any active state → paused (stores resumeTargetState)
Any state → aborted (via reset)
Any state → failed (unrecoverable error)
```

**States:** `planning`, `draft_review`, `approved`, `executing`, `validating`, `paused`, `completed`, `failed`, `aborted`

## Orchestrator Tools

The extension registers these tools for the orchestrator LLM:

| Tool | Description |
|------|-------------|
| `submit_plan` | Submit a structured plan with milestones, features, acceptance criteria, and model suggestions. Transitions to `draft_review`. |
| `spawn_worker` | Spawn an isolated worker for a feature. Blocks until complete. Handles auto-commit, validator review, milestone auto-start/complete. |
| `run_validation` | Run validation commands at milestone boundaries. Returns structured pass/fail results per command. |
| `create_fix_feature` | Create a targeted fix feature in response to worker failures or validation failures. |
| `update_mission_state` | Communicate status changes: start/complete milestones, skip/block features, add notes. |
| `complete_mission` | Finalize the mission, generate the completion report. |
| `ask_questions` | Present structured questions to the user via interactive overlay during planning. |
| `commit_changes` | Stage and commit files changed by a specific feature. |

## Configuration

### Global Configuration

Global preferences live at `~/.pi/missions/global-config.json`, set during onboarding:

```jsonc
{
  "models": {
    "orchestrator": "opus-4.6",
    "worker": "opencode-go/glm-5",
    "validator": "openaicodex/gpt-5.4"
  },
  "promptingMode": "caveman",       // "default" | "caveman" | "caveman-full"
  "spawnAndLearn": true,
  "onboardingCompleted": true
}
```

### Per-Mission Configuration

Mission-specific overrides live at `.pi/missions/config.json`:

```jsonc
{
  "models": {
    "orchestrator": "claude-sonnet-4-20250514",
    "worker": "claude-sonnet-4-20250514",
    "validator": "claude-sonnet-4-20250514"
  },

  // Assign different worker models by feature complexity
  "modelByComplexity": {
    "low": "claude-haiku-4",
    "medium": "claude-sonnet-4-20250514",
    "high": "claude-opus-4"
  },

  // Prompting mode override
  "promptingMode": "caveman",

  // Spawn-and-learn mode
  "spawnAndLearn": true,

  // Validation commands (auto-detected from project if not set)
  "validation": {
    "commands": ["npm run typecheck", "npm run lint", "npm test", "npm run build"],
    "timeoutMs": 120000
  },

  // Autonomy level
  "autonomy": "medium",
  // "low"    — pause after every feature for confirmation
  // "medium" — pause at milestone boundaries and on failures (default)
  // "high"   — run to completion, only pause on critical failures

  // Git behavior
  "git": {
    "autoCommit": true    // disabled automatically if repo is dirty at mission start
  },

  // Retry limit per feature
  "maxRetries": 3,

  // Worker process timeout (default: 10 minutes)
  "workerTimeoutMs": 600000
}
```

### Model Resolution Priority

1. Complexity-based model (`modelByComplexity`) for workers
2. Explicit config in `config.json`
3. Model suggestions from the plan (`submit_plan` call)
4. Global config (`~/.pi/missions/global-config.json`)
5. Built-in defaults

### Validation Discovery

When no commands are configured, pi-missions auto-detects from your project:

| Source | Detection |
|--------|-----------|
| `package.json` | `typecheck`, `lint`, `test`, `build` scripts |
| `bun.lock` | `bun test` |
| `Cargo.toml` | `cargo test` |
| `go.mod` | `go test ./...` |
| `setup.py` / `pyproject.toml` | `pytest` |
| `Makefile` | `test`, `lint`, `typecheck`, `build` targets |

Commands are sorted in canonical order: typecheck → lint → test → build. All run regardless of earlier results (no fail-fast).

## Persistence

### Filesystem Layout

```
.pi/missions/
├── plan.json                    # Mission structure (milestones, features)
├── state.json                   # Runtime lifecycle state
├── config.json                  # Per-mission configuration
├── plan-history.jsonl           # Append-only plan mutation log
├── report.md                    # Generated at completion
├── lock                         # Advisory file lock
├── active-session.json          # Lock metadata (session ID, PID)
└── runtime/
    ├── <feature-id>/
    │   └── <attempt>/
    │       ├── worker-skill.md
    │       ├── worker-context.md
    │       ├── worker-prompt.md
    │       ├── validator-skill.md
    │       ├── validator-prompt.md
    │       ├── worker.pid
    │       ├── stdout.log
    │       ├── stderr.log
    │       ├── result.json
    │       └── metadata.json
    └── validation/
        └── <milestone-id>/
            └── <timestamp>/
                ├── <command>-stdout.log
                ├── <command>-stderr.log
                └── result.json
```

### Global Files

```
~/.pi/missions/
├── global-config.json           # Onboarding preferences, default models
└── registry.json                # Cross-project mission registry
```

### Crash Recovery

If the orchestrator crashes mid-feature:

1. File locks are released on process exit
2. On next session start, the extension reads `state.json`
3. If a feature was in progress, it checks for `result.json`:
   - Complete result found → reconcile (mark done/failed)
   - No result → mark attempt as interrupted
4. If the state was paused, it auto-resumes to the `resumeTargetState`
5. Orphaned worker processes are detected via PID files and killed
6. Recovery context is injected into the orchestrator's next system prompt

### Session Entry Cache

State is mirrored to session entries (`mission-state-cache`) for fast widget restoration after `/compact`. Filesystem is always authoritative — session entries are a fallback cache only. A null sentinel is written on reset to prevent stale cache restoration.

## Project Structure

```
extensions/
├── index.ts                     # Entry point: event wiring, tool registration, recovery
├── types.ts                     # All interfaces, type definitions, TypeBox schemas
├── commands.ts                  # Slash command registration (/mission-mode)
├── config.ts                    # Config loading, validation discovery, model resolution
├── git.ts                       # Git operations (snapshot, diff, commit, out-of-scope detection)
├── report.ts                    # Markdown report generation
├── utils.ts                     # Shared helpers (generateId, formatDuration, getPiInvocation)
├── input-handler.ts             # User input transformation during execution
├── worker-pid.ts                # PID file management for orphaned worker detection
├── tools/
│   ├── submit-plan.ts           # submit_plan tool
│   ├── spawn-worker.ts          # spawn_worker tool (blocking, with validator integration)
│   ├── run-validation.ts        # run_validation tool
│   ├── commit-changes.ts        # commit_changes tool
│   ├── create-fix.ts            # create_fix_feature tool
│   ├── update-state.ts          # update_mission_state tool
│   ├── complete.ts              # complete_mission tool
│   ├── ask-questions.ts         # ask_questions tool (interactive overlay)
│   ├── validate-worker.ts       # Validator worker spawning and verdict parsing
│   └── result-synthesis.ts      # Worker result synthesis from JSON event stream
├── orchestrator/
│   ├── protocol.ts              # System prompt injection per state (default + caveman modes)
│   ├── caveman-rules.ts         # Caveman output style rules
│   ├── worker-prompt.ts         # Worker skill, prompt, and context generation
│   └── validator-prompt.ts      # Validator skill and prompt generation
├── state/
│   ├── manager.ts               # Filesystem persistence + session entry cache
│   ├── lock.ts                  # File locking + conflict detection
│   ├── transitions.ts           # State machine transitions
│   ├── plan-history.ts          # Append-only mutation log
│   ├── registry.ts              # Cross-project mission registry (~/.pi/missions/registry.json)
│   └── global-config.ts         # Global config loading/saving (~/.pi/missions/global-config.json)
└── ui/
    ├── widget.ts                # Always-visible progress widget
    ├── mission-control.ts       # Full TUI overlay with multi-panel layout
    ├── mission-list.ts          # Mission history list
    ├── draft-review.ts          # Draft plan review + approval component
    ├── plan-overlay.ts          # Plan viewer overlay
    ├── questions-overlay.ts     # Interactive questionnaire overlay
    ├── onboarding-overlay.ts    # First-run setup wizard
    ├── validation-view.ts       # Validation progress component
    ├── blocked-view.ts          # Blocked/failed feature component
    ├── report-view.ts           # Completion report + model view component
    ├── status-overlay.ts        # Quick status overlay
    ├── progress-log.ts          # Event timeline view
    ├── plan-history.ts          # Plan mutation history view
    ├── planning-setup.ts        # Planning phase view
    ├── count-progress.ts        # Progress counting logic
    └── frame.ts                 # Shared TUI frame primitives and theming
```

## Event Handling

The extension hooks into pi's lifecycle events:

| Event | Behavior |
|-------|----------|
| `session_start` | Load state from filesystem, run crash recovery, auto-resume from pause, acquire lock, handle lock conflicts, detect orphaned workers |
| `before_agent_start` | Inject orchestrator protocol into system prompt based on current state and prompting mode |
| `session_shutdown` | Kill active workers, auto-pause active missions |
| `session_compact` | Cache state to session entry for post-compact restoration |
| `session_before_compact` | Inject compact mission summary into custom instructions |
| `context` | Track context usage percentage for high-usage protocol switching |
| `input` | Transform user messages during execution |

## Tech Stack

| Technology | Role |
|------------|------|
| [pi](https://github.com/mariozechner/pi-coding-agent) | Host coding agent and extension runtime |
| TypeScript | Strict mode, full type safety |
| [TypeBox](https://github.com/sinclairzx81/typebox) | Runtime schema validation for tool parameters and state |
| [pi-tui](https://github.com/mariozechner/pi-coding-agent) | Terminal UI components for Mission Control |
| [Bun](https://bun.sh/) | Test runner and development tooling |
| [Biome](https://biomejs.dev/) | Linting and formatting |
| Node.js `child_process` | Worker process isolation |
| Filesystem (`.pi/missions/`) | Canonical state persistence |

## Development

### Setup

```bash
git clone https://github.com/0xkuze/pi-missions.git
cd pi-missions
bun install
```

### Tests

```bash
bun test                    # All tests (1861 tests across 52 files)
bun test --watch            # Watch mode
bun test test/tools/        # Specific directory
```

### Linting and Formatting

```bash
npx @biomejs/biome check extensions/          # Check
npx @biomejs/biome check --write extensions/  # Fix
```

### Type Checking

```bash
npx tsc --noEmit
```

## License

[MIT](LICENSE)
