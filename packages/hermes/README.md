# @backendkit-labs/hermes

Control plane for a fleet of agents. One place that knows which agents exist, whether they are up, who may use them, and what became of every run — and that gives a model the tools to supervise them.

It is domain-agnostic: it knows nothing about accounting, support or devops. What a fleet is *for* lives in its `fleet.yaml` and in the agents it points at.

**This is the first slice (H0).** It runs and watches agents. Creating agents, flows, plugins, policy control and budgets come next (see `docs/specs/SPEC-0008`).

## The fleet

```yaml
fleet: production
agents:
  - id: ledger
    connector: { kind: protocol, url: http://localhost:3300, apiKey: { env: LEDGER_KEY } }
    tags: [finance]
    health: { intervalSec: 30, timeoutMs: 3000 }
    access: { roles: [ops], approval: never, capabilities: { post_entry: { roles: [finance], approval: always } } }
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

Tools: `fleet_list`, `fleet_info`, `agent_run`, `agent_status`, `agent_result`, `agent_cancel`, `fleet_health`. Failures come back as `Error: CODE: message` text.

## Rules

- **Roles.** A principal sees and uses only the agents whose `access.roles` it holds (no `roles` = any identified principal; no principal = `FORBIDDEN`). A capability can require its own roles on top.
- **Approval.** `never` runs; `ask` and `always` need the `approver`; with none, the action is refused (`APPROVAL_REQUIRED`). An agent with no setting uses `policies.approval.default`, which is `ask` when the file says nothing: fail closed. (`ask` and `always` behave the same for now.)
- **What an agent answers is data.** Results go through the secret-leak and prompt-injection guardrails before they are stored or shown to the model, and reach it fenced as data. Pass `defaultResultGuardrails()` to the Hermes engine as well, so the engine's own tool-result phase applies them to everything else.
- **Runs.** Each run is recorded with its input masked and cut (never raw) and written to the store as soon as it ends. After a restart, Hermes asks each agent about the runs it left open (`GET /tasks/:id`, protocol 1.0): a run the agent knows is picked up again, one it does not is `lost`. An in-process agent cannot outlive Hermes, so its runs are `lost`. An agent that cannot be reached leaves its runs as they were, and they are tried again when it is back up.
- **Health.** Checked on a timer with a plain request (no retries, no circuit breaker), so an agent that goes down shows as down at the next check. Hermes refuses to start runs on a `down` agent.
- **Audit.** One NDJSON line per decision: who, which agent and capability, run id, outcome.

## Connectors

- `ProtocolConnector`: an agent served by `AgentServer` (agent-protocol).
- `InProcessConnector`: an agent inside the same process (an engine behind a handler, a function, a test double). Declare it in the file as `connector: { kind: in-process }` and register it by id with `inProcess: { ledger: connector }`.

## Not here yet

`McpConnector`; creating and retiring agents; flows; reading and setting an agent's sandbox policy; concurrency and budget limits (`limits` is accepted, not enforced — only `deadlineMs`, as how long a call waits); OpenTelemetry; the chat interface. Cancelling a run that an `AgentServer` hosts marks the task cancelled, but the handler on that server may keep running: the server does not abort it yet.
