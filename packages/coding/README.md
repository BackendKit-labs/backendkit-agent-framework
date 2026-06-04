# @backendkit-labs/agent-coding

Coding agent for the BackendKit agent framework — 10 specialized agents, file tools, git integration, LLM providers.

```bash
npm install @backendkit-labs/agent-coding
```

> **Quickstart**: `npx create-bk-agent my-project` — scaffolds a complete project in seconds.

---

## Usage

```ts
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { CallbackTransport } from '@backendkit-labs/agent-core';

const transport = new CallbackTransport((event) => {
  if (event.type === 'token') process.stdout.write(event.content);
});

const engine = createCodingEngine({
  providers:       { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! } },
  defaultProvider: 'anthropic',
  workingDir:      process.cwd(),
  appName:         'my-agent',
  transport,
});

await engine.run('Add error handling to src/api/users.ts');
```

---

## Providers

```ts
import { AnthropicProvider, OpenAICompatibleProvider } from '@backendkit-labs/agent-coding';

// Anthropic
new AnthropicProvider(apiKey, model?)

// OpenAI / DeepSeek / Ollama / any OpenAI-compatible
new OpenAICompatibleProvider({ apiKey, baseUrl, model })
```

---

## Built-in agents (10)

| Agent | ID | Specialty |
|---|---|---|
| General | `general` | Orchestrator — routes to specialists |
| Coder | `coder` | Implementation, bulk edits |
| Backend | `backend` | APIs, databases, services |
| Frontend | `frontend` | UI, components, CSS |
| QA Engineer | `qa-engineer` | Tests, edge cases, code review |
| Security | `security` | Vulnerabilities, hardening |
| Architecture | `architecture` | Design, patterns, ADRs |
| Infrastructure | `infrastructure` | Docker, CI/CD, cloud |
| Data | `data` | Pipelines, models, queries |
| Project Manager | `project-manager` | /init workflow, planning |

---

## Built-in tools

File operations (`read_file`, `write_file`, `edit_file`, `list_directory`, `search_files`),
command execution (`run_command`), memory (`save_learning`, `save_context`, `update_session`),
audit trail (`save_audit`).

All file tools are sandboxed to `workingDir` — path traversal is blocked at the framework level.

---

## Skills

Skills inject domain knowledge into the agent's context when triggered by keywords.

```ts
// Built-in global skills (always available)
// conventional-commits, code-review, tdd, adr, security-checklist

// Built-in language packs (activated by detected stack)
// node-pack, python-pack, go-pack, java-pack, kotlin-pack

// Install external skill packs
// /skills install https://github.com/my-org/my-skills
```

---

## createCodingEngine options

```ts
createCodingEngine({
  providers,           // { [id]: { apiKey, model?, baseUrl? } }
  defaultProvider,     // provider ID to use by default
  workingDir,          // project root — all file tools are scoped here
  appName,             // used for ~/.{appName}/ data directory
  transport,           // CallbackTransport | StdoutTransport
  maxIterations?,      // default: 50
  iterationMode?,      // 'interactive' | 'auto' | 'step-by-step'
  mcpServers?,         // MCP server configs for external tool providers
  orchestration?,      // enable orchestration pipeline (risk scoring, gates)
})
```

---

## License

MIT © [BackendKit Labs](https://github.com/BackendKit-labs)
