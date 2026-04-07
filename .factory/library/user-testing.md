# User Testing

## Validation Surface

This is a pi extension with no web UI, API server, or browser surface.
All validation is through automated tests, typecheck, and lint.

## Testing Tools

- bun test: Unit and integration tests
- npx tsc --noEmit: Type checking
- npx @biomejs/biome check: Linting

## Validation Concurrency

No concurrent validation needed. All tests run in a single process.
Machine: 24GB RAM, 10 CPU cores.
Max concurrent validators per surface: 3 (bun test is I/O bound, 3 parallel runs safe).

## Flow Validator Guidance: bun-test

This project validates exclusively through `bun test`, `npx tsc --noEmit`, and `npx @biomejs/biome check extensions/`.

**Isolation:** Each flow validator runs `bun test` for specific test files only (using `bun test <file>` syntax). Tests use temporary directories and do not share state. Multiple validators can run concurrently without interference.

**Shared state to avoid:** None - all tests create isolated temp dirs and clean up after themselves.

**Verification approach:** For each assertion ID, find the corresponding test(s) in the test files, run them, and verify they pass. Tests are tagged with assertion IDs in their descriptions (e.g., `(VAL-LIBRARY-001)`). Some assertions are covered by tests that don't explicitly tag the ID but test the exact behavior described.

**How to determine pass/fail:** Run the relevant test file(s). If all tests pass (exit code 0, no failures), the assertions covered by those tests PASS. If any test fails, map the failure to the specific assertion(s) it covers.

**Evidence:** Capture the full bun test output showing pass/fail for each test case.
