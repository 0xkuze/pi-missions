# pi-missions

Factory AI Missions-inspired orchestration extension for pi. Read `docs/spec.md` before making any architectural decisions.

## Architecture

This is a pi extension. The entry point is `extensions/index.ts` which exports a default function receiving `ExtensionAPI`. The extension registers LLM-callable tools, slash commands, keyboard shortcuts, event handlers, and UI components.

Workers are isolated pi processes spawned via `node:child_process`. The orchestrator is the main session LLM augmented with mission-specific tools. State lives on the filesystem under `.pi/missions/` with session entry caching for fast UI restore.

Do not deviate from the architecture in `docs/spec.md`. If a design question arises that the spec does not answer, ask before implementing.

## Project Structure

```
extensions/
  index.ts                  # Entry point: event wiring, tool registration
  types.ts                  # All interfaces and type definitions
  tools/                    # One file per orchestrator tool
  orchestrator/             # System prompt protocol, worker prompt generation
  state/                    # Filesystem persistence, locking, plan history
  ui/                       # Widget, mission control overlay, views
  git.ts                    # Git operations
  config.ts                 # Config loading, validation discovery
  commands.ts               # Slash commands
  report.ts                 # Report generation
  utils.ts                  # Shared helpers
```

## Runtime

The extension runs inside pi's Node.js process. Development tooling uses Bun (install, test, scripts). Never use Bun-specific APIs in extension code -- only Node.js built-ins and pi APIs.

## Code Rules

Keep it simple or don't do it. If you can't explain a function in one sentence, break it up. Delete dead code without hesitation. Never mix refactors with fixes in the same commit.

### TypeScript

- Strict mode. No implicit returns, no unused variables.
- `interface` for public API contracts and extensible shapes. `type` for unions, aliases, and everything else.
- Named exports for all library code. `export default function` only for the extension entry point.
- `import type` for type-only imports. `.js` extensions on all relative imports.
- TypeBox (`@sinclair/typebox`) for tool parameter schemas. No Zod.
- Prefer `unknown` over `any`. Allow `any` only at pi API boundaries where the extension types are loose -- never in domain logic.
- `const` always. `let` only when reassignment is genuinely needed.
- Early returns and guard clauses. No deep nesting.
- No enums. Use string union types.

### Errors

Throw for programmer errors (invalid state, missing required data). Encode failures in tool results for runtime errors (worker crashes, validation failures, git errors). Never swallow errors silently. Never use bare `catch (e) { console.error(e) }`.

### Comments

Zero comments in source code. If code needs explanation, the code is wrong -- refactor it. The only exception is a `why` comment for a genuinely non-obvious decision forced by an external constraint.

### Functions

Top-level named functions use `function` declarations. Callbacks and closures use arrow functions. Keep functions small. One job per function.

### Naming

- Files: `kebab-case.ts`
- Variables/functions: `camelCase`
- Types/interfaces/classes: `PascalCase`
- Constants: `SCREAMING_CASE`
- Event names: `snake_case` (matching pi convention)

### Imports

```typescript
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { someHelper } from "./utils.js";
```

Cross-package imports use the npm package name. Relative imports use `.js` extensions. Type-only imports use `import type`. No dynamic `import()` unless strictly necessary for lazy loading.

## Formatting

Biome. Matches pi-mono configuration:

- Indent: tabs, width 3
- Line width: 120
- `useConst`: error
- Run `biome check --write` before committing

## Testing

TDD. Write tests first, then implement. Use `bun:test` with `describe`/`it`/`expect`.

Test pure logic exhaustively: state management, tool implementations, utility functions, protocol generation, config resolution. For code that depends on the pi runtime (UI components, event handlers), test the logic extracted into pure functions, not the pi integration glue.

Test files live alongside source: `extensions/state/manager.test.ts` tests `extensions/state/manager.ts`.

Run tests: `bun test`

## Dependencies

Peer dependencies: `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@sinclair/typebox`. These are provided by pi at runtime.

External dependencies only for non-trivial problems (file locking, etc.). Do not add a dependency for something implementable in under 50 lines. Do not reinvent file locking or schema validation.

## Git

Conventional commits in English. One logical change per commit.

```
feat: add spawn_worker tool with blocking execution
fix: handle dirty repo in commit_changes
refactor: extract worker result synthesis into separate module
test: add state manager persistence tests
chore: configure biome
```

Group related tasks into one commit (all tool implementations together, all UI components together). Do not create one commit per line changed, but do not bundle unrelated changes either.

Never commit broken code. `bun test` and `biome check` must pass before every commit.

## Extension Patterns

### Tool Registration

```typescript
import { Type } from "@sinclair/typebox";

pi.registerTool({
  name: "submit_plan",
  label: "Submit Plan",
  description: "Submit a structured mission plan for review",
  parameters: Type.Object({
    description: Type.String({ description: "Mission description" }),
    milestones: Type.Array(/* ... */),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Validate, persist, update state, return result
    return { content: [{ type: "text", text: "Plan submitted" }] };
  },
});
```

### Command Registration

```typescript
pi.registerCommand("mission", {
  description: "Start or check mission status",
  handler: async (args, ctx) => {
    // args is the string after the command name
  },
});
```

### System Prompt Injection

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  const protocol = buildOrchestratorProtocol(state);
  return { systemPrompt: event.systemPrompt + "\n\n" + protocol };
});
```

### State Persistence

Filesystem is the source of truth. Session entries are a cache.

```typescript
import { writeFileSync, readFileSync } from "node:fs";

function saveState(state: MissionState): void {
  writeFileSync(".pi/missions/state.json", JSON.stringify(state, null, 2));
  pi.appendEntry("mission-state-cache", state);
}
```

### Worker Spawning

```typescript
import { spawn } from "node:child_process";

const proc = spawn(piCommand, [
  "--mode", "json", "-p", "--no-session",
  "--model", workerModel,
  "--skill", skillPath,
  prompt,
], { cwd: projectDir, stdio: ["ignore", "pipe", "pipe"] });
```

## What Not To Do

- Do not parse LLM output with regex to detect state transitions
- Do not store canonical state in session entries
- Do not let workers know about missions or orchestration
- Do not use `git add -A` in a dirty repository
- Do not block on user input inside a blocking tool call
- Do not add MCP, sub-agents, or plan mode -- this extension IS the plan mode
- Do not create README.md, CHANGELOG.md, or documentation files unless explicitly asked
- Do not add features not in `docs/spec.md` without asking first
- Do not implement fallback or temporary solutions. Fix the root cause. If the root cause is unclear, investigate further before writing code. A fallback masks the real problem and makes it harder to find later.
