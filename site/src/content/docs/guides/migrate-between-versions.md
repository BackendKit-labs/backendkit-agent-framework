---
title: Migrate between versions
description: What broke in each breaking release of agent-core and agent-coding, which part the codemod rewrites, and what you still check by hand.
---

Before 1.0, a minor bump is a breaking one: `^0.39.0` does not cover `0.40.0`. This page lists the breaking releases in order, so you can jump several at once. For each one: what changed, what the codemod does, and what stays with you.

```bash
npx @backendkit-labs/codemod --list                          # the transformations and the release each one serves
npx @backendkit-labs/codemod <name> ./src --dry-run          # show the change, write nothing
npx @backendkit-labs/codemod <name> ./src                    # apply it
```

The codemod only moves `import` and `export ... from` statements (and the `z.record(...)` calls of the zod 4 step). It is idempotent, so running it on a project that already migrated changes nothing. Anything it cannot rewrite safely gets a `// TODO(codemod): ...` comment: search for it after every run. It does not touch `package.json`, `require()` or dynamic `import()`.

:::tip[The order that works]
1. Raise the dependency ranges in `package.json` and install.
2. Run the codemods that apply (`--dry-run` first).
3. Run `tsc`, then **run your tests**. The compiler catches renamed imports; it does not catch [a change of behavior](#validation-throws-since-agent-core-034).
:::

## Package scope: `@bk/*` to `@backendkit-labs/*` (v0.15.0)

`@bk/agent-core`, `@bk/agent-coding` and `@bk/mcp-server` became `@backendkit-labs/agent-core`, `agent-coding` and `mcp-server`.

- **Codemod:** `scope-rename` rewrites the module specifiers.
- **By hand:** `npm uninstall @bk/...` and install the new names.

## Validation throws since agent-core 0.34

`defineTool` used to **return** the text `Error: Invalid arguments ...` when the arguments did not match the schema. Now `execute` **throws** a `ToolArgumentError` (code `INVALID_ARGUMENTS`).

Inside an agent nothing changes for the model: the engine catches it and shows the same text, and the audit log now records an error instead of a success. It matters only if your code calls `tool.execute(...)` itself, outside an engine, which is common in tests and in wrappers.

```ts
// before: a bad argument came back as a string
const out = await tool.execute(args, ctx);

// now: catch it where you call execute
import { ToolArgumentError } from '@backendkit-labs/agent-core';

try {
  const out = await tool.execute(args, ctx);
} catch (e) {
  if (e instanceof ToolArgumentError) { /* handle the rejected arguments */ }
  else throw e;
}
```

- **Codemod:** none. TypeScript does not flag it; a test that feeds bad arguments does.

## Zod 4 (agent-core 0.33)

Schemas passed to `defineTool` and `generateObject` must be zod 4. `agent-core` generates the JSON Schema with `z.toJSONSchema`.

| Zod 3 | Zod 4 | Codemod |
|---|---|---|
| `z.record(value)` | `z.record(z.string(), value)` | `zod4-record` rewrites it |
| `invalid_type_error`, `required_error` | one `error` option | flagged with `TODO(codemod)` |
| error messages | different text, e.g. `Invalid input: expected number` | none: check tests that compare messages |

`zod4-record` acts only in files that import `z` from `zod` or from `@backendkit-labs/agent-core`, so a `.record(...)` of anything else is left alone.

## The coding pipeline leaves agent-core (v0.40.0, agent-core 0.39)

`Orchestrator`, `QAService` and their types now live in `@backendkit-labs/agent-coding/pipeline`. The subpaths `agent-core/orchestration` and `agent-core/reflection` are gone.

- **Codemod:** `coding-split` moves the names and renames the subpaths. The audit hooks of `agent-core/reflection` go to the pipeline and the rest to the root.
- **Flagged, not moved:** `ProjectStoreData` and `SessionUpdates` no longer exist anywhere.
- **By hand:** the `store` and `blockedCommands` options of the engine are gone (approval now works from the facts each tool declares), and tools get shared objects through `services`.

## The terminal app leaves agent-core (v0.41.0, agent-core 0.40)

Agent discovery, the skill loader, the built-in commands, checkpoints, workspaces and trust (66 names) now live in `@backendkit-labs/agent-coding/cli`.

- **Codemod:** `terminal-app-split` moves all 66 names.
- **By hand:**
  - `createBaseEngine({ agentDiscovery })` became `agentSources: [fileAgentSource({ appName })]`; skills and instructions have `skillSources` and `instructionSources`. This changes a call, not an import, so it is not rewritten.
  - A **dynamic** import and a **method** that became a function are outside what the codemod reads. For example:

    ```ts
    // before
    const { SkillActivator } = await import('@backendkit-labs/agent-core');
    new SkillActivator().detectStack(cwd);

    // after
    const { detectStack } = await import('@backendkit-labs/agent-coding/cli');
    detectStack(cwd);
    ```

    Search your code for `import('@backendkit-labs/agent-core')` and `require('@backendkit-labs/agent-core')`.

## What the codemod did not touch

If `tsc` and the tests pass after the steps above, you are done. If not, the usual suspects are the three cases outside the codemod: a dynamic `import()` or `require()` of a name that moved, a changed call (an option that became a hook or a source), and a behavior change like the one in [validation throws](#validation-throws-since-agent-core-034).
