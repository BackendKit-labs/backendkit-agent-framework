# BackendKit Platform

TypeScript SDK for building agents: a model- and transport-agnostic multi-agent engine for coding assistants, autonomous agents, domain specialists, and MCP servers.

- **`packages/`** — the SDK (publishable to npm), including the `create-bk-agent` scaffolder.

The control plane (director-api, cloud-platform, abac, ops agents, hermes, curator agents, infra) and the reference/domain agents (finance, aiops, bk-coder, ...) were moved out to the `bk-platform` and `bk-agents` repos (full history preserved).

Examples live in `examples/` (reference only, outside the workspace build).

## Quickstart

```bash
npx create-bk-agent my-project
```

Prompts for a template and LLM provider, then scaffolds a ready-to-run project.

## Packages

| Package | Status | Description |
|---------|--------|-------------|
| [`@backendkit-labs/agent-core`](packages/core) | **core** | Generic engine — model-agnostic, transport-agnostic |
| [`@backendkit-labs/agent-enterprise`](packages/enterprise) | **core** | RAG + VaultWriter for enterprise deployments |
| [`@backendkit-labs/agent-coding`](packages/coding) | **stable** | Coding agents, file tools, git integration, LLM providers |
| [`@backendkit-labs/agent-web`](packages/web) | **stable** | HTTP/WebSocket server layer for browser-ready agent sessions |
| [`@backendkit-labs/agent-web-ui`](packages/web-ui) | **stable** | React components for chat and monitoring UIs |
| [`@backendkit-labs/mcp-server`](packages/mcp-server) | **stable** | MCP server — skills and code intelligence |
| [`@backendkit-labs/mcp-connectors`](packages/mcp-connectors) | **stable** | HubSpot CRM, Jira, Google Calendar MCP servers |
| [`create-bk-agent`](packages/create-bk-agent) | **stable** | CLI scaffolder |

## Subsystem status

Three tiers define how each subsystem is treated during the pilot phase:

| Status | Meaning |
|--------|---------|
| **core** | Required for the enterprise story — reviewed before any change |
| **stable** | Works and is maintained; will not be expanded in the pilot phase |
| **experimental** | Frozen — documented as such, may change or be removed based on pilot usage |

**Rule during pilot:** no new features are added to `experimental` subsystems. Every new
capability must be justified against a concrete pilot use case. What the pilot uses gets
consolidated; what it does not touch in a month of real use is a candidate for extraction
or removal.

### `@backendkit-labs/agent-core` subsystem matrix

| Subsystem | Status | Notes |
|-----------|--------|-------|
| `engine` | **core** | AgentEngine, MCPRegistrar, ApprovalGate, AuditLogger, HistoryManager |
| `orchestration` | **core** | FSM, intent detection, task context, audit reporter, policy engine |
| `delegation` | **core** | DelegationBus — parallel sub-agent execution |
| `tools` | **core** | ToolDefinition, ToolRegistry |
| `transport` | **core** | CallbackTransport, StdioTransport |
| `mcp` | **core** | MCP client (MCPClientManager) |
| `bootstrap` | **core** | Initialization helpers |
| `shared` / `types` | **core** | Shared utilities and type definitions |
| `workflow` | **stable** | WorkflowBuilder, WorkflowRunner |
| `skills` | **stable** | SkillManager — YAML skill packs, install/update |
| `commands` | **stable** | Slash commands (`/help`, `/agents`, `/workspace`, `/plugin`, …) |
| `context` | **stable** | Context window management |
| `checkpoint` | **stable** | Session checkpoints — save and restore conversation state |
| `workspace` | **stable** | Multi-project workspaces |
| `agent-discovery` | **stable** | Agent registry and runtime discovery |
| `qa` | **experimental** | QA gates — frozen during pilot; do not add features |
| `reflection` | **experimental** | Reflection engine + lessons memo — frozen during pilot |
| `agent-memory` | **experimental** | Episodic/semantic/procedural memory — frozen during pilot |
| `observability` | **experimental** | Tracing and metrics — frozen during pilot |
| `triggers` | **experimental** | Autonomous triggers (cron / webhook / event) — frozen during pilot |

### `@backendkit-labs/agent-web` subsystem matrix

| Subsystem | Status | Notes |
|-----------|--------|-------|
| `AgentServer` | **stable** | Fastify server, session management, HTTP + WS routing |
| `SessionManager` | **stable** | Session lifecycle, idle sweep, fan-out |
| `MonitorBus` | **stable** | Real-time session monitoring over WebSocket |
| `JwtAuth` | **stable** | Bearer / query-param JWT authentication hook |
| `MetricsCollector` | **stable** | Prometheus metrics endpoint |
| `SessionMetaStore` | **stable** | In-memory and Redis session persistence |
| `TriggerBus` | **experimental** | Cron / webhook / BullMQ autonomous triggers — frozen during pilot |

## Agent types

```ts
// Coding assistant
import { createCodingEngine } from '@backendkit-labs/agent-coding';

// Multi-agent: orchestrator + specialists
import { AgentEngine, AgentRegistry, ToolRegistry } from '@backendkit-labs/agent-core';

// Autonomous: cron, webhooks, events
import { createAutonomousAgent } from '@backendkit-labs/agent-core';

// Bare engine — full control
import { createBaseEngine } from '@backendkit-labs/agent-core';
```

## Templates

`npx create-bk-agent` generates a project from one of seven architectures in
[`packages/templates/base/`](packages/templates/base), combined with a deploy mode
(`packages/templates/deploy/`).

### coding — complete, ready to run

10 specialized agents + all file/git/command tools already wired. Run it, describe
your project in `AGENT.md`, and it works. Extend the UI or add extra tools on top.
Choose this when you want a coding assistant, not when you want to build one from scratch.

### multi-agent — blank multi-agent architecture

Orchestrator + specialist pattern with no pre-built agents or tools.
You define the agents, the tools, and the domain. The framework handles
orchestration, delegation, and parallel execution. Use this to build any type
of agent: infra, data, customer support, finance — anything that is not about editing code.

| Architecture | What it gives you | You provide |
|--------------|------------------|-------------|
| `coding` | 10 agents + all coding tools | LLM key + `AGENT.md` description |
| `multi-agent` | Orchestration skeleton | Agents + tools for your domain |
| `single` | One agent with tools (pair it with the `mcp-http` deploy mode to serve it as an MCP server) | Tools to expose |
| `autonomous` | Trigger system (cron/webhook/event) | Agent logic + what to do on trigger |
| `enterprise` | Local LLM + Obsidian knowledge base (RAG) | Your vault |
| `orchestrator` | Multi-step workflows with approval gates | Your flows and specialists |
| `minimal` | Bare engine | Everything |

## Multi-project workspaces

Group related projects into a workspace so the agent operates across all of them from a shared root — ideal for microservice architectures.

```
/workspace create my-system
/workspace add my-system ~/dev/my-system/auth-service
/workspace add my-system ~/dev/my-system/api-gateway
/workspace add my-system ~/dev/my-system/user-service
# → common root auto-detected: ~/dev/my-system/
# → /workspace switch sets that root as workingDir
```

The agent can now navigate all services with relative paths like `auth-service/src/index.ts`. Use `/workspace set-root <ws> [path]` to override the auto-detected root.

## Persistent memory + file access

Agents scaffolded with `create-bk-agent` store conversation history and three-tier memory (episodic / semantic / procedural) in `~/.my-agent/`. The agent's file tools have read/write access to that directory out of the box via `additionalRoots`.

To expose additional directories in a custom engine:

```ts
new AgentEngine({
    workingDir: process.cwd(),
    additionalRoots: [APP_DIR],   // ~/.my-agent/ or any extra root
    // ...
});
```

## MCP server

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

## Repository

```
packages/
  core/              @backendkit-labs/agent-core
  coding/            @backendkit-labs/agent-coding
  mcp-server/        @backendkit-labs/mcp-server
  create-bk-agent/   create-bk-agent (CLI scaffolder)
  templates/         starter templates
examples/
  bk-agent/          Full coding CLI example
  docker-agent/      Domain agent example (Docker / K8s)
  coding-assistant/  Minimal REPL example
```

## License

MIT (c) BackendKit Labs