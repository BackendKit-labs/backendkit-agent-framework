# @backendkit-labs/hermes

Control plane for a fleet of agents. One place that knows which agents exist, whether they are up, who may use them, and what became of every run — and that gives a model the tools to supervise them.

It is domain-agnostic: it knows nothing about accounting, support or devops. What a fleet is *for* lives in its `fleet.yaml` and in the agents it points at.

**What is here.** It runs, watches and controls agents (how each one executes: its sandbox policy and background jobs; one audit trail across the fleet), and it can create and retire agents from blueprints the operator wrote and notice what the fleet cannot do. Flows, plugins and budgets come next (see `docs/specs/SPEC-0008`).

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

## Flows of other agents

A flow is a sequence of steps that the agent hosting it runs. Hermes does not run the logic: it starts the flow, watches which step it is on, and pauses, resumes or cancels it, under the same roles and approval as any run.

Tools: `flow_list`, `flow_run`, `flow_status`, `flow_pause`, `flow_resume`, `flow_cancel`. A flow run is a run like any other (capability `flow:<name>`, so `access.capabilities['flow:close-month']` can set its own roles and approval), and it appears in `agent_status` / `agent_result` / `agent_cancel` too.

The agent side is cooperative: a flow pauses and stops at its next step boundary, never in the middle of a step.

```ts
const flows = {
  'close-month': {
    steps: ['collect', 'reconcile', 'report'],
    run: async (input, ctl) => {
      await ctl.step('collect');     // waits here while paused; throws if cancelled
      /* ... */
      await ctl.step('reconcile');
      /* ... */
      return 'done';
    },
  },
};

// in the same process as Hermes
new InProcessConnector({ name: 'books', capabilities: {}, flows });

// or in a service of its own, over agent-protocol
const { handler } = serveFlows(flows);
new AgentServer({ /* ... */, apiKey, controlApiKey, flowHandler: handler });
```

Over agent-protocol, starting and watching use the run key; pausing, resuming and cancelling need the agent's `controlApiKey`. After a Hermes restart a flow run is picked up again where the agent still has it, or is `lost` if the agent does not know it (a flow of an in-process agent does not outlive Hermes). Cancelling a flow that never reaches a step boundary is reported cancelled after a grace period (2 s) and its result is ignored.

## Creating agents

The operator lists **blueprints** in `fleet.yaml` and says what Hermes itself may hand out. Hermes can then create an agent from a blueprint, never from anything else.

```yaml
policies:
  provisioning:
    creator:                      # the most Hermes may give to anything it creates
      sandbox: { preset: ask, writeTools: [write_file, edit_file] }
      tools: [read_file, search_files]
      budgetUsdPerDay: 5
    maxLive: 3
    operatorRoles: [operator]     # who may approve a drafted blueprint
    gap: { mode: notify }         # notify (default) | create | propose
blueprints:
  - id: report-writer
    template: single              # the host's provisioner decides what this means
    tools: [read_file, search_files]
    sandbox: { preset: read-only, approval: writes-and-commands, writeTools: [write_file, edit_file] }
    limits: { budgetUsdPerDay: 1, ttlMinutes: 120 }
    approval: ask                 # each creation needs a human (the default)
    covers: [write reports, summaries]
    createRoles: [ops]            # who may create and retire; without it, nobody
    access: { roles: [ops], controlRoles: [sre], approval: never }
```

```ts
const { hermes, tools, guardrails } = createHermes({
  fleet: readFileSync('fleet.yaml', 'utf8'),
  provision: (blueprint, { instanceId, sandbox }) => buildTheAgent(blueprint, instanceId, sandbox),  // the host knows how
  approver: askAHuman,
  provisioningFile: 'hermes-provisioning.json',
  onEvent: e => notifyOperators(e),   // fleet.gap, fleet.agent.created / retired, fleet.blueprint.*
});
```

- **A blueprint is never wider than what Hermes may hand out.** Sandbox (`checkNarrower`), tools and budget are checked when the file is read (`bk-hermes validate` names the field) and again at the moment of creation. A bare `sandbox: { preset: read-only }` is refused for an `ask` creator, because read-only asks for nothing and counts as wider in `approval`: write the whole policy, as above.
- **`agent_create` takes a blueprint id (and a label), nothing else.** The model cannot pass a sandbox, tools, limits or roles. Hermes picks the instance id (`<blueprint>-<n>`, never one of the operator's).
- **Fails closed.** No `createRoles`: nobody can create. No approver: nothing is built. No provisioner: `CONTROL_UNSUPPORTED`. A built agent that reports a policy wider than the creator's is closed and never registered.
- **Limits.** `maxLive` created agents at once; each can expire (`ttlMinutes`). Retiring cancels its runs, takes it out of the fleet and closes it. Created agents do not outlive Hermes: on restart they are retired and their open runs are `lost`. A created agent cannot create others.
- **Gaps.** `fleet_find` looks for a capability by words; `fleet_gap` reports a need nobody covers. Hermes emits `fleet.gap` and, by the company's choice, only that (`notify`), creates from a blueprint that `covers` it with that blueprint's own roles and approval (`create`), or invites a draft (`propose`).
- **Drafts are proposals, not authorizations.** `blueprint_propose` stores a pending draft, checked against the same bounds. It cannot create anything until an operator approves it with `hermes.blueprintDecide(operatorPrincipal, id, 'approved')` (checked again then). That call is for the host and is deliberately **not a tool**: a model that could approve its own drafts would grant itself permissions. Approved drafts live in the provisioning file; `fleet.yaml` is never rewritten.

## Connectors

- `ProtocolConnector`: an agent served by `AgentServer` (agent-protocol).
- `InProcessConnector`: an agent inside the same process (an engine behind a handler, a function, a test double). Declare it in the file as `connector: { kind: in-process }` and register it by id with `inProcess: { ledger: connector }`.

## Not here yet

`McpConnector`; concurrency and budget limits (`limits` is accepted, not enforced — only `deadlineMs`, as how long a call waits; a daily budget needs the agents to report what a run cost, which agent-protocol does not carry yet); a `traceparent` shared with the agent (needs a change in agent-core/otel); OpenTelemetry; the chat interface. Cancelling a run that an `AgentServer` hosts marks the task cancelled, but the handler on that server may keep running: the server does not abort it yet.
