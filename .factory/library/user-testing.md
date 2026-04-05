# User Testing

Testing surface, required testing skills/tools, and resource cost classification.

**What belongs here:** How to test the extension, what tools to use, testing constraints.

---

## Testing Surface

This is a pi extension. There is no web UI, API server, or CLI to test end-to-end. Validation is through:

1. **Unit tests** (`bun test`) — Test all pure logic: state management, tool implementations, protocol generation, config resolution, git operations, report generation, UI rendering logic.
2. **Biome linting** (`npx @biomejs/biome check extensions/`) — Code style and quality.
3. **TypeScript typecheck** (`npx tsc --noEmit`) — Type safety.

## What Can Be Tested

- State machine transitions and persistence (pure functions)
- Tool parameter validation and response formatting (pure functions)
- Protocol generation per state (pure functions)
- Worker skill/prompt file generation (pure functions)
- Git operations (can mock child_process)
- Validation command execution logic (can mock exec)
- Config resolution chain (pure functions)
- Report generation (pure functions)
- UI widget/view rendering logic (pure functions that produce string arrays)
- Plan history mutations (filesystem operations)
- Lock acquisition/release logic (filesystem operations)

## What Cannot Be Tested (Pi Runtime Integration)

- `pi.registerTool()` / `pi.registerCommand()` / `pi.registerShortcut()` wiring
- `pi.on("before_agent_start")` event handler integration
- `ctx.ui.setWidget()` / `ctx.ui.custom()` actual rendering
- `pi.sendUserMessage()` delivery
- `pi.appendEntry()` / `ctx.sessionManager.getEntries()` actual session operations
- Worker process spawning with real pi binary

For untestable pi integrations, test the pure function logic that feeds into the pi API call.

## Resource Cost

- **Low cost**: All tests are fast unit tests with no I/O beyond temp filesystem
- **No network**: No external API calls
- **No services**: No databases, servers, or background processes needed
