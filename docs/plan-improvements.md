# pi-missions — Improvement Plan

> Derived from [docs/differences-droid.md](differences-droid.md) gap analysis and session audit.
> Cross-referenced with [docs/spec.md](spec.md) and current codebase.
> Last updated: 2026-04-06

---

## Design Constraint

**`/mission-mode` is the only slash command.** All mission actions — approve, pause, resume, skip, reset, status, plan view — happen through **UI overlays and keyboard shortcuts** (Mission Control `Ctrl+Shift+M`, Draft Review overlay, contextual views). This matches how Factory AI Droid operates: the user interacts through a visual control surface, not chat commands.

---

## pi Core Reference

When implementing any fix, **consult the pi-mono source** for API capabilities, types, and behavior before guessing or assuming:

| What | Where |
|------|-------|
| Extension API types (`ExtensionAPI`, `ExtensionContext`, events) | `/Users/cristian/tmp/pi-mono/packages/coding-agent/src/core/extensions/types.ts` |
| Extension loader, runner, wrapper | `/Users/cristian/tmp/pi-mono/packages/coding-agent/src/core/extensions/` |
| `registerTool`, `registerCommand`, `registerShortcut` | `types.ts` lines ~1033–1050 |
| `getActiveTools()` / `setActiveTools()` | `types.ts` lines ~1112–1118 |
| `sendUserMessage()` | `types.ts` line ~1087 |
| `appendEntry()` | `types.ts` line ~1093 |
| `ctx.ui.setWidget()` | `types.ts` line ~134 |
| `ctx.ui.custom()` (overlays) | `types.ts` line ~108+ (`ExtensionUIContext`) |
| `ctx.ui.notify()`, `ctx.ui.confirm()`, `ctx.ui.select()`, `ctx.ui.input()` | `types.ts` `ExtensionUIContext` interface |
| TUI components (`Component`, `Focusable`, `matchesKey`, etc.) | `/Users/cristian/tmp/pi-mono/packages/tui/src/` |
| Agent session runtime (how sessions work) | `/Users/cristian/tmp/pi-mono/packages/coding-agent/src/core/agent-session-runtime.ts` |
| CLI flags (`--mode`, `--no-session`, `--skill`, `--model`, etc.) | `/Users/cristian/tmp/pi-mono/packages/coding-agent/src/cli/` |
| Keybindings system | `/Users/cristian/tmp/pi-mono/packages/coding-agent/src/core/keybindings.ts` |
| Model registry | `/Users/cristian/tmp/pi-mono/packages/coding-agent/src/core/model-registry.ts` |

**Rule:** If any step below mentions a pi API and you are unsure whether it exists or how it works, read the relevant file from pi-mono before implementing. Do not assume.

---

## Tier 1 — Critical (Blocks Correct Mission Execution)

These are bugs that cause missions to produce invalid state or bypass safety gates. **Ship together as one atomic push.**

---

### 1.1 🔴 B0: Mission Tools Leak Into Non-Mission Sessions

**File:** `extensions/index.ts` (~line 388–392)

**Problem:** Any existing `.pi/missions/state.json` — including terminal states (`completed`, `failed`, `aborted`) — unconditionally activates mission mode. This enables 8 tools + protocol injection in every LLM turn without user action.

**Root cause:** `session_start` checks `fsState !== null` but never checks `fsState.status`.

**Evidence:** In the audited session, `submit_plan`, `update_mission_state`, and `spawn_worker` were called during a normal coding conversation because a stale `state.json` from a previous test existed.

**Fix:**

1. In `session_start`, after loading `fsState`, check `TERMINAL_STATUSES.has(fsState.status)`:
   - If terminal → render a minimal widget ("✓ Last mission completed · Ctrl+Shift+M to view report · /mission-mode to start new") but do **not** set `missionModeActive = true`, do **not** call `enableMissionTools()`.
   - If non-terminal → activate normally (existing behavior).
2. Apply the same guard in the session-entry cache fallback path (~line 438).
3. Verify `before_agent_start` already short-circuits on `!missionModeActive` (line 462 — it does). No change needed there.
4. Verify that `enableMissionTools()` / `disableMissionTools()` use `getActiveTools()` / `setActiveTools()` correctly. Consult `pi-mono/packages/coding-agent/src/core/extensions/types.ts` lines ~1112–1118 for the exact contract.

**Complexity:** Medium

**Tests:**
- `session_start` with `state.status === "completed"` → `missionModeActive` stays false, tools not enabled, protocol not injected.
- `session_start` with `state.status === "executing"` → mission mode activates normally.
- `before_agent_start` returns `undefined` when `missionModeActive` is false.

---

### 1.2 🔴 B1+B3+B6: State Transition Enforcement in Tools

**Files:** `extensions/tools/update-state.ts`, `extensions/tools/spawn-worker.ts`

**Problem:** `start_milestone` does not validate `state.status` before executing. It was called from `draft_review` and succeeded, creating `draft_review` + active milestone — an invalid state combination. The approval gate is completely bypassable.

**Fix — add state guards at tool entry:**

| Action | Required `state.status` |
|---|---|
| `start_milestone` | `approved`, `executing` |
| `complete_milestone` | `executing`, `validating` |
| `skip_feature` | `executing` |
| `block_feature` | `executing` |
| `add_feature` | `planning`, `draft_review`, `executing` |
| `remove_feature` | `planning`, `draft_review`, `executing` |
| `spawn_worker` | `approved`, `executing` |

Implementation:

1. Create a `VALID_STATES_FOR_ACTION` constant map in `update-state.ts`:
   ```typescript
   const VALID_STATES_FOR_ACTION: Record<string, ReadonlySet<MissionStatus>> = {
     start_milestone: new Set(["approved", "executing"]),
     complete_milestone: new Set(["executing", "validating"]),
     skip_feature: new Set(["executing"]),
     block_feature: new Set(["executing"]),
     add_feature: new Set(["planning", "draft_review", "executing"]),
     remove_feature: new Set(["planning", "draft_review", "executing"]),
   };
   ```
2. At the top of `execute()`, after loading state, reject with a clear error message if `state.status` is not in the allowed set for the requested action.
3. In `spawn-worker.ts`, same pattern: reject if `state.status ∉ {approved, executing}`.
4. On first `spawn_worker` call from `approved` state, auto-transition to `executing` via `transitionState()`. Verify `transitionState` in `extensions/state/transitions.ts` supports the `approved → executing` forward transition (it does — `ALLOWED_FORWARD` maps `approved → executing`).

**Complexity:** Low

**Tests:**
- Each action from every invalid state returns an error string, not a state mutation.
- `start_milestone` from `draft_review` → rejected with clear message.
- `spawn_worker` from `draft_review` → rejected.
- `spawn_worker` from `approved` → succeeds and transitions state to `executing`.

---

### 1.3 🔴 B1: Resume Must Not Auto-Advance State

**Files:** `extensions/index.ts` (~line 407), `extensions/orchestrator/protocol.ts`

**Problem:** After pause→resume to `draft_review`, the LLM interprets the resume context as approval and calls `start_milestone`. The protocol does not strongly enough re-assert "you are in draft_review, wait for explicit approval."

**Fix:**

1. **Protocol hardening** in `draft_review` protocol section — add explicit text:
   ```
   The plan is awaiting user approval through the Mission Control UI (Ctrl+Shift+M → A).
   A session resume does NOT mean approval.
   Do NOT call start_milestone or spawn_worker.
   Do NOT self-approve.
   Wait for the user.
   ```

2. **Resume context message** — when `session_start` auto-resumes from pause to `draft_review`, set `pendingRecoveryContext` to:
   ```
   Mission resumed to draft_review. The plan is still awaiting user approval.
   The user must approve through Mission Control (Ctrl+Shift+M → A).
   Do NOT start execution.
   ```

3. **Defense in depth** — already covered by 1.2: `start_milestone` will reject calls from `draft_review` regardless of what the LLM tries. This is the hard gate; the protocol is the soft guide.

**Complexity:** Low

**Tests:**
- Protocol string for `draft_review` contains "does NOT mean approval" and "Do NOT call start_milestone".
- Recovery context for pause→`draft_review` resume contains approval wait instruction.

---

### 1.4 🔴 Plan Approval Gate (UI-Only)

**Files:** `extensions/ui/draft-review.ts`, `extensions/ui/mission-control.ts`, `extensions/index.ts`

**Problem:** Approval must happen exclusively through the UI overlay. The existing Draft Review overlay handles `A` → `{ kind: "approve" }` but we need to verify and harden the full flow.

**Fix — verify and harden:**

1. **Draft Review overlay** (`extensions/ui/draft-review.ts` line 125) already maps `A` to `{ kind: "approve" }`. Verify that the `MissionControlComponent` (line ~162) handles this by calling `transitionState(state, "approved")` and persisting via `saveState()`.

2. **Post-approval orchestrator kickoff** — after the overlay resolves with approval, inject a user message via `pi.sendUserMessage()`:
   ```
   Plan approved. Begin execution.
   ```
   This gives the orchestrator the signal to start calling `spawn_worker`. Consult `pi-mono/packages/coding-agent/src/core/extensions/types.ts` line ~1087 for `sendUserMessage` signature and options.

3. **Auto-open Draft Review** — when `submit_plan` transitions state to `draft_review`, the overlay should auto-open so the user immediately sees the plan and the `A` prompt. Check if this already happens in `extensions/tools/submit-plan.ts` or `extensions/index.ts`. If not, add it.

4. **Widget hint** — in `draft_review` state, widget should show:
   ```
   📋 Draft · 2 milestones, 8 features · Ctrl+Shift+M to review & approve
   ```
   Check `extensions/ui/widget.ts` for current `draft_review` rendering.

5. **Protocol cleanup** — remove any protocol language that implies the orchestrator can self-approve or that approval happens through conversation.

**Complexity:** Low–Medium

**Tests:**
- Overlay `A` key in draft_review → `transitionState` called with `"approved"`.
- After approval, `sendUserMessage` is called with execution kickoff text.
- Widget in `draft_review` includes "Ctrl+Shift+M" hint.

---

## Tier 2 — High (Significantly Reduces Mission Quality)

Each item is independently shippable. Not blockers, but the difference between mediocre and good mission outcomes.

---

### 2.1 🟡 G1+G2: Iterative Conversational Planning Protocol

**File:** `extensions/orchestrator/protocol.ts`

**Problem:** Planning is a rigid 3-step sequence (ask_questions → scan → submit_plan). Droid does multi-turn iterative planning where it pushes back on vague goals, challenges scope, and iterates until the plan is solid.

**Fix — rewrite the planning protocol text:**

Replace the step-by-step sequence with conversational guidance:

- *"Analyze the codebase first using read and bash. Then have a conversation with the user about scope, constraints, and priorities."*
- *"Challenge vague goals. Ask 'what does done look like?' for each major piece of work."*
- *"Each feature should be small enough for one worker to complete in under 30 minutes of wall time."*
- *"If scope is large, propose milestones incrementally and get user feedback before finalizing."*
- *"Push back if the user asks for too much in one feature. Split it."*
- *"Probe for edge cases, error handling expectations, testing requirements, and integration constraints."*
- *"Only call submit_plan when you are confident every feature has clear, testable acceptance criteria."*
- *"The plan is the most important part of the mission. A bad plan produces bad results. Spend time getting it right."*

`ask_questions` remains available as an optional structured tool but is not a required step — the orchestrator can ask questions naturally in chat.

**Complexity:** Medium (protocol text rewrite only, no code changes)

**Tests:** Protocol string assertions verifying iterative planning instructions exist.

---

### 2.2 🟡 G4+G3: Worker Config Inheritance

**Files:** `extensions/tools/spawn-worker.ts`, `extensions/orchestrator/worker-prompt.ts`

**Problem:** Workers spawn with `--no-session`, losing MCP servers, project skills, hooks, and custom tools. Only AGENTS.md content is inherited via `--append-system-prompt`.

**Fix (incremental phases):**

- **Phase A — Skills:** Detect project-level skills (`.pi/skills/`, `.agents/skills/`) and pass relevant ones to workers. Check pi-mono CLI source at `/Users/cristian/tmp/pi-mono/packages/coding-agent/src/cli/` for how `--skill` flags work — can workers receive multiple skills? Is there a `--skills-dir` flag?

- **Phase B — MCP Servers:** Investigate if workers can inherit MCP configuration. Check `/Users/cristian/tmp/pi-mono/packages/coding-agent/src/cli/` and `/Users/cristian/tmp/pi-mono/packages/coding-agent/src/core/` for MCP config loading. Look for flags like `--mcp-config`, `--mcp-server`, or environment variables. If no mechanism exists, document as a known limitation.

- **Phase C — Hooks:** Out of scope for now. Workers use `--no-session`, and hooks are session-bound in pi's architecture.

**Before implementing:** Read the pi CLI entry point and flag parsing in pi-mono to understand exactly which flags are available for spawned processes.

**Complexity:** High

**Tests:** Integration test verifying worker spawn command includes skill flags when project skills exist.

---

### 2.3 🟡 B2+G11: Orchestrator Boundary Enforcement

**Files:** `extensions/orchestrator/protocol.ts`, potentially `extensions/index.ts`

**Problem:** The orchestrator reads `.pi/missions/state.json` with bash (observed in session entry [20]) and has full access to `edit`/`write` during execution, letting it bypass the worker delegation model.

**Fix:**

1. **Protocol rules** added to executing protocol:
   - *"NEVER read files under `.pi/missions/`. Your mission tools provide all state awareness you need."*
   - *"During EXECUTION: do NOT use `edit` or `write`. All code changes MUST go through workers via `spawn_worker`."*
   - *"During PLANNING: you MAY use `read` and `bash` to analyze the codebase. Do NOT modify files."*

2. **Programmatic enforcement (recommended):** During `executing` and `validating` states, remove `edit` and `write` from the orchestrator's active tool set. Use `pi.getActiveTools()` / `pi.setActiveTools()` (see `pi-mono/packages/coding-agent/src/core/extensions/types.ts` lines ~1112–1118). Re-add them on pause or completion.

   Implementation sketch:
   ```typescript
   function restrictOrchestratorTools(): void {
     const active = pi.getActiveTools();
     const restricted = active.filter(t => t !== "edit" && t !== "write");
     pi.setActiveTools(restricted);
   }

   function restoreOrchestratorTools(): void {
     const active = pi.getActiveTools();
     if (!active.includes("edit")) pi.setActiveTools([...active, "edit", "write"]);
   }
   ```

   Call `restrictOrchestratorTools()` when transitioning to `executing`. Call `restoreOrchestratorTools()` when transitioning to `paused`, `completed`, or `aborted`.

   **Caution:** Verify that `setActiveTools` accepts arbitrary tool names and does not require re-registration. Read the implementation in pi-mono if unsure.

**Complexity:** Medium

**Tests:**
- Protocol for `executing` state contains "do NOT use edit or write".
- Active tools list during `executing` state does not include `edit` or `write`.

---

## Tier 3 — Medium (Improves Experience and Reliability)

---

### 3.1 G7+G8: Intervention Protocol & PM Patterns

**File:** `extensions/orchestrator/protocol.ts`

**Problem:** No protocol guidance for handling stuck missions, slow workers, blocked milestones, or user redirects. The orchestrator figures it out on its own, often poorly.

**Fix — add a "PM Patterns" block to the executing protocol:**

```
INTERVENTION PATTERNS:
- Feature fails twice → create a targeted fix feature addressing the specific failure.
- Feature exhausts retries (3x) → mark blocked, inform user clearly what went wrong and why.
- Validation fails → analyze the failing output, create targeted fix features, re-validate after fixes.
- User sends a redirect message → pause current plan, acknowledge the new direction, re-plan if scope changed.
- All features done but validation still fails → do NOT mark mission complete. Fix first.
- Communicate progress concisely after each feature completes: what was done, what is next.
- If blocked and unsure → ask the user. Do not spin.
```

**Complexity:** Low (protocol text only)

**Tests:** Protocol string for `executing` state contains intervention pattern keywords.

---

### 3.2 G5: Validation Output Summaries

**File:** `extensions/tools/run-validation.ts`

**Problem:** Orchestrator gets exit codes + file paths to stdout/stderr, but not actionable failure context. It must make a separate `bash cat` call to read the output.

**Fix:**

1. After validation commands complete, for each failing command, read the first 100 lines of its stderr and stdout.
2. Include this truncated output directly in the `ValidationResult.summary` field.
3. This gives the orchestrator immediate actionable context for creating fix features, without needing a separate tool call round-trip.

**Implementation note:** Use `readFileSync` with a byte limit to avoid reading huge log files. Truncate with a `"... [truncated, full output at {path}]"` suffix.

**Complexity:** Medium

**Tests:**
- Failing validation includes truncated output in summary.
- Passing validation has clean summary, no output dump.
- Large output files are truncated, not read in full.

---

### 3.3 G12: Duration Tracking in Widget and Report

**Files:** `extensions/types.ts`, `extensions/state/manager.ts`, `extensions/ui/widget.ts`, `extensions/tools/spawn-worker.ts`

**Problem:** No real-time elapsed time display, no per-feature duration breakdown in the report.

**Fix:**

1. Add `missionStartedAtMs?: number` to `MissionState` (epoch millis for fast arithmetic).
2. Widget computes elapsed as `Date.now() - missionStartedAtMs` and displays:
   ```
   ● Running ██▓░░ 4/10 · 23m elapsed
   ```
3. After each worker completes, its `durationMs` is already captured in `WorkerResult.metrics`. Accumulate into a `totalWorkerDurationMs` counter in state.
4. Report includes per-feature duration breakdown table.

**Complexity:** Medium

**Tests:**
- Widget renders elapsed time when state has `missionStartedAtMs`.
- Duration accumulates correctly across multiple worker completions.

---

### 3.4 G14: Per-Feature Model Selection by Complexity

**Files:** `extensions/config.ts`, `extensions/tools/spawn-worker.ts`

**Problem:** All features use the same worker model regardless of `estimatedComplexity`.

**Fix:**

1. Add to `MissionConfig`:
   ```typescript
   modelByComplexity?: {
     low?: string;
     medium?: string;
     high?: string;
   };
   ```
2. In `spawn-worker.ts`, model resolution order:
   1. `modelByComplexity[feature.estimatedComplexity]` if set
   2. `config.models.worker` (role-based default)
   3. Current session model (fallback)
3. Verify model IDs against `ctx.modelRegistry` at spawn time. Consult `/Users/cristian/tmp/pi-mono/packages/coding-agent/src/core/model-registry.ts` for the registry API.

**Complexity:** Low

**Tests:**
- `high` complexity feature uses `modelByComplexity.high` when configured.
- Missing complexity config falls through to role-based default.

---

## Tier 4 — Low (Polish)

---

### 4.1 B4: Protocol Guidance to Consolidate Bash Calls

**File:** `extensions/orchestrator/protocol.ts`

Add to planning protocol: *"When scanning the codebase, combine multiple commands into a single bash call to minimize turns. Example: `ls src/ && cat package.json && head -20 tsconfig.json`"*

**Complexity:** Low

---

### 4.2 B7: Style Consistency

**File:** `extensions/orchestrator/protocol.ts`

Add to all protocol states: *"Match the user's configured output style. No emoji, no filler, no pleasantries unless the user's style uses them."*

**Complexity:** Low

---

## Implementation Sequence

```
Phase 1 — Critical Fixes (atomic push, must ship together)          ~11h
  ├─ 1.1  B0: Tool isolation (session_start terminal guard)          2h
  ├─ 1.2  B1+B3+B6: State guards in update-state + spawn-worker     2h
  ├─ 1.3  B1: Resume protocol hardening + recovery context           1h
  ├─ 1.4  Approval gate (verify overlay flow, sendUserMessage)       2h
  └─ Tests for all of the above                                      4h

Phase 2 — Quality (iterative, each independently shippable)         ~8h
  ├─ 2.1  Iterative planning protocol rewrite                        2h
  ├─ 2.3  Orchestrator boundary enforcement (protocol + tools)       2h
  ├─ 3.1  PM intervention patterns (protocol text)                   1h
  ├─ 3.2  Validation output summaries                                2h
  └─ 3.3  Duration tracking in widget                                1h

Phase 3 — Advanced (independent items)                              ~6h
  ├─ 2.2  Worker config inheritance (skills, MCP investigation)      4h
  ├─ 3.4  Per-feature model selection                                1h
  └─ 4.1+4.2  Protocol polish (bash consolidation, style)           1h
```

**Total: ~25h across 3 phases.**

Phase 1 is non-negotiable — a mission running today hits B0 (tool leak) and B3 (state bypass) in every session. Phase 2+ is incremental improvement.

---

## Key Principle

> When in doubt about any pi API, flag, or behavior — **read the source** at `/Users/cristian/tmp/pi-mono/` before implementing. The spec describes what we want; pi-mono defines what we can actually do.
