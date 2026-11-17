# BackendKit Agent Framework

TypeScript SDK for building agents: a model- and transport-agnostic engine with typed tools, delegation, governance (policy, approval, audit), MCP in both directions, and the pieces you need to run agents as infrastructure.

```bash
npx create-bk-agent my-project
```

The scaffolder asks for a template and an LLM provider, and generates a ready-to-run project.

## What you can build

| Kind of agent | Core building blocks |
|---|---|
| Assistant / conversational | `defineTool`, `createBaseEngine`, memory, context layers, guardrails, streaming transports |
| Business agent that acts on real systems | Tools that declare their facts (`readOnly`, `destructive`), direct tools without a model, per-call `policy`, `approver`, durable `approvals`, `audit` |
| Autonomous / background | `createAutonomousAgent` (cron, webhook, event triggers), jobs, budget limits, external control |
| Multi-agent | `ask_agent` delegation with depth limits and a delegation chain, workflows, lifecycle hooks |
| Agent served as infrastructure | MCP server for your tools (`createToolServer`, `AgentMCPServer`), MCP client, `agent-protocol`, `agent-web`, OpenTelemetry export |
| Agent that runs code or commands | `agent-sandbox` (modes, presets, a docker backend), path and command confinement |

Every kind gets swappable providers, resilient LLM calls, and test doubles (`agent-testkit`).

### Governed agents in a few lines

```ts
import { createBaseEngine, defineTool, z, HashChainAuditSink, FileApprovalStore } from '@backendkit-labs/agent-core';

const pay = defineTool({
  name: 'pay_invoice', description: 'Pay an approved invoice', destructive: true,
  input: z.object({ invoiceId: z.string(), amount: z.number() }),
  execute: async (args) => JSON.stringify(await treasury.pay(args)),
});

const engine = createBaseEngine({
  providers, defaultProvider: 'anthropic', agents: [treasuryAgent], tools: [pay],
  identity: { tenantId: 'acme', userId: 'u-42' },
  approvals: new FileApprovalStore('./approvals'),     // destructive calls wait for a person
  audit: new HashChainAuditSink('./audit.log'),        // one tamper-evident event per call
});
```

Policies, approvers (a person, another agent, a service), hooks and the MCP tool server are described in the [agent-core README](packages/core/README.md).

## Packages

| Package | What it is |
|---|---|
| [`@backendkit-labs/agent-core`](packages/core) | The engine: typed tools, agents and delegation, workflows and durable declarative flows (YAML, journal, approvals, planner), triggers, memory, guardrails, governance (policy, approval, audit, hooks), MCP client and tool server |
| [`@backendkit-labs/agent-providers`](packages/providers) | LLM providers: OpenAI-compatible (OpenAI, DeepSeek, Ollama) and Anthropic, one retry and streaming implementation |
| [`@backendkit-labs/agent-coding`](packages/coding) | Coding agents: profiles, file and command tools, a terminal transport |
| [`@backendkit-labs/agent-enterprise`](packages/enterprise) | Business agents: department profiles, Obsidian RAG with per-folder isolation, YAML flows with compliance gates |
| [`@backendkit-labs/agent-flow-queue`](packages/flow-queue) | Flows across processes: a BullMQ `StepExecutor` (each step on a worker) and a Redis `RunJournal` |
| [`@backendkit-labs/agent-sandbox`](packages/sandbox) | Confinement of what agents run: modes, presets, one policy point, a docker backend (or none) |
| [`@backendkit-labs/agent-protocol`](packages/agent-protocol) | Agent HTTP protocol: server, client and resilience for agents that call each other over the network |
| [`@backendkit-labs/agent-web`](packages/web) | HTTP/WebSocket server for browser-ready streaming sessions, auth, metrics and triggers |
| [`@backendkit-labs/agent-web-ui`](packages/web-ui) | React chat and kanban monitor for `agent-web` |
| [`@backendkit-labs/mcp-server`](packages/mcp-server) | `bk-mcp` (skills and code intelligence over MCP) and `AgentMCPServer` (serve your agent's prompt and direct tools) |
| [`@backendkit-labs/mcp-connectors`](packages/mcp-connectors) | Ready MCP servers: HubSpot, Jira, Google Calendar, Odoo, AI Vault |
| [`@backendkit-labs/agent-otel`](packages/otel) | OpenTelemetry export of engine traces (OTLP/HTTP, GenAI conventions) |
| [`@backendkit-labs/agent-testkit`](packages/testkit) | Scripted providers, a mock LLM server with injectable failures, a mock transport, assertions |
| [`@backendkit-labs/document-extract`](packages/document-extract) | Text from PDF, Word, Excel and CSV (OCR optional), with limits and stable errors |
| [`@backendkit-labs/aval-tools`](packages/aval-tools) | Payment tools for agents that spend through an AVAL instance |
| [`create-bk-agent`](packages/create-bk-agent) | Project scaffolder (templates in [`packages/templates`](packages/templates)) |

Versions and changes per release: [CHANGELOG](CHANGELOG.md).

## How the repository is organised

- **`packages/`** — the SDK, published to npm.
- **`examples/`** — reference projects, outside the workspace build, all on the current framework: `flows` (a YAML flow with journal, approval and resume, no model), `git-agent` (a terminal agent: a team with delegation and a read-only mode), `git-analyst` (an agent served over MCP) and `vault-pilot` (department agents over a knowledge vault, each limited to its own folders). More are added as they are brought up to date and documented. The larger deep dives live in `agent-framework-examples`.
- **`docs/adr/`** — architecture decisions: the *why*.
- **`docs/specs/`** — specifications of changes that span packages: the *what* and *how*, with their state. The current roadmap is [SPEC-0013](docs/specs/SPEC-0013-framework-como-libreria-hoja-de-ruta.md).

The direction is set in [ADR-0008](docs/adr/0008-core-define-contratos-verticales-y-apps-fuera.md) (proposed): `agent-core` keeps generic contracts, and verticals such as coding and the terminal app move to their own packages. That move is planned in SPEC-0015 and SPEC-0016. Today the coding pipeline still lives inside `agent-core`, as optional engine options.

Infrastructure and products live in other repositories: the control plane, Hermes, the curator agents and the infra agents are in `bk-platform`; reference domain agents (finance, aiops, bk-coder) are in `bk-agents`.

## Templates

`npx create-bk-agent` combines an architecture from [`packages/templates/base`](packages/templates/base) with a deploy mode from [`packages/templates/deploy`](packages/templates/deploy):

| Architecture | What it gives you | You provide |
|---|---|---|
| `coding` | 10 agents and all coding tools | An LLM key and an `AGENT.md` |
| `multi-agent` | Orchestrator and specialists | Agents and tools for your domain |
| `single` | One agent with tools (with the `mcp-http` deploy mode it is an MCP server) | Tools to expose |
| `autonomous` | Cron, webhook and event triggers | What to do on each trigger |
| `enterprise` | Local LLM and an Obsidian knowledge base | Your vault |
| `minimal` | The bare engine | Everything |

## Serving and consuming MCP

```json
{
  "mcpServers": {
    "bk-agent": {
      "command": "npx",
      "args": ["-y", "@backendkit-labs/mcp-server"],
      "env": { "BK_CWD": "/your/project" }
    }
  }
}
```

To expose your own tools over MCP without a model in between, use `createToolServer` / `runToolServer` from `agent-core`; to expose an agent (prompt tools) and direct tools together, `AgentMCPServer` from `mcp-server`.

## License

MIT (c) BackendKit Labs
