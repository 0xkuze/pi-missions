# Extension Worker

You are implementing features for the `pi-missions` extension — a Factory AI Missions-inspired orchestration extension for pi.

## Procedure

1. **Read context files** (in this order):
   - `docs/spec.md` — the full technical specification. This is authoritative.
   - `AGENTS.md` — coding conventions and project rules. Follow these strictly.
   - `.factory/library/architecture.md` — system architecture overview.
   - Your assigned feature in `features.json` — the `description`, `preconditions`, `expectedBehavior`, and `verificationSteps`.

2. **Check preconditions**: Verify that all files and modules listed in the feature's `preconditions` exist and are functional. If a precondition is not met, return to orchestrator with `returnToOrchestrator: true`.

3. **Write tests first (TDD)**:
   - Create or update test files alongside source files (e.g., `extensions/state/manager.test.ts` for `extensions/state/manager.ts`).
   - Test pure logic exhaustively. For pi runtime dependencies (ExtensionAPI, ctx), test the extracted pure functions.
   - Use `bun:test` with `describe`/`it`/`expect`.
   - Run tests to confirm they fail: `bun test <test-file>`.

4. **Implement the feature**:
   - Follow the spec precisely. Do not deviate from the architecture in `docs/spec.md`.
   - Follow all coding conventions in `AGENTS.md` (strict TypeScript, tabs width 3, no comments, named exports, etc.).
   - Use `.js` extensions on all relative imports.
   - Use `import type` for type-only imports.
   - Use TypeBox (`@sinclair/typebox`) for tool parameter schemas.
   - Use `interface` for public API contracts, `type` for unions/aliases.
   - Early returns, guard clauses, no deep nesting.
   - Keep functions small — one job per function.

5. **Verify**:
   - Run all tests: `bun test`
   - Run biome check: `npx @biomejs/biome check --write extensions/`
   - Run biome check again without `--write` to confirm: `npx @biomejs/biome check extensions/`
   - Fix any failures before completing.

6. **Commit**: Make a single conventional commit for the feature.

## Key Constraints

- **No Bun-specific APIs in extension code** — only Node.js built-ins and pi APIs. Bun is for dev tooling only.
- **No comments in source code** — refactor instead of explaining.
- **Throw for programmer errors** — encode runtime failures in tool results.
- **Workers must not know about missions** — worker skill/prompt files must never contain mission terminology.
- **Filesystem is source of truth** — session entries are a cache, never authoritative.
- **Never `git add -A` in dirty repos** — selective staging only.
- **No enums** — use string union types.
- **`const` always** — `let` only when reassignment is genuinely needed.

## Pi API Patterns

When implementing tools:
```typescript
pi.registerTool({
  name: "tool_name",
  label: "Tool Label",
  description: "What this tool does",
  parameters: Type.Object({ /* TypeBox schema */ }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Return { content: [{ type: "text", text: "result" }] } for both success and runtime errors
    // Only throw for programmer errors (bugs)
  },
});
```

When implementing commands:
```typescript
pi.registerCommand("name", {
  description: "What this command does",
  handler: async (args, ctx) => { /* ... */ },
});
```

## Handoff Requirements

When returning your handoff, include:
- `filesChanged`: All files you created or modified
- `testsPassed`: Whether `bun test` passes
- `biomeClean`: Whether `biome check` passes
- Any discovered issues or things left undone
