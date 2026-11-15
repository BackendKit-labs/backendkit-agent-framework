# Project templates

Source of the projects that [`create-bk-agent`](../create-bk-agent) generates. This directory is not published on its own: `create-bk-agent` copies it into its package when it is packed (`scripts/copy-templates.js`).

A generated project is one **architecture** from `base/` plus one **deploy mode** from `deploy/`:

| `base/` | What it is |
|---|---|
| `coding` | Coding assistant: 10 agents and the file, git and command tools |
| `multi-agent` | Orchestrator and specialists, no tools: you define the domain |
| `single` | One agent with tools |
| `autonomous` | Cron, webhook and event triggers |
| `enterprise` | Local LLM and an Obsidian knowledge base (RAG) |
| `orchestrator` | Multi-step workflows with approval gates |
| `minimal` | The bare engine |

| `deploy/` | How it runs |
|---|---|
| `repl` | Interactive terminal |
| `mcp-stdio` | MCP server over stdio (for Claude Desktop, IDEs, other agents) |
| `mcp-http` | MCP server over HTTP |
| `hybrid` | Terminal and MCP HTTP together |

`coding/AGENT.md` is the default project description the coding architecture starts with.

When you change a framework version range here, keep it in step with the workspace version: the scaffolder's tests (`create-bk-agent/src/__tests__/scaffold.test.ts`) fail if a template asks for a version the repository does not have.
