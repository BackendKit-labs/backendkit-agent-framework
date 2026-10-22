# @backendkit-labs/agent-sandbox

Confinement and permissions for what an agent runs. One policy decides, per call, how much of the host a command may touch; swappable backends enforce it; if the required confinement cannot be enforced on this host, the call **fails** instead of running unconfined.

> **Status: first delivery (S1).** The library is complete and tested, but `run_command` and the engine do not use it yet; that wiring is the next PR. Until then `BK_RUN_COMMAND_SANDBOX=docker` keeps working as before.

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

## Observability

Every decision (allowed, denied, unavailable) is structured:

```ts
sandbox.onDecision(d => console.log(d.agentId, d.tool, d.mode, d.backend, d.outcome, d.reason));
createSandboxService({ policy, backends, auditLog: 'logs/sandbox.ndjson' });   // one JSON line per decision, in order
```

## Environment hygiene

Host processes start from a scrubbed environment: names matching `KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD` or `CREDENTIAL` (case-insensitive) are dropped. It is a denylist on purpose (Windows needs `SystemRoot`, `ComSpec`, `PATHEXT`). Let specific ones through with `env.allow` (`GH_TOKEN`, or `DEEPSEEK_*`), drop more with `env.deny`. Containers never inherit the host environment.

## Not here yet

`request_escalation` (S2), file tools and terminal through the service (S3), `bwrap`/`landlock`, Windows and `ssh` backends (S4), private temp directories and waiting for child exit after a kill.
