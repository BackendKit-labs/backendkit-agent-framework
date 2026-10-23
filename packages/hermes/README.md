# @backendkit-labs/hermes

Control plane for a fleet of agents. One place that knows which agents exist, whether they are up, who may use them, and what became of every run — and that gives a model the tools to supervise them.

It is domain-agnostic: it knows nothing about accounting, support or devops. What a fleet is *for* lives in its `fleet.yaml` and in the agents it points at.

**What is here (H0 and H1 control).** It runs, watches and controls agents: how each one executes (its sandbox policy, its background jobs) and one audit trail across the fleet. Creating agents, flows, plugins and budgets come next (see `docs/specs/SPEC-0008`).

## The fleet

```yaml
fleet: production
agents:
  - id: ledger
    connector: { kind: protocol, url: http://localhost:3300, apiKey: { env: LEDGER_KEY }, controlApiKey: { env: LEDGER_CONTROL_KEY } }
    tags: [finance]
    health: { intervalSec: 30, timeoutMs: 3000 }
    access: { roles: [ops], controlRoles: [sre], approval: never, capabilities: { post_entry: { roles: [finance], approval: always } } }
policies:
  approval: { default: ask }
```

`bk-hermes validate fleet.yaml` checks the file and names the path of every error. Keys are references (`{ env: NAME }`), never written in the file, and are read when used, so a rotated key applies without a restart. Unknown keys are errors, so a typo does not silently drop a setting.

## Use

```ts
import { Hermes, createFleetTools, defaultResultGuardrails, parseFleet } from '@backendkit-labs/hermes';

const hermes = new Hermes({
  fleet: parseFleet(readFileSync('fleet.yaml', 'utf8')),
  storeFile: 'runs.json',        // runs survive a restart
  auditLog: 'hermes-audit.ndjson',
  approver: async req => askAHuman(req),   // without one, anything that needs approval is refused
});
await hermes.start();            // checks the fleet, then settles runs a previous process left open

const engine = createBaseEngine({
  /* ... */
  tools: createFleetTools(hermes, { principal: () => currentUser() }),
  guardrails: defaultResultGuardrails(),
});
```

Tools: `fleet_list`, `fleet_info`, `agent_run`, `agent_status`, `agent_result`, `agent_cancel`, `fleet_health`, and for control `policy_get`, `policy_set`, `job_list`, `job_cancel`, `fleet_audit`. Failures come back as `Error: CODE: message` text.

## Rules

- **Roles.** A principal sees and uses only the agents whose `access.roles` it holds (no `roles` = any identified principal; no principal = `FORBIDDEN`). A capability can require its own roles on top.
- **Approval.** `never` runs; `ask` and `always` need the `approver`; with none, the action is refused (`APPROVAL_REQUIRED`). An agent with no setting uses `policies.approval.default`, which is `ask` when the file says nothing: fail closed. (`ask` and `always` behave the same for now.)
- **What an agent answers is data.** Results go through the secret-leak and prompt-injection guardrails before they are stored or shown to the model, and reach it fenced as data. Pass `defaultResultGuardrails()` to the Hermes engine as well, so the engine's own tool-result phase applies them to everything else.
- **Runs.** Each run is recorded with its input masked and cut (never raw) and written to the store as soon as it ends. After a restart, Hermes asks each agent about the runs it left open (`GET /tasks/:id`, protocol 1.0): a run the agent knows is picked up again, one it does not is `lost`. An in-process agent cannot outlive Hermes, so its runs are `lost`. An agent that cannot be reached leaves its runs as they were, and they are tried again when it is back up.
- **Health.** Checked on a timer with a plain request (no retries, no circuit breaker), so an agent that goes down shows as down at the next check. Hermes refuses to start runs on a `down` agent.
- **Audit.** One NDJSON line per decision: who, which agent and capability, run id, outcome.

## Controlling how an agent executes

An agent served with `AgentServer` exposes a control channel (protocol 1.1) when it is given a `controlApiKey` and a `control` handler (`createEngineControl` from `agent-core` is one). Hermes reaches it with `controlApiKey: { env }` in the fleet file: a key of its own, never the one that runs capabilities.

- **Reading** (`policy_get`, `job_list`, `fleet_audit`) needs the right to use the agent.
- **Changing** (`policy_set`, `job_cancel`) needs one of the agent's `controlRoles`; an agent with none cannot be changed through Hermes. It also goes through the approval of `access.approval`, like a run.
- **The agent has the last word.** Narrowing a policy is free; widening one is refused by the agent (`APPROVAL_REQUIRED`) unless its own approver allows it, and nothing goes past the ceiling its operator set (`POLICY_WIDER_THAN_PARENT`). Pass `expected_version` (what `policy_get` showed) so a change fails if the policy moved in between.
- **A lock-down keeps its approval.** To tighten an `auto-edit` agent send `{ preset: 'read-only', approval: 'commands', writeTools: [...] }`: dropping `approval` or the `writeTools` counts as widening.
- **One trail.** `fleet_audit` merges Hermes's own decisions with each agent's (sandbox and control decisions, with who asked and the policy version after a change) in time order. Agents with no control channel, or that cannot be reached, are listed under `unavailable` instead of failing the view.

## Connectors

- `ProtocolConnector`: an agent served by `AgentServer` (agent-protocol).
- `InProcessConnector`: an agent inside the same process (an engine behind a handler, a function, a test double). Declare it in the file as `connector: { kind: in-process }` and register it by id with `inProcess: { ledger: connector }`.

## Not here yet

`McpConnector`; creating and retiring agents; flows; concurrency and budget limits (`limits` is accepted, not enforced — only `deadlineMs`, as how long a call waits; a daily budget needs the agents to report what a run cost, which agent-protocol does not carry yet); a `traceparent` shared with the agent (needs a change in agent-core/otel); OpenTelemetry; the chat interface. Cancelling a run that an `AgentServer` hosts marks the task cancelled, but the handler on that server may keep running: the server does not abort it yet.
