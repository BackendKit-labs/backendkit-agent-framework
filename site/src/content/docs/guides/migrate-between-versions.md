---
title: Migrate between versions
description: What broke in each breaking release of agent-core and agent-coding, and what to change in your code.
---

Before 1.0, a minor bump is a breaking one: `^0.39.0` does not cover `0.40.0`. This page lists the breaking releases in order, so you can jump several at once. For each one: what changed and what you change.

:::tip[The order that works]
1. Raise the dependency ranges in `package.json` and install.
2. Run `tsc`, then **run your tests**. The compiler catches renamed imports; it does not catch [a change of behavior](#validation-throws-since-agent-core-034).
:::

## An agent needs an identity and a person to act for (agent-core 0.49)

Every tool call is now attributed to a digital identity of the agent, and says on whose behalf it acts. With neither, the call is **denied**, with a reason that says how to fix it. There is no warning period.

```ts
import { createBaseEngine, selfAssertedIdentities } from '@backendkit-labs/agent-core';

createBaseEngine({
  /* ... */
  agentIdentity: selfAssertedIdentities(),         // who the agent is
  identity: { userId: 'carlos' },                  // on whose behalf it acts
});
```

- **No identity provider yet?** `selfAssertedIdentities()` (or `staticAgentIdentities({...})`) satisfies the requirement. The identity is marked `assurance: 'self-asserted'` in every audit event, so a reader can tell it from one a provider vouches for.
- **With a provider:** pass its `AgentIdentityProvider`. The framework knows no provider or credential format.
- **Tests:** `requireAgentIdentity: false` lets an agent act without identity (it warns once per agent; not for regulated environments), or spread `testIdentity()` from `@backendkit-labs/agent-testkit`.
- **A provider that throws or does not answer in 5 s** denies the call, also with the opt-out. Tune it with `agentIdentityTimeoutMs` and `agentIdentityCacheMs`.

## A failing MCP tool now throws (agent-core 0.48)

`MCPClientManager` used to ignore `isError` in the answer of an MCP server. When a server said a call had failed (bad arguments, denied, an error), the tool returned the error text **as a normal result**: the audit log and the learning counted it as a success, and a script could not tell. Now the tool's `execute` throws a `ToolError` with the code `MCP_TOOL_ERROR` and the text of the server.

```ts
import { MCP_TOOL_ERROR, ToolError } from '@backendkit-labs/agent-core';

// before: a failure came back as a string, like a success
const out = await tool.execute(args, ctx);

// now: catch it where you call execute directly
try {
  const out = await tool.execute(args, ctx);
} catch (e) {
  if (e instanceof ToolError && e.code === MCP_TOOL_ERROR) { /* the server said it failed */ }
  else throw e;
}
```

- **Inside an engine** the model still reads the server's text. What changes is the record: the call is a **failed** call with its code in the audit log, and the learning can learn from it. Tools from MCP servers that fail now show up as failures there, where before they looked fine.
- **Detection:** TypeScript does not flag it; a test that makes the server fail does.

## `FileRunJournal` is removed (agent-core 0.47)

The first file journal, one file per event, is gone. `NdjsonRunJournal` replaces it: one file per run, tamper-evident, faster to read and write, and it takes over a dead owner's claim at once.

```ts
// before
const journal = new FileRunJournal(dir);

// now
const journal = new NdjsonRunJournal(dir);
```

- **Old runs are not read.** The two journals use different formats, so a run a `FileRunJournal` left on disk half done is not resumed, and a finished one is not found. Finish or read your open runs before you upgrade.
- **The claim works differently.** `NdjsonRunJournal` frees a claim when the process that holds it is gone (it checks the pid) and ignores the TTL. Two containers that share a volume cannot see each other's pids: for that case use `RedisRunJournal` or `PostgresRunJournal`.
- **Detection:** TypeScript flags the missing export.

## Package scope: `@bk/*` to `@backendkit-labs/*` (v0.15.0)

`@bk/agent-core`, `@bk/agent-coding` and `@bk/mcp-server` became `@backendkit-labs/agent-core`, `agent-coding` and `mcp-server`.

- **Imports:** replace the old specifiers with the new ones (`@bk/agent-core` to `@backendkit-labs/agent-core`, and so on).
- **Install:** `npm uninstall @bk/...` and install the new names.

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

- **Detection:** TypeScript does not flag it; a test that feeds bad arguments does.

## Zod 4 (agent-core 0.33)

Schemas passed to `defineTool` and `generateObject` must be zod 4. `agent-core` generates the JSON Schema with `z.toJSONSchema`.

| Zod 3 | Zod 4 |
|---|---|
| `z.record(value)` | `z.record(z.string(), value)` |
| `invalid_type_error`, `required_error` | one `error` option |
| error messages | different text, e.g. `Invalid input: expected number`: check tests that compare messages |

## The coding pipeline leaves agent-core (v0.40.0, agent-core 0.39)

`Orchestrator`, `QAService` and their types now live in `@backendkit-labs/agent-coding/pipeline`. The subpaths `agent-core/orchestration` and `agent-core/reflection` are gone.

- **Imports:** move the names to `@backendkit-labs/agent-coding/pipeline` and rename the subpaths. The audit hooks of `agent-core/reflection` go to the pipeline and the rest to the root.
- **Flagged, not moved:** `ProjectStoreData` and `SessionUpdates` no longer exist anywhere.
- **By hand:** the `store` and `blockedCommands` options of the engine are gone (approval now works from the facts each tool declares), and tools get shared objects through `services`.

## The terminal app leaves agent-core (v0.41.0, agent-core 0.40)

Agent discovery, the skill loader, the built-in commands, checkpoints, workspaces and trust (66 names) now live in `@backendkit-labs/agent-coding/cli`.

- **Imports:** the 66 names move to `@backendkit-labs/agent-coding/cli`.
- **Calls:**
  - `createBaseEngine({ agentDiscovery })` became `agentSources: [fileAgentSource({ appName })]`; skills and instructions have `skillSources` and `instructionSources`. This changes a call, not an import.
  - A **dynamic** import and a **method** that became a function are easy to miss. For example:

    ```ts
    // before
    const { SkillActivator } = await import('@backendkit-labs/agent-core');
    new SkillActivator().detectStack(cwd);

    // after
    const { detectStack } = await import('@backendkit-labs/agent-coding/cli');
    detectStack(cwd);
    ```

    Search your code for `import('@backendkit-labs/agent-core')` and `require('@backendkit-labs/agent-core')`.

## If it still fails

If `tsc` and the tests pass after the steps above, you are done. If not, the usual suspects are a dynamic `import()` or `require()` of a name that moved, a changed call (an option that became a hook or a source), and a behavior change like the one in [validation throws](#validation-throws-since-agent-core-034).
