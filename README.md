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

| Template | Use case |
|----------|---------|
| `coding` | Developer assistant — files, git, code execution |
| `domain-agent` | Docker, AWS, DB — orchestrator + specialists |
| `autonomous` | Monitoring, scheduled tasks, event pipelines |
| `mcp-server` | Expose tools to Claude Desktop / Cursor / VS Code |
| `minimal` | Full control — bring your own agents and tools |

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