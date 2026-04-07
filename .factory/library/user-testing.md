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
