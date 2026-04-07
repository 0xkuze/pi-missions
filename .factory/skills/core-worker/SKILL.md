---
name: core-worker
description: Implements and tests pi-missions extension features with TDD
---

# Core Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Any feature that modifies or adds to the pi-missions extension: tools, orchestrator protocol, worker prompt generation, state management, types, config, utility functions.

## Required Skills

None.

## Work Procedure

1. Read the feature description, acceptance criteria, and preconditions carefully.
2. Read all relevant source files listed in the feature.
3. Read existing test files for the modules you'll modify.
4. Write failing tests FIRST (red phase). Tests go in `test/` mirroring source structure. Use `bun:test` with `describe`/`it`/`expect`.
5. Run `bun test <test-file>` to confirm tests fail.
6. Implement the feature to make tests pass (green phase).
7. Run `bun test <test-file>` to confirm tests pass.
8. Run `bun test` (full suite) to confirm no regressions.
9. Run `npx tsc --noEmit` to confirm type safety.
10. Run `npx @biomejs/biome check --write extensions/` to fix formatting.
11. Call `report_result` with structured handoff.

### Code Conventions (CRITICAL)

- Strict TypeScript. No `any` except at pi API boundaries.
- `import type` for type-only imports. `.js` extensions on relative imports.
- TypeBox (`@sinclair/typebox`) for schemas. No Zod.
- Named exports. `export default function` only for extension entry point.
- No comments except `why` comments for external constraints.
- `const` always. `let` only when reassignment needed.
- Early returns and guard clauses. No deep nesting.
- Functions: top-level named use `function` declarations. Callbacks use arrows.
- Files: kebab-case.ts. Variables: camelCase. Types: PascalCase. Constants: SCREAMING_CASE.

## Example Handoff

```json
{
  "salientSummary": "Implemented report_result tool schema and registration. Added TypeBox schema with all required fields. Updated result-synthesis to extract handoff from tool_execution_end events. 6 new tests, all passing.",
  "whatWasImplemented": "Added ReportResultSchema TypeBox definition in types.ts with fields: whatWasImplemented, whatWasLeftUndone, commandsRun, testsAdded, discoveredIssues. Updated synthesizeWorkerResult in result-synthesis.ts to detect report_result tool_execution_end events and extract structured handoff data. Worker marked as failed if report_result not called.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "bun test test/tools/result-synthesis.test.ts", "exitCode": 0, "observation": "12 tests pass including 6 new handoff tests" },
      { "command": "bun test", "exitCode": 0, "observation": "1867 tests pass, 0 fail" },
      { "command": "npx tsc --noEmit", "exitCode": 0, "observation": "No type errors" },
      { "command": "npx @biomejs/biome check extensions/", "exitCode": 0, "observation": "No lint errors" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      { "file": "test/tools/result-synthesis.test.ts", "cases": [
        { "name": "extracts handoff from report_result event", "verifies": "VAL-HANDOFF-002" },
        { "name": "marks worker failed when report_result missing", "verifies": "VAL-HANDOFF-003" },
        { "name": "preserves all handoff fields", "verifies": "VAL-HANDOFF-004" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on a type or module that doesn't exist yet
- Existing tests fail before your changes (pre-existing issue)
- Requirements conflict with AGENTS.md conventions
- You cannot make all tests pass within reasonable effort
