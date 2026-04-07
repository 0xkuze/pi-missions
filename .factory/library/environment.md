# Environment

Runtime: Bun for dev tooling, Node.js for extension runtime.
No external services. No env vars required.

## Dependencies

Peer deps (provided by pi at runtime): @mariozechner/pi-coding-agent, @mariozechner/pi-tui, @sinclair/typebox
Dev deps: @biomejs/biome, @types/node, bun-types, typescript

## Constraints

- Extension code must use Node.js built-ins only (no Bun APIs)
- TypeBox for all runtime schema validation
- No new npm dependencies allowed
