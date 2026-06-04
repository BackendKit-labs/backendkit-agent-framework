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

| Template | Use case |
|----------|---------|
| `coding` | Coding assistant — edit files, run commands, search code |
| `domain-agent` | Multi-agent system — orchestrator + domain specialists |
| `autonomous` | Autonomous agent — cron schedules, webhooks, events |
| `mcp-server` | MCP server — expose tools via Model Context Protocol |
| `minimal` | Bare engine — full control over everything |

## Providers

Supports Anthropic (Claude), OpenAI, DeepSeek / OpenAI-compatible endpoints, and Ollama (local).

## License

MIT © [BackendKit Labs](https://github.com/BackendKit-labs)
