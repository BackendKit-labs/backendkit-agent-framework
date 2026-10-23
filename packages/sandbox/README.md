# @backendkit-labs/agent-sandbox

Confinement and permissions for what an agent runs. One policy decides, per call, how much of the host a command may touch; swappable backends enforce it; if the required confinement cannot be enforced on this host, the call **fails** instead of running unconfined.

> **Wired into the coding engine.** `createCodingEngine({ sandbox: { preset: 'ask' } })` (agent-coding) or `createBaseEngine({ sandbox })` (agent-core) put every `run_command` behind this service. Without `sandbox`, `run_command` keeps its old behaviour: the host, or the deprecated `BK_RUN_COMMAND_SANDBOX=docker`, now translated to the equivalent policy of this package.

```bash
npm i @backendkit-labs/agent-sandbox
```

## Modes

| Mode | Meaning |
|---|---|
| `read-only` | nothing can be written, anywhere |
| `workspace-write` | writes only inside the workspace |
| `danger-full-access` | no confinement |

Each call also has a network setting: `none` (default for the first two modes) or `allow`.

## Fail closed

```ts
import { createSandboxPolicy, createSandboxService, DockerBackend, NoneBackend } from '@backendkit-labs/agent-sandbox';

const sandbox = createSandboxService({
    policy: createSandboxPolicy({ preset: 'ask' }),          // workspace-write, network none
    backends: [new DockerBackend({ image: 'node:22' }), new NoneBackend()],
});

const out = await sandbox.run({ agentId: 'coder', sessionId: 's1' }, { tool: 'run_command', command: 'npm test', cwd: dir });
if (!out.ok) {
    out.code;   // 'SANDBOX_DENIED' | 'SANDBOX_UNAVAILABLE'
    out.reason; // why, and which backend was skipped for what reason
}
```

The service picks the first backend that can really **enforce** the mode:

- `docker` enforces `read-only` and `workspace-write` (never `danger-full-access`: a container is not full access). If the daemon does not answer you get `SANDBOX_UNAVAILABLE`, not a run on the host.
- `none` (the host) claims only `danger-full-access` with the network open. Checking that a directory is inside the workspace is not confinement, so it does not claim anything stricter.

## Presets

| Preset | Mode | Needs a human for |
|---|---|---|
| `read-only` | `read-only` | nothing (nothing writes) |
| `ask` (default) | `workspace-write` | file writes and commands |
| `auto-edit` | `workspace-write` | commands |
| `full` | `danger-full-access` | nothing |

`auto-edit` differs from the SPEC-0006 table: the command allowlist of `run_command` is still a hard block, so "auto-edit" means edits run and every command asks. `needsApproval(level, kind)` and `matchPreset(mode, approval)` are exported; a combination that matches no preset is reported as `custom`.

## The policy is data

`SandboxPolicyConfig` is plain JSON, so it can come from a file or a control request:

```ts
const policy = createSandboxPolicy({
    preset: 'ask',
    roots: ['/data/shared'],                       // extra working directories besides the workspace
    rules: [                                       // the first match wins
        { agentId: 'reviewer', mode: 'read-only' },
        { tool: 'run_command', network: 'allow' },
    ],
    env: { allow: ['GH_TOKEN'] },
    writeTools: ['write_file', 'edit_file'],       // refused outright while read-only
});

policy.snapshot();            // a copy of the configuration
policy.set(newConfig);        // validated; takes effect on the NEXT call, never mid-call; throws and keeps the old one if invalid
policy.version;               // increments on every successful set
parsePolicyConfig(untrusted); // validates a YAML/JSON object and names the path of the problem
```

## In an engine

```ts
const engine = createCodingEngine({
    providers, defaultProvider: 'deepseek', transport,
    sandbox: { preset: 'ask' },            // or { preset: 'read-only' | 'auto-edit' | 'full', policy: {...}, backends: ['docker', 'none'], docker: { image: 'node:22' }, auditLog: 'logs/sandbox.ndjson' }
    onToolApproval,                        // the preset says WHICH tools ask; this is who answers
});
(engine.sandbox as SandboxService).policy.set({ preset: 'read-only' });   // takes effect on the next call
```

- `run_command` goes through the service; an unmet confinement comes back as `Error: SANDBOX_UNAVAILABLE: …` and nothing runs.
- In `read-only` the engine refuses the write tools by name (`write_file`, `edit_file`), whatever the approval gate says. The memory tools keep working: they write the agent's own store, outside the workspace.
- The preset replaces the engine's built-in list of tools that ask. **If a tool needs approval and no `onToolApproval` is set, it is refused** (`SANDBOX_DENIED`): an unattended flow, trigger or fleet agent can never run what nobody approved.
- Every decision is a `sandbox` event on the transport and a line in the engine's audit log.
- File tools (`write_file`, `edit_file`) still enforce the workspace with their own path check; moving them behind the service is the next delivery.
- Containers run as your uid:gid on Linux and macOS (not root), so the files they create are yours.

## Observability

Every decision (allowed, denied, unavailable) is structured:

```ts
sandbox.onDecision(d => console.log(d.agentId, d.tool, d.mode, d.backend, d.outcome, d.reason));
createSandboxService({ policy, backends, auditLog: 'logs/sandbox.ndjson' });   // one JSON line per decision, in order
```

## A child is never wider than its parent

Whoever creates an agent (a supervisor, a parent agent spawning a sub-agent) must not hand it more power than it has itself. `isNarrowerOrEqual(parent, child)` is a pure check on two `SandboxPolicyConfig`s; `checkNarrower` returns every violation so the refusal can say why.

```ts
const verdict = checkNarrower(parentPolicy.snapshot(), requestedChildPolicy);
if (!verdict.ok) throw new Error(`POLICY_WIDER_THAN_PARENT: ${describeViolations(verdict.violations)}`);
```

Each policy is measured at its **widest** (its base setting or any rule), so a rule cannot hide a widening. The child may not exceed the parent's mode or network, must ask at least as much (`approval`), may only use roots inside the parent's, must keep every `writeTools`/`commandTools` entry and every `env.deny` the parent lists, and may only allow variables the parent allows. Note that a `read-only` child of an `ask` parent must still set `approval: 'writes-and-commands'`: it can still run commands.

## Environment hygiene

Host processes start from a scrubbed environment: names matching `KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD` or `CREDENTIAL` (case-insensitive) are dropped. It is a denylist on purpose (Windows needs `SystemRoot`, `ComSpec`, `PATHEXT`). Let specific ones through with `env.allow` (`GH_TOKEN`, or `DEEPSEEK_*`), drop more with `env.deny`. Containers never inherit the host environment.

## What it does not confine

- **Tools that start processes on their own.** Only calls that go through `ctx.sandbox.run(...)` are confined (`run_command` does). A custom or MCP tool that spawns a process itself is outside the sandbox: write it against `ctx.sandbox`.
- **`read-only` refuses tools by name.** It refuses exactly the tools listed in `writeTools` (the coding set lists `write_file` and `edit_file`). MCP tools and your own tools that write are not blocked unless you list them.
- **File tools run in the host process**, so they are not confined by a backend: the service judges the path instead (`authorizePath`). It follows symlinks and junctions, so a link inside the workspace cannot reach outside; the tool's own workspace check stays as the floor, even in full access. A tool that does its own I/O must call `ctx.sandbox.authorizePath(...)` itself.
- **Several engines may share one service**: each engine reports only the decisions of its own calls on its transport and audit log. `sandbox.onDecision(...)` on the service sees all of them.

## Controlling a policy from outside

`createEngineControl(engine, { policy: sandboxPolicyControl(service.policy, { ceiling }), jobs, approveWidening })` (from `agent-core`) is a handler an `AgentServer` can plug in as `control` (protocol 1.1), so a supervisor can read and change the policy, list and cancel jobs, and read an audit trail.

- **Narrowing is free, widening needs approval.** The comparison is `checkNarrower`. Without `approveWidening` a wider policy is refused (`APPROVAL_REQUIRED`): control never widens on its own say-so.
- **The ceiling is a hard limit.** A request beyond `ceiling` (the widest policy the operator accepts) is `POLICY_WIDER_THAN_PARENT` whatever the approver says.
- **A lock-down must keep its approval.** `{ preset: 'read-only' }` is *wider* than an `auto-edit` policy in the approval dimension (read-only asks for nothing), so a supervisor tightening an agent sends `{ preset: 'read-only', approval: 'commands' }` and keeps the parent's `writeTools`.
- **Audited.** Every change records who asked (`by`, else the tenant), the outcome and the policy `version` in force afterwards, next to the sandbox decisions of the engine. `expectedVersion` makes a change fail if the policy moved since the supervisor read it.

## Not here yet

`request_escalation` (S2), a terminal tool through the service (there is none in this repo yet), `bwrap`/`landlock`, Windows and `ssh` backends (S4), private temp directories and waiting for child exit after a kill.
