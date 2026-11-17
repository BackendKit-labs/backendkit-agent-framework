---
title: Agents that run code
description: Confine what an agent can run - modes, presets, a docker backend, and a policy that fails closed.
---

An agent that runs commands can do whatever the account running it can. `@backendkit-labs/agent-sandbox` puts **one policy** in front of every command: how much of the host it may touch, and whether a person must agree first.

```bash
npm i @backendkit-labs/agent-sandbox
```

## Modes

| Mode | Meaning |
|---|---|
| `read-only` | Nothing can be written, anywhere |
| `workspace-write` | Writes only inside the workspace |
| `danger-full-access` | No confinement |

Each call also has a network setting: `none` (the default for the first two modes) or `allow`.

## Presets

| Preset | Mode | A person must agree to |
|---|---|---|
| `read-only` | `read-only` | nothing (nothing writes) |
| `ask` (default) | `workspace-write` | file writes and commands |
| `auto-edit` | `workspace-write` | commands |
| `full` | `danger-full-access` | nothing |

## It fails closed

The service picks the first backend that can really **enforce** the mode you asked for. If none can, the command does not run.

```ts
import { createSandboxPolicy, createSandboxService, DockerBackend, NoneBackend } from '@backendkit-labs/agent-sandbox';

const sandbox = createSandboxService({
  policy: createSandboxPolicy({ preset: 'ask' }),                       // workspace-write, network none
  backends: [new DockerBackend({ image: 'node:22' }), new NoneBackend()],
});

const out = await sandbox.run({ agentId: 'coder', sessionId: 's1' }, { tool: 'run_command', command: 'npm test', cwd: dir });
if (!out.ok) {
  out.code;     // 'SANDBOX_DENIED' | 'SANDBOX_UNAVAILABLE'
  out.reason;   // why, and which backend was skipped for what reason
}
```

- **docker** enforces `read-only` and `workspace-write`, never `danger-full-access` (a container is not full access). If the daemon does not answer you get `SANDBOX_UNAVAILABLE`, **not a run on the host**.
- **none** (the host) claims only `danger-full-access` with the network open. Checking that a directory is inside the workspace is not confinement, so it does not pretend to be more.

## In an engine

```ts
createBaseEngine({ /* ... */ sandbox });                        // every run_command goes through it
createCodingEngine({ /* ... */ sandbox: { preset: 'ask' } });   // the coding agents
```

## A child is never wider than its parent

An agent that creates another agent cannot hand it more power than it has. `checkNarrower(parent, child)` compares two policies at their *widest* (a rule cannot hide a widening): the child may not exceed the parent's mode or network, and must ask at least as much.

## What it does not confine

Say this out loud before relying on it:

- Tools that start processes **on their own**. Only calls through `ctx.sandbox.run(...)` are confined (`run_command` is). A custom or MCP tool that spawns a process itself is outside.
- `read-only` refuses tools **by name**: the ones listed as writing tools. Your own tools that write are not blocked unless you list them.
- File tools run in the host process, so a backend does not confine them; the service judges the path instead, following symlinks and junctions.

Host processes also start from a scrubbed environment: variables named like `KEY`, `SECRET`, `TOKEN`, `PASSWORD` or `CREDENTIAL` are dropped.

Reference: the [`agent-sandbox` page](../../packages/sandbox/).
