# BackendKit Agent Framework

Multi-agent framework for TypeScript — build coding assistants, autonomous agents, domain specialists, and MCP servers from a single engine.

## Quickstart

```bash
npx create-bk-agent my-project
```

Prompts for a template and LLM provider, then scaffolds a ready-to-run project.

## Packages

| Package | Description |
|---------|-------------|
| [`@backendkit-labs/agent-core`](packages/core) | Generic engine — model-agnostic, transport-agnostic |
| [`@backendkit-labs/agent-coding`](packages/coding) | Coding agents, file tools, git integration, LLM providers |
| [`@backendkit-labs/mcp-server`](packages/mcp-server) | MCP server — skills and code intelligence |
| [`create-bk-agent`](packages/create-bk-agent) | CLI scaffolder |

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

Five starter templates in [`packages/templates/`](packages/templates):

### coding — complete, ready to run

10 specialized agents + all file/git/command tools already wired. Run it, describe
your project in `AGENT.md`, and it works. Extend the UI or add extra tools on top.
Choose this when you want a coding assistant, not when you want to build one from scratch.

### domain-agent — blank multi-agent architecture

Orchestrator + specialist pattern with no pre-built agents or tools.
You define the agents, the tools, and the domain. The framework handles
orchestration, delegation, and parallel execution. Use this to build any type
of agent: infra, data, customer support, finance — anything that is not about editing code.

| Template | What it gives you | You provide |
|----------|------------------|-------------|
| `coding` | 10 agents + all coding tools | LLM key + `AGENT.md` description |
| `domain-agent` | Orchestration skeleton | Agents + tools for your domain |
| `autonomous` | Trigger system (cron/webhook/event) | Agent logic + what to do on trigger |
| `mcp-server` | MCP server boilerplate | Tools to expose |
| `minimal` | Bare engine | Everything |

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