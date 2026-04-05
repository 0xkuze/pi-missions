# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Runtime

- **Bun** 1.2.23 for dev tooling (install, test, scripts)
- **Node.js** built-ins only in extension source code (no Bun-specific APIs)
- **macOS** development environment, 24GB RAM, 10 cores

## Peer Dependencies

These are provided by pi at runtime and should be `peerDependencies` in package.json:

- `@mariozechner/pi-coding-agent` u2014 ExtensionAPI, event types, tool types
- `@mariozechner/pi-tui` u2014 TUI components for Mission Control overlay
- `@sinclair/typebox` u2014 JSON Schema builder for tool parameters and runtime validation

## Pi-Mono Reference

The pi-mono source is available at `/Users/cristian/tmp/pi-mono` for type reference:
- Extension API types: `packages/coding-agent/src/extension-api.ts`
- TUI components: `packages/tui/src/components/`
- Example extensions: `packages/coding-agent/src/extensions/`

## File Locking

Using `fs.open` with exclusive flag (`wx`) as a zero-dependency alternative to `proper-lockfile`. The spec mentions `proper-lockfile` but the user chose the zero-dep approach.
