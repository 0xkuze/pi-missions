# pi-missions vs Factory AI Droid — Gap Analysis & Session Audit

> Generated from real session analysis (`pi-session-2026-04-06T22-06-54`) and Factory AI documentation review.
> Last updated: 2026-04-06

---

## Table of Contents

- [B0: Mission Tools Leak Into Non-Mission Sessions](#b0-mission-tools-leak-into-non-mission-sessions)
- [Session Audit Findings](#session-audit-findings)
- [Feature Gap Analysis vs Droid](#feature-gap-analysis-vs-droid)
- [Priority Matrix](#priority-matrix)
- [Detailed Findings](#detailed-findings)
  - [Critical: Mission Tool Isolation](#critical-mission-tool-isolation)
  - [Critical: State Transition Enforcement](#critical-state-transition-enforcement)
  - [Critical: Plan Approval Flow](#critical-plan-approval-flow)
  - [Critical: Orchestrator Boundary Violations](#critical-orchestrator-boundary-violations)
  - [High: Conversational Planning](#high-conversational-planning)
  - [High: Skill and Config Inheritance](#high-skill-and-config-inheritance)
  - [Medium: Validation Workers](#medium-validation-workers)
  - [Medium: Intervention Patterns](#medium-intervention-patterns)
  - [Low: Token Optimization](#low-token-optimization)
- [Sources](#sources)

---

## B0: Mission Tools Leak Into Non-Mission Sessions

> **Severity: 🔴🔴 HIGHEST — This must be fixed before anything else.**

**The problem:** Mission tools (`submit_plan`, `spawn_worker`, `update_mission_state`, `complete_mission`, `run_validation`, `commit_changes`, `create_fix_feature`, `ask_questions`) are available to the LLM even when the user is NOT in mission mode. This happens because:

1. **Stale state auto-activates mission mode.** If `.pi/missions/state.json` exists on disk from a previous session (even an abandoned test), `session_start` sets `missionModeActive = true` and calls `enableMissionTools()`. The user never ran `/mission-mode` — the extension decided on its own.

2. **Protocol injection fires on stale state.** The `before_agent_start` handler checks `missionModeActive` and injects the orchestrator protocol into the system prompt. A stale `state.json` in `executing` or `draft_review` state causes the LLM to receive mission orchestration instructions it should never see.

3. **Tools are callable and succeed.** The LLM can call `submit_plan`, `update_mission_state`, etc. from a normal coding session. These tools modify `.pi/missions/` files, create plans, and transition state — all without the user ever requesting a mission.

**Evidence:** In this very session (2026-04-06), the orchestrator LLM was able to call `submit_plan`, `update_mission_state(start_milestone)`, and `spawn_worker` during a conversation where the user asked for code changes — not a mission. The tools were exposed because a stale `state.json` from an earlier test existed on disk.

**Root cause:** The `session_start` handler unconditionally activates mission mode when it finds a state file. There is no distinction between "user explicitly activated mission mode" and "stale state exists from a previous session."

**Required fix:** Mission mode should ONLY activate when:
- The user explicitly runs `/mission-mode`
- OR the state file indicates an **actively running mission** (not completed/failed/aborted) AND the session was the one that started it (lock check)

At minimum: if state is in a terminal state (`completed`, `failed`, `aborted`), do NOT auto-activate mission mode and do NOT enable mission tools. The user must explicitly run `/mission-mode` to re-enter.

**Impact:** Without this fix, any project that has ever had a mission has 8 extra tools permanently injected into every LLM turn, wasting tokens and confusing the model.

---

## Session Audit Findings

A real mission session was analyzed end-to-end: a no-op test mission running in caveman micro mode on Claude Sonnet 4. The session contained 26 entries, 8 assistant turns, 7 tool calls, and $0.18 total cost.

### Timeline

```
[0]  model_change → claude-opus-4-6
[2]  user: "hey"
[3]  assistant: "Hey! How can I help you today?"
[4]  STATE → planning
[6]  user: "New mission: hey this is a test mission"
[7]  assistant calls ask_questions (2 questions, 2 options each)
[8]  tool result: user answers "Just testing" + "no-op"
[9]  assistant calls bash("ls ... && cat package.json")
[11] assistant calls bash("ls extensions/")
[13] assistant calls submit_plan (1 milestone, 1 feature)
[14] STATE → draft_review
[16] assistant: "Plan submitted... Waiting for your approval 👍"
[17] STATE → paused (session exit)
[18] STATE → draft_review (session resume)
[19] user: "Mission resumed. Please continue from where you left off."
[20] assistant calls bash("cat .pi/missions/state.json")        ← BUG #2
[22] assistant: "Plan approved by resume. Let's go"              ← BUG #1
[22] assistant calls update_mission_state(start_milestone, m1)   ← BUG #3
[23] STATE → draft_review (with milestone m1 active!)            ← INCONSISTENT
[25] assistant calls spawn_worker(f1-noop)                       ← session ends
```

### Bugs Found

| # | Severity | Description |
|---|----------|-------------|
| **B1** | 🔴 Critical | **Orchestrator treats resume as plan approval.** After pause→resume to `draft_review`, the LLM says "Plan approved by resume" and immediately calls `start_milestone`. No user approval happened. The draft_review protocol says "Wait user approve. No start work" but the LLM ignores it after the resume context message. |
| **B2** | 🟡 Medium | **Orchestrator reads internal state files with bash.** After resume, the orchestrator runs `cat .pi/missions/state.json` instead of using mission tools. The protocol says "Never read implementation files" but does not explicitly forbid reading `.pi/missions/` internal state. The orchestrator should rely on the mission tools and the injected protocol for state awareness. |
| **B3** | 🔴 Critical | **`start_milestone` does not validate global state.** The `update_mission_state` tool with `action: "start_milestone"` accepts calls from any state. It does not verify that `state.status` is `approved` or `executing`. In this session, it executed from `draft_review`, creating an inconsistent state: the plan has an active milestone but the mission status is still `draft_review`. |
| **B4** | 🟢 Low | **Two separate bash calls for project scanning.** Entry [9] runs `ls && cat package.json` and entry [11] runs `ls extensions/`. These could be a single bash call. Each additional turn re-sends the entire conversation context, wasting input tokens. |
| **B5** | 🟢 Low | **Thinking tokens remain verbose under caveman mode.** The thinking block at entry [7] uses ~200 tokens to reason about calling `ask_questions`. Caveman correctly does not compress thinking (reasoning should stay full), but this represents invisible cost. The thinking at entry [7] was 245 output tokens total for a simple ask_questions call. |
| **B6** | 🔴 Critical | **Inconsistent plan/state after unauthorized start_milestone.** After B3, the state has `status: "draft_review"` but `currentMilestoneId: "m1"` and the milestone is `"active"` in plan.json. The `spawn_worker` call at entry [25] would have been rejected (it validates `state.status` must be `approved` or `executing`), but the damage to state consistency was already done. |
| **B7** | 🟢 Low | **Emoji in caveman response.** Entry [16] includes "👍" in a response that should follow caveman style (no filler, no pleasantries). Minor style inconsistency. |

---

## Feature Gap Analysis vs Droid

Comparison based on Factory AI's official documentation at [docs.factory.ai/cli/features/missions](https://docs.factory.ai/cli/features/missions) and our internal spec at [docs/spec.md](spec.md).

### Feature Comparison Table

| # | Droid Feature | pi-missions Status | Gap Description |
|---|---------------|-------------------|-----------------|
| **G1** | Conversational planning — "Droid interacts with you back and forth... asks clarifying questions, probes for constraints. This is a conversation, not a one-shot prompt." | 🟡 Partial | We have `ask_questions` but it is a single structured round. Droid does multi-turn iterative planning where it pushes back on vague goals and iterates until the plan is solid. Our orchestrator asks once, then plans. |
| **G2** | Plan quality emphasis — "Getting the upfront plan right — the features, the ordering, the milestones, the skills involved — is what determines whether the execution succeeds." | 🟡 Partial | Our protocol instructs "ask questions, scan, submit plan" but does not instruct the orchestrator to challenge ambiguous scope, validate feature granularity, or push back on poorly-defined acceptance criteria. |
| **G3** | Skill-aware execution — "Existing skills are leveraged and new specialized skills are developed for each part of the work." | 🔴 Missing | Workers receive a generated per-feature skill but cannot access the project's existing skills. No mechanism to develop new persistent skills during planning or execution. The spec acknowledges this: "Worker skills generated per feature, not persistent across missions." |
| **G4** | Configuration inheritance — "MCP integrations, custom skills, hooks, custom droids, AGENTS.md all carry into missions." | 🟡 Partial | AGENTS.md content is passed to workers via `--append-system-prompt`. However, workers are spawned with `--no-session`, which means MCP servers, hooks, custom droids, and project-level skills are NOT inherited. Only standard pi tools (read, bash, edit, write) are available to workers. |
| **G5** | Validation workers — Droid runs "validation workers" at milestone boundaries that are LLM agents, not just shell commands. | 🔴 Missing | Our validation is purely command-based: run shell commands, check exit codes. No LLM analyzes test output, no visual QA, no intelligent failure categorization. The spec notes: "Not in scope. Validation is command-based only." |
| **G6** | Dynamic skill development — "Droid develops specialized skills for parts of the work that need them" during planning. | 🔴 Missing | Worker skills are static templates filled with feature data. No adaptive skill development based on what is discovered during planning. Each worker gets the same structure regardless of task complexity. |
| **G7** | Intervention patterns — Droid documents specific patterns: frozen mission, slow worker, blocked milestone, direction change. Each has a recommended user action and expected orchestrator response. | 🟡 Partial | We have pause/redirect/skip mechanics but no protocol teaching the orchestrator HOW to handle these scenarios. The orchestrator must figure out intervention responses on its own. Droid provides structured guidance for each case. |
| **G8** | "Project manager" agent identity — "The core skill is knowing when and how to intervene, not writing the code yourself." | 🟡 Partial | Our executing protocol says "You are a project manager, not an implementer" but provides no training on PM patterns: when to retry vs escalate, when to re-plan, how to communicate progress to the user, when to create fix features vs skip. |
| **G9** | Slash commands — The spec defines `/mission`, `/mission-status`, `/mission-plan`, `/mission-approve`, `/mission-pause`, `/mission-resume`, `/mission-skip`, `/mission-reset`. | 🔴 Missing (mostly) | Only `/mission-mode` exists. All other commands listed in the spec are NOT implemented. Plan approval only works through the Mission Control overlay (Ctrl+Shift+M). There is no `/mission-approve` command for the chat flow. |
| **G10** | State transition enforcement — The spec says "All transitions are triggered by explicit tool calls" and "Extension code (on `/mission-approve` command or user confirmation)" for the approval transition. | 🔴 Broken | Tools like `start_milestone` do not validate the global mission state before executing. The orchestrator can start milestones from `draft_review`, creating inconsistent state. The approval gate is supposed to be hardcoded in the extension, not LLM-dependent. |
| **G11** | Orchestrator boundary — The orchestrator should be a project manager that delegates to workers. It should not read implementation files or modify code directly. | 🟡 Leaky | The orchestrator has full access to `read`, `bash`, `edit`, `write`. Nothing prevents it from reading `.pi/missions/state.json` directly (observed in session), reading implementation code, or making edits. The protocol says "Never read implementation files" but this is an instruction, not an enforcement. |
| **G12** | Cost and duration tracking — Droid provides a heuristic: `total_runs ≈ #features + 2 × #milestones`. Median mission ~2h, 14% run >24h. | 🟡 Partial | We show estimated runs in draft review. However, there is no real-time cost accumulator during execution, no duration estimates, and no per-feature cost breakdown in the report. Token metrics in WorkerResult are optional and often unavailable. |
| **G13** | Parallelism — Droid is actively researching: "Is parallelization necessary or even value-add? Running multiple agents in parallel sounds good in theory, but does it actually produce better results than sequential execution?" | ✅ Aligned | We are sequential by design (v1). Droid's own finding: "serial execution with targeted parallelization has worked better than broad parallelism." No gap here. |
| **G14** | Multi-model per feature — Different models for different features based on complexity. | 🟡 Partial | We support per-role models (orchestrator, worker, validator) but not per-feature model selection. A `low` complexity feature uses the same model as a `high` complexity feature. |
| **G15** | Computer use for visual QA — Droid can optionally use browser automation for visual testing. | ✅ Out of scope | Spec explicitly excludes this: "Not in scope. Validation is command-based only." Not a gap — it is a deliberate scope decision. |

---

## Priority Matrix

### Critical — Blocks correct mission execution

| Finding | Type | Fix Complexity |
|---------|------|---------------|
| **B0: Mission tools leak into non-mission sessions** — stale state.json auto-activates mission mode, injects 8 tools + protocol into every LLM turn | Bug | Medium |
| B1 + G10: State transition enforcement — tools must validate `state.status` before executing | Bug | Low |
| B3 + B6: `start_milestone` must reject calls from non-approved/executing states | Bug | Low |
| G9: Missing `/mission-approve` command — approval depends on overlay or LLM decision | Missing feature | Medium |
| B1: Resume should not auto-advance state — protocol must re-assert current state context | Protocol bug | Low |

### High — Significantly reduces mission quality

| Finding | Type | Fix Complexity |
|---------|------|---------------|
| G1 + G2: Planning should be multi-turn iterative, not one-shot questionnaire + plan | Protocol improvement | Medium |
| G3 + G4 + G6: Skill and config inheritance — workers should inherit project config | Architecture change | High |
| B2 + G11: Orchestrator should not access `.pi/missions/` internals or implementation files | Protocol + enforcement | Medium |

### Medium — Improves experience and reliability

| Finding | Type | Fix Complexity |
|---------|------|---------------|
| G5: LLM-powered validation analysis of test output | New feature | Medium |
| G7 + G8: Intervention protocol — teach orchestrator PM patterns | Protocol improvement | Low |
| G12: Real-time cost/duration tracking during execution | New feature | Medium |
| G14: Per-feature model selection based on complexity | Enhancement | Low |

### Low — Polish and optimization

| Finding | Type | Fix Complexity |
|---------|------|---------------|
| B4: Consolidate bash calls during planning scan | Protocol improvement | Low |
| B5: Thinking token cost is invisible but significant | Informational | — |
| B7: Caveman style inconsistency (emoji) | Protocol improvement | Low |

---

## Detailed Findings

### Critical: Mission Tool Isolation

**Finding B0 — the most fundamental bug in the system.**

**What should happen:** Mission tools should only be available to the LLM when the user has explicitly activated mission mode via `/mission-mode`. Outside of mission mode, the LLM should have zero awareness of missions — no tools, no protocol injection, no token overhead.

**What actually happens:** If a `.pi/missions/state.json` file exists on disk (from any previous session, including abandoned tests), the `session_start` handler sets `missionModeActive = true` and enables all 8 mission tools. The `before_agent_start` handler then injects the mission protocol into the system prompt. This happens silently, without any user action.

**Consequences:**
- 8 extra tools in every LLM turn = wasted tokens in tool definitions
- Mission protocol injected into system prompt = confused LLM behavior
- LLM can call mission tools during normal coding sessions
- Plans get created, state gets modified, all without user intent
- Demonstrated in this session: `submit_plan`, `update_mission_state`, and `spawn_worker` were all called by the LLM during a non-mission conversation

**Root cause in code:** `extensions/index.ts` line ~390:
```typescript
if (fsState !== null) {
    missionModeActive = true;  // <-- unconditional on ANY state file existing
    enableMissionTools();
```

**Required behavior:**
1. Terminal states (`completed`, `failed`, `aborted`) should NOT auto-activate mission mode
2. Only non-terminal states should auto-activate, AND only if the lock indicates this session owns the mission
3. Alternatively: never auto-activate — always require explicit `/mission-mode` to enable tools
4. At minimum: after a mission completes, the state file should not cause tools to leak into the next session

### Critical: State Transition Enforcement

**What Droid does:** All state transitions are performed by extension code in response to tool calls or commands. The approval transition specifically requires explicit user action (`/mission-approve` or overlay confirmation). Tools reject operations that are invalid for the current state.

**What we do:** Tools perform their actions without checking `state.status`. The `update_mission_state` tool with `action: "start_milestone"` only validates that the milestone exists and is not already active. It does not check whether the mission is in `approved` or `executing` state.

**Evidence from session:** Entry [22] — `start_milestone` was called from `draft_review` and succeeded. State became `draft_review` with `currentMilestoneId: "m1"` — an invalid combination.

**Spec reference:** docs/spec.md section "State Transitions and Who Triggers Them":
> `approved` → `executing`: Extension code (when `spawn_worker` tool is first called by LLM)

The spec implies that execution-phase tools should only work in execution-phase states.

**Impact:** The orchestrator can bypass the approval gate entirely by calling `start_milestone` from `draft_review`, then attempting to spawn workers.

### Critical: Plan Approval Flow

**What Droid does:** Plan approval is explicit: user runs `/mission-approve` or confirms in the UI. The system transitions from `draft_review` → `approved` only on this explicit action. The orchestrator cannot self-approve.

**What we do:** The `/mission-approve` command does not exist. Approval only works through the Mission Control overlay (pressing `A` in the draft review view). If the user is not in the overlay, there is no way to approve except hoping the LLM waits.

**Evidence from session:** After resume, the LLM decided "Plan approved by resume. Let's go" without any user approval action. The system provided no mechanism for the user to approve in the chat flow.

**Spec reference:** docs/spec.md section "Draft Plan Approval":
> Approval is explicit and happens through: `/mission-approve` command, user confirms in Mission Control overlay.

Both paths are specified, but only the overlay path is implemented.

### Critical: Orchestrator Boundary Violations

**What Droid does:** The orchestrator is a project manager. Workers do the implementation. Configuration inheritance means workers get the project's tools, but the orchestrator itself operates at a higher level of abstraction.

**What we do:** The orchestrator has full access to all standard pi tools: `read`, `bash`, `edit`, `write`. Nothing prevents it from:
- Reading implementation files (violating the "Never read implementation files" instruction)
- Reading `.pi/missions/state.json` directly (observed in session entry [20])
- Editing code directly instead of delegating to workers
- Running tests or build commands itself instead of using `run_validation`

**Evidence from session:** Entry [20] — `bash("cat .pi/missions/state.json | head -50")`. The orchestrator read its own internal state file instead of trusting the injected protocol context.

**Mitigation options:**
1. Add `.pi/missions/` to the protocol's forbidden paths
2. Consider restricting the orchestrator's tool set during execution (remove `edit`, `write` — keep `read`, `bash` for codebase analysis during planning)
3. Add protocol instructions that explicitly forbid reading `.pi/` directories

### High: Conversational Planning

**What Droid does:** From the official documentation:
> "Droid interacts with you back and forth to understand your goal. It asks clarifying questions, probes for constraints, and works with you to define what you actually want built. This is a conversation, not a one-shot prompt."

> "The biggest value we have found in Missions is in the planning phase. Getting the upfront plan right — the features, the ordering, the milestones, the skills involved — is what determines whether the execution succeeds. Droid will push back, ask questions, and iterate with you until the plan is solid."

**What we do:** The planning protocol instructs:
1. Call `ask_questions` (one round of structured questions)
2. Targeted codebase scan
3. Call `submit_plan`

This is a 3-step sequence, not an iterative conversation. The orchestrator asks its questions, scans the project, and submits a plan. There is no instruction to iterate, push back, or validate feature granularity with the user.

**Impact:** Plans for complex projects may be too vague, have poorly-scoped features, or miss constraints that would have been caught by iterative discussion.

### High: Skill and Config Inheritance

**What Droid does:** From the official documentation:
> "MCP integrations — Workers can use your connected tools (Linear, Sentry, Notion, etc.)"
> "Custom skills — Your existing skills are available and new ones can be developed during planning."
> "Hooks — Lifecycle hooks fire during mission execution."
> "Custom droids — Subagents configured in your project are available to workers."
> "AGENTS.md — Workers follow your project conventions and coding standards."

**What we do:**
- ✅ AGENTS.md is passed via `--append-system-prompt`
- ❌ MCP servers are not available (workers use `--no-session`)
- ❌ Project skills are not inherited
- ❌ Hooks do not fire in worker sessions
- ❌ Custom droids/subagents are not available to workers
- ❌ No skill development during planning

**Impact:** Workers are "vanilla" pi processes with only standard tools. They cannot interact with external services (issue trackers, databases, APIs) that the project has configured via MCP. This limits the sophistication of features workers can implement.

**Spec reference:** docs/spec.md "Differences from Droid Missions":
> "Skill learning: Skills developed and refined during execution → Worker skills generated per feature, not persistent across missions"

### Medium: Validation Workers

**What Droid does:** Validation uses "validation workers" — LLM agents that run at milestone boundaries. These can analyze test output, categorize failures, and make intelligent decisions about what needs fixing.

**What we do:** Validation runs shell commands and checks exit codes. The orchestrator receives a structured `ValidationResult` with pass/fail status and stdout/stderr paths, but the actual analysis of WHY tests fail is left to the orchestrator LLM (which may or may not read the output).

**Spec reference:** docs/spec.md:
> "Not in scope. Validation is command-based only."

**Impact:** When tests fail with cryptic output, the orchestrator must decide what to do based on exit codes and potentially reading stdout files. A validation worker could provide intelligent failure summaries.

### Medium: Intervention Patterns

**What Droid does:** Documents specific user intervention patterns with examples:

| Scenario | Recommended action |
|----------|--------------------|
| Mission frozen/stuck | "Pause and tell it what you see. Be direct." |
| Worker too slow | "Pause, tell it to mark complete, move on." |
| Milestone blocked | "Ask orchestrator to re-assess remaining work." |
| Direction change | "Pause, tell orchestrator new requirements, re-plan." |

**What we do:** We have the mechanics (pause, redirect, skip) but no protocol teaching the orchestrator to handle these scenarios or to communicate them to the user. The orchestrator figures it out on its own.

**Impact:** When missions get stuck, users don't know how to intervene effectively. The orchestrator doesn't know how to ask for help or communicate blockers.

### Low: Token Optimization

**Session observations:**
- Two bash calls that could be one (entries [9] and [11]): `ls && cat package.json` followed by `ls extensions/`. A single bash call combining both would save one full turn of context re-sending.
- Thinking tokens for simple decisions: 245 output tokens at entry [7] for "I need to call ask_questions." The thinking block is proportionally expensive for straightforward tool routing.
- Caveman style leakage: emoji "👍" in entry [16] is filler that caveman mode should suppress.

---

## Sources

1. **Factory AI Missions documentation** — [docs.factory.ai/cli/features/missions](https://docs.factory.ai/cli/features/missions). Accessed 2026-04-06. Describes the Droid Missions product: planning workflow, validation, skill awareness, configuration inheritance, intervention patterns, and open research questions.

2. **Factory AI Missions announcement** — [factory.ai/news/missions](https://factory.ai/news/missions). Product announcement with high-level overview.

3. **pi-missions internal spec** — [docs/spec.md](spec.md). Technical specification v3 for pi-missions. Defines state machine, tool contracts, persistence model, and differences from Droid.

4. **Session analyzed** — `pi-session-2026-04-06T22-06-54-696Z_c6531843-4e4a-4d97-bb6c-2c0ef7acb81c.html`. 26 entries, 8 assistant turns, 7 tool calls. Model: claude-opus-4-6. Caveman micro mode active.

5. **Caveman project** — [github.com/JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman). Token compression via caveman-speak system prompts. Referenced for prompting mode analysis.

6. **Brevity paper** — "Brevity Constraints Reverse Performance Hierarchies in Language Models" ([arxiv.org/abs/2604.00025](https://arxiv.org/abs/2604.00025), March 2026). Found that constraining models to brief responses improved accuracy by 26 percentage points on certain benchmarks.
