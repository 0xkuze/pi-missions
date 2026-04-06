<p align="center">
  <img src="https://img.shields.io/badge/pi-missions-7c3aed?style=for-the-badge&labelColor=1e1e2e&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM3YzNhZWQiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTIgMmwzLjA5IDYuMjZMIDIyIDkuMjdsLTUgNC44NyAxLjE4IDYuODhMMTIgMTcuNzdsLTYuMTggMy4yNUw3IDEzLjE0IDIgOS4yN2w2LjkxLTEuMDFMMTIgMnoiLz48L3N2Zz4=" alt="pi-missions" />
</p>

<h1 align="center">pi-missions</h1>

<p align="center">
  <strong>Factory AI Missions-inspired orchestration for <a href="https://github.com/nichochar/pi-coding-agent">pi</a></strong>
  <br />
  <em>Describe a goal → Plan with AI → Execute with isolated workers → Ship with confidence</em>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> •
  <a href="#features">Features</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#commands">Commands</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#faq">FAQ</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/tests-1506_passing-brightgreen?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/pi-v0.65.0+-7c3aed?style=flat-square" alt="Pi Compatible" />
</p>

---

```
╭─ Mission Control ──────────────────────╮ ╭─ Mission Outline ─────────────╮
│ ● jwt-tokens                           │ │ Milestone 1: Foundation       │
│ Milestone: auth                        │ │  ✓ user-model                 │
│ Worker: claude-sonnet-4                │ │  ✓ password-hashing           │
│ Attempt: 1/3                           │ │  ✓ login-endpoint             │
│                                        │ │  ● jwt-tokens                 │
│ Acceptance Criteria                    │ │  ○ refresh-tokens             │
│  • JWT signing with RS256              │ │                               │
│  • Token refresh endpoint              │ │ Milestone 2: Validation       │
│  • 15m access / 7d refresh             │ │  ○ auth audit                 │
│                                        │ ├─ Progress Log ───────────────┤
│ Warnings                               │ │ 2m   ✓ user-model done       │
│  • Repo dirty: auto-commit off         │ │ 5m   ✓ password-hashing      │
╰────────────────────────────────────────╯ │ 14m  ● jwt-tokens start      │
                                           ╰───────────────────────────────╯
P: Pause  R: Redirect  X: Reset  Esc: Close
```

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Quickstart](#quickstart)
- [Installation](#installation)
- [Architecture](#architecture)
- [Commands](#commands)
- [Configuration](#configuration)
- [Mission Control TUI](#mission-control-tui)
- [Comparison: pi-missions vs Factory AI Droid](#comparison-pi-missions-vs-factory-ai-droid)
- [Tech Stack](#tech-stack)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## Features

🎯 **Planning-First Workflow** — The AI orchestrator converses with you, analyzes your codebase, asks clarifying questions, and drafts a structured plan before writing any code.

🧩 **Structured Missions** — Goals are broken into milestones containing features, with validation checkpoints at every milestone boundary.

🔀 **Isolated Workers** — Each feature is executed by a fresh, isolated pi process with clean context. No cross-contamination between tasks.

✅ **Automated Validation** — Typecheck, lint, test, and build commands run at milestone boundaries. Failures automatically generate fix features.

🎮 **Mission Control TUI** — A full terminal overlay (`Ctrl+Shift+M`) to monitor progress, pause/resume, redirect, switch models, and view logs in real-time.

🔧 **Self-Healing** — When workers fail or validation catches issues, the orchestrator creates fix features and retries automatically.

💾 **Crash-Safe Persistence** — All state lives on the filesystem under `.pi/missions/`. Survives session switches, crashes, and `/compact`. Resume exactly where you left off.

🔒 **Git Safety** — Pre-mission snapshots, per-feature change tracking, selective staging (never `git add -A`), and dirty-repo awareness. Works without git too.

🤖 **Multi-Model Support** — Assign different models to orchestrator, worker, and validator roles. Switch models mid-mission from Mission Control.

📊 **Detailed Reporting** — Generates a comprehensive report at mission completion: timings, outcomes, fix features, git commits, and deviations.

⏸️ **Full User Control** — Pause, resume, skip features, redirect the orchestrator, re-plan, or abort at any time. You're the project manager.

🔍 **Interactive Planning** — Ask questions tool presents structured questionnaires during planning so the AI gathers exactly the constraints it needs.

---

## How It Works

pi-missions turns your pi session into a project manager + engineering team:

```
 You                    Orchestrator (main LLM)              Workers (isolated pi processes)
  │                            │                                       │
  │  /mission "Build auth"     │                                       │
  ├───────────────────────────>│                                       │
  │                            │── reads codebase, AGENTS.md ──>       │
  │                            │── asks clarifying questions ──>       │
  │  answer questions          │                                       │
  ├───────────────────────────>│                                       │
  │                            │── submit_plan ──>                     │
  │  /mission-approve          │                                       │
  ├───────────────────────────>│                                       │
  │                            │── spawn_worker(feature-1) ──────────> │ ← fresh pi process
  │                            │<──── WorkerResult ────────────────────│
  │                            │── commit_changes ──>                  │
  │                            │── spawn_worker(feature-2) ──────────> │ ← fresh pi process
  │                            │<──── WorkerResult ────────────────────│
  │                            │── run_validation(milestone-1) ──>     │
  │                            │   (typecheck ✓, lint ✓, test ✓)       │
  │                            │── spawn_worker(feature-3) ──────────> │
  │                            │   ...                                 │
  │                            │── complete_mission ──>                │
  │  📊 report.md              │                                       │
  │<───────────────────────────│                                       │
```

### The Lifecycle

1. **Plan** — You describe a goal. The orchestrator explores your codebase, asks questions, and drafts a plan with milestones and features.
2. **Review** — You review the draft plan in a structured overlay. Approve it, or keep refining.
3. **Execute** — The orchestrator spawns isolated worker processes one feature at a time. Each worker gets a generated skill and prompt scoped to its task.
4. **Validate** — At milestone boundaries, validation commands (typecheck, lint, test, build) run automatically. Failures trigger fix features.
5. **Complete** — A detailed report is generated with timings, outcomes, and git history.

---

## Quickstart

```bash
# 1. Install pi-missions into your pi extensions
cd your-project
pi install pi-missions

# 2. Start a mission
/mission "Add user authentication with JWT tokens, password hashing, and role-based access control"

# 3. Answer the orchestrator's questions about your project
# 4. Review and approve the plan
/mission-approve

# 5. Watch it work — open Mission Control anytime
# Press Ctrl+Shift+M
```

The orchestrator handles everything from there: spawning workers, committing changes, running validation, creating fix features for failures, and generating a final report.

---

## Installation

### Prerequisites

- [pi](https://github.com/nichochar/pi-coding-agent) v0.65.0 or later
- Node.js 18+
- Git (optional, but recommended)

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

Then symlink or copy the `extensions/` directory to your pi extensions path.

---

## Architecture

### State Machine

Every mission follows a deterministic state machine. All transitions are triggered by explicit tool calls — never by regex parsing of LLM output.

```
                          ┌──────────────────────────────────────────┐
                          │                                          │
  ┌──────┐  /mission   ┌──────────┐  submit_plan  ┌──────────────┐  │
  │ idle │────────────> │ planning │──────────────>│ draft_review │  │
  └──────┘              └──────────┘               └──────┬───────┘  │
                                                          │ approve  │
                                                          v          │
                                              ┌──────────────┐       │
                                              │   approved   │       │
                                              └──────┬───────┘       │
                                                     │ spawn_worker  │
                                                     v               │
                                  ┌───────────────────────────┐      │
                          ┌──────>│        executing          │<─────┘
                          │       └─────┬──────────────┬──────┘  fix features
                          │             │              │
                          │  run_validation    complete_mission
                          │             v              v
                          │     ┌──────────────┐  ┌───────────┐
                          └─────│  validating  │  │ completed │
                                └──────────────┘  └───────────┘

   Any state ──── /mission-pause ───> ⏸ paused (stores resumeTargetState)
   Any state ──── /mission-reset ───> ✗ aborted
   Any state ──── unrecoverable ────> ✗ failed
```

### Orchestrator → Worker Flow

```
┌─────────────────────────────────────────────────────────┐
│  Main pi Session (Orchestrator)                         │
│                                                         │
│  LLM + mission tools (submit_plan, spawn_worker, ...)   │
│  + standard pi tools (read, bash, edit, write)          │
│                                                         │
│  ┌─────────────────────────────────────────────┐        │
│  │  spawn_worker("jwt-tokens")                 │        │
│  │                                             │        │
│  │  1. Read feature from plan.json             │        │
│  │  2. Generate worker skill + prompt          │        │
│  │  3. Spawn child process:                    │        │
│  │     pi --mode json -p --no-session          │        │
│  │        --model claude-sonnet-4              │        │
│  │        --skill worker-skill.md              │        │
│  │        "Implement JWT token signing..."     │        │
│  │  4. Block until exit                        │        │
│  │  5. Synthesize WorkerResult                 │        │
│  └─────────────────┬───────────────────────────┘        │
│                    │                                    │
└────────────────────┼────────────────────────────────────┘
                     │ spawn
                     v
┌─────────────────────────────────────────────────────────┐
│  Worker Process (Isolated)                              │
│                                                         │
│  • Fresh pi session, no mission awareness               │
│  • Standard tools only: read, bash, edit, write         │
│  • Scoped by skill + prompt to a single feature         │
│  • Operates on the same project directory               │
│  • Never commits — orchestrator handles git             │
└─────────────────────────────────────────────────────────┘
```

### Persistence Layout

```
.pi/missions/
├── plan.json                    # Mission structure (milestones, features)
├── state.json                   # Runtime lifecycle state
├── config.json                  # User configuration
├── plan-history.jsonl           # Append-only plan mutation log
├── report.md                    # Generated at completion
├── lock                         # Advisory file lock
├── active-session.json          # Lock metadata
└── runtime/
    ├── <feature-id>/
    │   └── <attempt>/
    │       ├── worker-skill.md
    │       ├── worker-context.md
    │       ├── worker-prompt.md
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

### Project Structure

```
extensions/
├── index.ts                     # Entry point: event wiring, tool registration
├── types.ts                     # All interfaces and type definitions
├── commands.ts                  # Slash command registration
├── config.ts                    # Config loading, validation discovery
├── git.ts                       # Git operations (snapshot, diff, commit)
├── report.ts                    # Report generation
├── utils.ts                     # Shared helpers
├── tools/
│   ├── submit-plan.ts           # submit_plan — structured plan submission
│   ├── spawn-worker.ts          # spawn_worker — blocking worker execution
│   ├── run-validation.ts        # run_validation — milestone validation
│   ├── commit-changes.ts        # commit_changes — git operations
│   ├── create-fix.ts            # create_fix_feature — failure recovery
│   ├── update-state.ts          # update_mission_state — status changes
│   ├── complete.ts              # complete_mission — finalization
│   ├── ask-questions.ts         # ask_questions — interactive questionnaires
│   └── result-synthesis.ts      # Worker result synthesis from JSON events
├── orchestrator/
│   ├── protocol.ts              # System prompt injection per state
│   └── worker-prompt.ts         # Worker skill + prompt generation
├── state/
│   ├── manager.ts               # Filesystem persistence + session cache
│   ├── lock.ts                  # File locking
│   ├── transitions.ts           # State machine transitions
│   ├── plan-history.ts          # Append-only mutation log
│   └── registry.ts              # Cross-project mission registry
└── ui/
    ├── widget.ts                # Always-visible progress widget
    ├── mission-control.ts       # Full TUI overlay (Ctrl+Shift+M)
    ├── mission-list.ts          # Mission history list with fuzzy search
    ├── draft-review.ts          # Draft plan review component
    ├── plan-overlay.ts          # Plan viewer overlay
    ├── questions-overlay.ts     # Interactive questionnaire overlay
    ├── validation-view.ts       # Validation progress component
    ├── blocked-view.ts          # Blocked mission component
    ├── report-view.ts           # Completion report component
    ├── status-overlay.ts        # Quick status overlay
    ├── progress-log.ts          # Event timeline
    ├── plan-history.ts          # Plan mutation history
    ├── planning-setup.ts        # Planning phase view
    └── frame.ts                 # Shared TUI frame primitives
```

---

## Commands

### Slash Commands

| Command | Description | Valid States |
|---------|-------------|--------------|
| `/mission <description>` | Start a new mission | `idle` |
| `/mission` | Quick status check | any |
| `/mission-status` | Detailed status overlay | any active |
| `/mission-plan` | View current plan | `draft_review`, `approved`, `executing`, `paused` |
| `/mission-approve` | Approve draft plan, begin execution | `draft_review` |
| `/mission-pause` | Pause the mission | `planning`, `executing`, `validating` |
| `/mission-resume` | Resume from pause | `paused` |
| `/mission-skip` | Skip the current feature | `executing` |
| `/mission-reset` | Abort and clear all mission state | any |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+M` | Open Mission Control overlay |

### Mission Control Keyboard Actions

| Key | Action |
|-----|--------|
| `P` | Pause / Resume |
| `R` | Redirect — send new instructions to the orchestrator |
| `X` | Reset mission |
| `M` | Open model assignment sub-view |
| `V` | Show validation results |
| `Esc` | Close overlay |

---

## Configuration

Mission configuration is stored in `.pi/missions/config.json`. All fields are optional with sensible defaults.

```jsonc
{
  // Model assignments per role
  "models": {
    "orchestrator": "claude-sonnet-4-20250514",   // Planning + execution decisions
    "worker": "claude-sonnet-4-20250514",          // Feature implementation
    "validator": "claude-sonnet-4-20250514"        // Reserved for future LLM validation
  },

  // Validation commands (auto-detected from package.json if not set)
  "validation": {
    "commands": ["npm run typecheck", "npm run lint", "npm test", "npm run build"],
    "timeoutMs": 120000    // Per-command timeout (default: 2 minutes)
  },

  // Autonomy level
  "autonomy": "medium",
  // "low"    — pause after every feature for confirmation
  // "medium" — pause at milestone boundaries and on failures (default)
  // "high"   — run to completion, only pause on critical failures

  // Git behavior
  "git": {
    "autoCommit": true     // Auto-commit after each feature (disabled if repo is dirty)
  },

  // Retry limit per feature
  "maxRetries": 3
}
```

### Model Resolution Priority

1. Explicit config in `config.json`
2. Model suggestions from the plan (`submit_plan` call)
3. Current session model (fallback)

### Validation Discovery

If no commands are configured, pi-missions auto-detects from your project:

| Source | Detection |
|--------|-----------|
| `package.json` | `typecheck`, `lint`, `test`, `build` scripts |
| `Makefile` | Corresponding targets |
| Ecosystem | `cargo test`, `go test ./...`, `pytest`, `bun test`, etc. |

Commands always run in order: **typecheck → lint → test → build** (no fail-fast — all run).

---

## Mission Control TUI

### Widget (Always Visible)

The widget bar shows compact mission status at all times:

```
● Running  ██████▓░░░  4/10 features  ·  Milestone: auth  ·  Feature: jwt-tokens
⏸ Paused   ██████▓░░░  4/10 features  ·  waiting for input
⏳ Planning ·  analyzing codebase...
📋 Draft    ·  2 milestones, 8 features  ·  awaiting approval
✓ Done     ██████████  10/10 features  ·  report ready
✗ Failed   ██████░░░░  6/10 features   ·  blocked on jwt-tokens
```

Progress bar: `█` done · `▓` active · `░` pending

### Mission Control Overlay (`Ctrl+Shift+M`)

Full-screen TUI overlay with multi-panel layout:

```
╭─ Current Feature ──────────────────────╮ ╭─ Mission Outline ─────────────╮
│ jwt-tokens                             │ │ Milestone 1: Foundation       │
│ Milestone: auth                        │ │  ✓ user-model                 │
│ Worker: claude-sonnet-4                │ │  ✓ password-hashing           │
│ Attempt: 1/3                           │ │  ✓ login-endpoint             │
│                                        │ │  ● jwt-tokens                 │
│ Acceptance Criteria                    │ │  ○ refresh-tokens             │
│  • JWT signing with RS256              │ ├─ Progress Log ───────────────┤
│  • Token refresh endpoint              │ │ 2m   ✓ user-model done       │
│  • 15m access / 7d refresh             │ │ 5m   ✓ password-hashing      │
╰────────────────────────────────────────╯ │ 14m  ● jwt-tokens start      │
                                           ╰───────────────────────────────╯
P: Pause  R: Redirect  X: Reset  Esc: Close
```

### Draft Plan Review

```
╭─ Draft Mission Plan ──────────────────────────────────────────────────────╮
│ Mission: Build multi-tenant auth system                                  │
│                                                                          │
│ Milestone 1: Foundation (3 features)                                     │
│  • user-model: Create User entity and migration                          │
│  • tenant-model: Create Tenant entity with relations                     │
│  • session-strategy: Implement session management                        │
│                                                                          │
│ Validation: npm run typecheck · npm test · npm run lint                   │
│ Models:     Worker: claude-sonnet-4 · Est. runs: ~10                     │
╰──────────────────────────────────────────────────────────────────────────╯
A: approve   Esc: back to chat
```

### Validation View

```
╭─ Milestone Validation ────────────────────────────────────────────────────╮
│ Milestone: Auth Flows                                                    │
│                                                                          │
│ ✓ typecheck ·························· 2.1s                              │
│ ● test ·······························                                   │
│ ○ build                                                                  │
│                                                                          │
│ Failures will generate fix features before the mission can proceed.      │
╰──────────────────────────────────────────────────────────────────────────╯
```

---

## Comparison: pi-missions vs Factory AI Droid

pi-missions replicates the core workflow of [Factory AI's Droid Missions](https://www.factory.ai/) within pi's terminal extension architecture.

| Aspect | Factory AI Droid | pi-missions |
|--------|-----------------|-------------|
| **Runtime** | Cloud containers or local | Local only (pi processes) |
| **Worker isolation** | Separate cloud sessions | Spawned pi processes (`--no-session`) |
| **Planning** | Conversational, multi-turn | Conversational, multi-turn ✓ |
| **Structured plans** | Milestones → features | Milestones → features ✓ |
| **Validation** | Commands + computer-use (visual QA) | Commands only (typecheck, lint, test, build) |
| **Fix features** | Auto-generated on failure | Auto-generated on failure ✓ |
| **Parallelism** | Targeted within milestones | Sequential (v1) |
| **Multi-model** | Per-role model assignment | Per-role model assignment ✓ |
| **Persistence** | Cloud-managed state | Filesystem (`.pi/missions/`) |
| **UI** | IDE integration + CLI | Terminal TUI overlay |
| **Skill learning** | Skills refined across missions | Per-feature skill generation |
| **User control** | Pause, redirect, skip | Pause, redirect, skip, re-plan ✓ |
| **Git safety** | Built-in | Snapshot, selective staging, dirty-repo aware ✓ |
| **Crash recovery** | Cloud-managed | Filesystem + lock-based recovery ✓ |
| **Duration profile** | Median ~2h, up to 16 days | Same — long-running missions supported |
| **Enterprise** | SSO, RBAC, audit logging | Not in scope |
| **Cost** | Commercial SaaS | Free and open source |

---

## Tech Stack

| Technology | Role |
|------------|------|
| [pi](https://github.com/nichochar/pi-coding-agent) | Host coding agent and extension runtime |
| [TypeScript](https://www.typescriptlang.org/) | Strict mode, full type safety |
| [TypeBox](https://github.com/sinclairzx81/typebox) | Runtime schema validation for tool parameters |
| [pi-tui](https://github.com/nichochar/pi-coding-agent) | Terminal UI components for Mission Control |
| [Bun](https://bun.sh/) | Test runner and development tooling |
| [Biome](https://biomejs.dev/) | Linting and formatting |
| Node.js `child_process` | Worker process isolation |
| Filesystem (`.pi/missions/`) | Canonical state persistence |

---

## FAQ

<details>
<summary><strong>How is this different from just using pi normally?</strong></summary>
<br>

pi is a coding agent — it handles one task at a time in a single context. pi-missions adds orchestration on top: it breaks large goals into structured plans, executes each piece with isolated workers that have clean context, validates at checkpoints, auto-fixes failures, and tracks everything. Think of it as giving pi a project manager.

</details>

<details>
<summary><strong>Can I use different models for different parts of the mission?</strong></summary>
<br>

Yes. Configure `models.orchestrator` and `models.worker` in `.pi/missions/config.json`, or switch models live from the Mission Control overlay (`M` key). The orchestrator can also suggest models during planning.

</details>

<details>
<summary><strong>What happens if a worker fails?</strong></summary>
<br>

The orchestrator receives the full `WorkerResult` including error details, changed files, and commands run. It can retry the feature (up to `maxRetries`, default 3), create a fix feature to address the specific issue, skip the feature, or ask you for guidance. Validation failures at milestone boundaries also trigger automatic fix feature creation.

</details>

<details>
<summary><strong>Is my git history safe?</strong></summary>
<br>

Yes. pi-missions takes a pre-mission git snapshot, tracks per-feature file changes, and only stages files changed by each worker (never `git add -A`). If your repo is dirty before the mission starts, auto-commit is disabled by default. You can always review changes before they're committed.

</details>

<details>
<summary><strong>Can I pause and resume a mission?</strong></summary>
<br>

Absolutely. Use `/mission-pause` or press `P` in Mission Control. The current worker completes (it's not killed), but no new workers spawn. Resume with `/mission-resume`. State persists to the filesystem, so you can even close pi and resume in a new session.

</details>

<details>
<summary><strong>What if my session crashes mid-mission?</strong></summary>
<br>

All state lives on the filesystem under `.pi/missions/`. On the next session start, the extension detects the interrupted mission, reconciles any in-progress work (checking for completed results), and the orchestrator resumes from where it left off.

</details>

<details>
<summary><strong>Does it work without git?</strong></summary>
<br>

Yes. Git features degrade gracefully — validation, worker execution, and reporting all work without git. The `commit_changes` tool simply returns a skip message, and file change tracking uses filesystem-level summaries instead.

</details>

---

## Contributing

Contributions are welcome! pi-missions is built with clear conventions to make contributing straightforward.

### Development Setup

```bash
git clone https://github.com/0xkuze/pi-missions.git
cd pi-missions
bun install
```

### Running Tests

```bash
bun test                    # Run all 1506 tests
bun test --watch            # Watch mode
bun test test/tools/        # Run specific directory
```

### Linting & Formatting

```bash
npx @biomejs/biome check extensions/          # Check
npx @biomejs/biome check --write extensions/  # Fix
```

### Type Checking

```bash
npx tsc --noEmit
```

### Code Conventions

- **TypeScript strict mode** — no implicit returns, no unused variables
- **`interface`** for public API contracts, **`type`** for unions and aliases
- **`import type`** for type-only imports, **`.js`** extensions on relative imports
- **Zero comments** — if code needs explanation, refactor it
- **Early returns** and guard clauses — no deep nesting
- **Conventional commits** — `feat:`, `fix:`, `refactor:`, `test:`, `chore:`
- Tests must pass before every commit

### Architecture Principles

- All state transitions flow through explicit tool calls — no regex parsing of LLM output
- Filesystem is the source of truth, session entries are a cache
- Workers never know about missions — they receive a task and execute it
- The orchestrator LLM decides what to do; the extension provides tools it calls
- Keep it simple or don't do it

---

## License

[MIT](LICENSE) © [0xkuze](https://github.com/0xkuze)
