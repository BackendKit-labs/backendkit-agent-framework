# create-bk-agent

Scaffold a new [BackendKit agent](https://github.com/BackendKit-labs/backendkit-agent-framework) project in seconds — or add capabilities to an existing one.

## Create a project

```bash
npx create-bk-agent my-project
```

The CLI asks three questions and generates a production-ready project:

```
✨  create-bk-agent  v0.17.0

? Project name:          my-project
? Architecture:          Multi-agent (orchestrator + specialists)
? Skill packs:           Node.js / TypeScript
? How will it be used?   MCP Server (HTTP)

Creating Multi-agent — MCP Server (HTTP) agent in ./my-project...
Installing dependencies...

✅  Done! Your agent is ready.

   cd my-project
   cp .env.example .env      # add your API key
   npm run server            # starts HTTP MCP on port 3001
```

## Architectures

| Architecture | What it gives you | Best for |
|---|---|---|
| `multi-agent` | Orchestrator + specialists with delegation | Domain agents (DevOps, finance, data, etc.) |
| `single` | One agent with a tool registry | Simple task automation |
| `coding` | 10 pre-built agents + all coding tools | Coding assistants, ready out of the box |
| `autonomous` | Trigger system (cron / webhook / event) | Scheduled or event-driven daemons |
| `minimal` | Bare engine, no entry point | Library embedding |

## Deploy modes

Available for `multi-agent` and `single` architectures:

| Mode | Entry point | Use case |
|---|---|---|
| `repl` | `src/index.ts` — readline loop | Local terminal tool |
| `mcp-http` | `src/server.ts` — HTTP MCP server | Connect to Claude Desktop, Cursor, etc. |
| `mcp-stdio` | `src/server.ts` — stdio MCP server | Subprocess / pipe-based MCP |
| `hybrid` | Both `index.ts` + `server.ts` | REPL for dev, server for production |
| `library` | Only `src/engine.ts` exported | Import the engine in your own app |

## Providers

Anthropic (Claude), OpenAI, DeepSeek / any OpenAI-compatible endpoint, and Ollama (local).

---

## Add capabilities to an existing project

Once a project is created, use `add` to extend it without editing code manually:

```bash
npx create-bk-agent add <module> [options]
```

### `add server` — expose the agent as an HTTP MCP server

```bash
npx create-bk-agent add server
npx create-bk-agent add server --port 4000 --name my-agent
```

- Generates `src/server.ts` wired to the existing engine
- Adds `@backendkit-labs/mcp-server` to `dependencies`
- Adds `"server"` script to `package.json`

### `add specialist <name>` — add a specialist agent (multi-agent projects)

```bash
npx create-bk-agent add specialist data-analyst
npx create-bk-agent add specialist git-expert
```

- Creates `src/agents/<name>.ts` with an `AgentProfile` stub
- Patches `src/engine.ts`: adds the import and `agents.register()`

### `add tools <domain>` — add a tool file for a new domain

```bash
npx create-bk-agent add tools github
npx create-bk-agent add tools my-database
```

- Creates `src/tools/<domain>-tools.ts` with two stub tools (action + query)
- Patches `src/engine.ts`: adds the import and `tools.register()`

### `add mcp-client <url>` — connect to a remote MCP server

```bash
npx create-bk-agent add mcp-client http://localhost:3001/mcp
npx create-bk-agent add mcp-client http://billing-agent/mcp --name billing
```

- Patches `src/engine.ts`: adds the entry to `mcpServers: [...]` inside `AgentEngine`
- Creates the `mcpServers` array if it doesn't exist yet

All `add` commands are **idempotent** — running the same command twice won't duplicate entries.

---

## Requirements

- Node.js >= 20
- An API key for your chosen provider (Anthropic, OpenAI, DeepSeek, or Ollama)

## License

MIT © [BackendKit Labs](https://github.com/BackendKit-labs)
