# create-bk-agent

> **Status: `stable`** — Maintained and production-ready. No new features during the pilot phase.

CLI scaffolding tool for the BackendKit Labs agent framework. Generates a fully configured TypeScript agent project in seconds — choose your architecture, deployment mode, and LLM provider, and get a working project with all dependencies wired.

## Usage

```bash
npm create bk-agent@latest my-agent
cd my-agent && npm install && npm run dev

# Or with npx:
npx create-bk-agent my-agent
```

---

## Interactive setup

The CLI asks three questions:

1. **Architecture** — what kind of agent?
2. **Deploy mode** — how will it be used?
3. **Provider** — which LLM API?

---

## Architectures

### `multi-agent` — Multi-agent orchestrator

A routing orchestrator that delegates tasks to specialized sub-agents. Best for complex domains with distinct request types.

```
src/
├── agents/         ← agent profiles (JSON)
├── tools/          ← typed tool definitions
├── orchestrator.ts ← routes requests to sub-agents
└── index.ts
```

**Use case:** A customer platform with separate agents for billing, support, and account management.

### `single` — Single-agent assistant

One agent with a custom system prompt and your tools.

```
src/
├── tools/
├── agent.ts
└── index.ts
```

### `coding` — Coding assistant

Pre-configured with 10 coding agents, filesystem tools, persistent memory, and stack detection. Ready to use immediately.

```
src/
└── index.ts    ← createCodingEngine() + readline REPL
AGENT.md        ← project context injected into every LLM call
```

**Use case:** A project-specific coding assistant with your team's conventions in `AGENT.md`.

### `autonomous` — Autonomous daemon

Runs on a schedule without user interaction. Pre-wired with `createAutonomousAgent` + cron trigger.

```
src/
├── triggers/
├── tools/
└── index.ts    ← cron + event loop
```

**Use case:** Nightly reports, daily standups, automated monitoring.

### `minimal` — Minimal / embedded

Bare-bones template — just `AgentEngine`, one tool, one agent. Use when embedding an agent into an existing application or building a library.

```
src/
└── index.ts    ← AgentEngine, bare minimum
```

### `enterprise` — Enterprise (local LLM + RAG)

Full enterprise setup: Ollama LLM, Obsidian vault as knowledge base, six department agents (General, Support, HR, Sales, Finance, Ops), VaultWriter, and optionally an `AgentServer` web server.

```
src/
├── server.ts       ← createEnterpriseSetup() + AgentServer
└── agents/         ← 6 department profiles
.env.example        ← VAULT_PATH, JWT_SECRET, PORT, OLLAMA_HOST
```

---

## Deploy modes

| Mode | Description |
|------|-------------|
| `repl` | Terminal REPL — stdin/stdout |
| `mcp-stdio` | MCP server over stdio (for Claude Desktop, agent-core) |
| `mcp-http` | MCP server over HTTP (`npm run server`) |
| `hybrid` | REPL + MCP server side-by-side |
| `library` | Exports an engine factory, no I/O |
| `web` | Fastify web server — chat + kanban (enterprise only) |

---

## Provider options

| Provider | Required env var |
|----------|-----------------|
| DeepSeek | `DEEPSEEK_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Ollama (local) | *(none — requires `ollama serve`)* |

The scaffolded `.env.example` lists all required variables.

---

## Scaffolded project structure

### Coding assistant (simplest)

```
my-agent/
├── src/
│   └── index.ts      ← createCodingEngine() + readline REPL
├── AGENT.md          ← project context (edit this!)
├── package.json
├── tsconfig.json
└── .env.example
```

**`AGENT.md`** is injected into every LLM call. Describe your project, stack, and conventions:

```markdown
# My Project

## Tech stack
Node.js 20, TypeScript 5, Express 4, PostgreSQL 15

## Conventions
- All functions must have JSDoc
- Tests use Jest + Supertest
- Never use `any` — use `unknown`

## Architecture
REST API with repository pattern. DB access only via src/repositories/.
```

### Enterprise web server (most complete)

```
my-agent/
├── src/
│   ├── server.ts         ← createEnterpriseSetup() + AgentServer
│   └── agents/           ← 6 department profiles
├── .env.example          ← VAULT_PATH, OLLAMA_HOST, JWT_SECRET, PORT
├── package.json          ← agent-enterprise + agent-web
└── tsconfig.json
```

---

## Examples

### Coding assistant

```bash
npx create-bk-agent my-dev-assistant
# → coding → repl → deepseek

cd my-dev-assistant
cp .env.example .env
# Edit .env: add DEEPSEEK_API_KEY

# Describe your project
nano AGENT.md

npm install && npm run dev
# > What can I help with?
```

### Enterprise on-premises assistant

```bash
npx create-bk-agent company-assistant
# → enterprise → web → ollama

cd company-assistant
cp .env.example .env
# Edit .env: VAULT_PATH=/path/to/obsidian-vault

ollama serve
ollama pull llama3.2
ollama pull nomic-embed-text

npm install && npm run dev
# → Indexing vault...
# → Server running on :4001
# Chat:    http://localhost:4001/
# Kanban:  http://localhost:4001/#kanban
```

### Autonomous cron agent

```bash
npx create-bk-agent standup-bot
# → autonomous → repl → deepseek

cd standup-bot
# Edit src/triggers/index.ts: schedule, prompt, output
npm install && npm run dev
```

### MCP server exposing your tools

```bash
npx create-bk-agent my-tools-server
# → single → mcp-http → openai

cd my-tools-server
# Add tools to src/tools/
# Add agent to src/agents/
npm install && npm run server   # MCP server on :3000
```

Claude Desktop config:

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "npx",
      "args": ["-y", "my-tools-server"]
    }
  }
}
```

---

## `bk add` command

After scaffolding, add new components to your project:

```bash
bk add tool lookup-order      # creates src/tools/lookup-order.ts
bk add agent billing          # creates src/agents/billing.json
bk add trigger daily-report   # adds a cron trigger
```

---

## Scripts in scaffolded projects

| Script | Description |
|--------|-------------|
| `npm run dev` | Development with tsx / ts-node |
| `npm run build` | Compile TypeScript |
| `npm run start` | Run compiled output |
| `npm run server` | Start MCP or web server |
| `npm run typecheck` | TypeScript type-check only |
