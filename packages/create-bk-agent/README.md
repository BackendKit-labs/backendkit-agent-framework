# create-bk-agent

Scaffold a new [BackendKit agent](https://github.com/BackendKit-labs/backendkit-agent-framework) project in seconds.

## Usage

```bash
npx create-bk-agent my-project
```

```
✨  create-bk-agent  v0.14.0

? Project name:  my-project
? Template:      coding — Coding assistant (files, git, code execution)
? LLM provider:  Anthropic (Claude)

Creating coding agent in ./my-project...
Installing dependencies...

✅  Done!
   cd my-project
   cp .env.example .env
   npm run dev
```

## Templates

### `coding` — complete, ready to run
10 specialized agents (backend, frontend, QA, security, architecture…) and all
coding tools (read/write files, run commands, git, search) are already configured.
Add your API key, describe your project in `AGENT.md`, and it works out of the box.
**Choose this when you want a coding assistant, not when you want to build one.**

### `domain-agent` — blank multi-agent architecture
Orchestrator + specialists pattern with no pre-built agents or tools. You define
the agents and tools for your specific domain (Docker, AWS, databases, APIs, etc.).
The framework handles orchestration, delegation, and parallel execution.
**Choose this when you are building a new type of agent from scratch.**

| Template | What it gives you | You provide |
|----------|------------------|-------------|
| `coding` | 10 agents + all coding tools | API key + `AGENT.md` |
| `domain-agent` | Orchestration skeleton | Agents + tools for your domain |
| `autonomous` | Trigger system (cron / webhook / event) | Agent logic |
| `mcp-server` | MCP server boilerplate | Tools to expose |
| `minimal` | Bare engine | Everything |

## Providers

Supports Anthropic (Claude), OpenAI, DeepSeek / OpenAI-compatible endpoints, and Ollama (local).

## License

MIT © [BackendKit Labs](https://github.com/BackendKit-labs)
