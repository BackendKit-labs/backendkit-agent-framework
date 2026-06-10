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
import {
  AnthropicProvider,
  OllamaProvider,
  OpenAICompatibleProvider,
} from '@backendkit-labs/agent-coding';

// Anthropic (Claude)
new AnthropicProvider(apiKey, model?)

// Ollama — local LLM, no API key required
new OllamaProvider({ host?: string, model?: string })
// host default: http://localhost:11434
// model default: llama3.2
// checkConnection() verifies Ollama is running before first use

// OpenAI / DeepSeek / any OpenAI-compatible API
new OpenAICompatibleProvider({ apiKey, baseUrl, model })
```

**Local-first setup with Ollama:**

```ts
import { OllamaProvider } from '@backendkit-labs/agent-coding';

const engine = createCodingEngine({
  providers:       { local: new OllamaProvider({ model: 'qwen2.5-coder:7b' }) },
  defaultProvider: 'local',
  workingDir:      process.cwd(),
  appName:         'my-agent',
  transport,
});
```

---

## Built-in agents (10)

| Agent | ID | Specialty | Recommended model tier |
|---|---|---|---|
| General | `general` | Orchestrator — routes to specialists | smart |
| Architecture | `architecture` | Design, patterns, ADRs | smart |
| Security | `security` | Vulnerabilities, hardening | smart |
| Project Manager | `project-manager` | /init workflow, planning | smart |
| Coder | `coder` | Implementation, bulk edits | fast |
| Backend | `backend` | APIs, databases, services | fast |
| Frontend | `frontend` | UI, components, CSS | fast |
| QA Engineer | `qa-engineer` | Tests, edge cases, code review | fast |
| Infrastructure | `infrastructure` | Docker, CI/CD, cloud | fast |
| Data | `data` | Pipelines, models, queries | fast |

"Smart" agents reason and route — use a thinking/reasoning model. "Fast" agents execute tool calls in loops — use a cheap, low-latency model. See [per-agent model overrides](#per-agent-model-overrides) below.

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

## Per-agent model overrides

Each agent can run on a different model. Set `model` (and optionally `provider`) on the agent profile, or use environment variables so the split is configurable without code changes:

```ts
// createCodingEngine wires LLM_MODEL_SMART → reasoning agents, LLM_MODEL_FAST → execution agents
```

| Env var | Default | Purpose |
|---|---|---|
| `LLM_MODEL` | `gpt-4o` | Base model — used by all agents with no explicit override |
| `LLM_MODEL_FAST` | `LLM_MODEL` | Execution agents (coder, backend, frontend, qa, infra, data) |
| `LLM_MODEL_SMART` | `LLM_MODEL` | Reasoning agents (general, architecture, security, project-manager) |

Example `.env` for DeepSeek:

```env
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
LLM_MODEL_FAST=deepseek-chat
LLM_MODEL_SMART=deepseek-reasoner
```

Example `.env` mixing providers (OpenAI fast + Anthropic smart):

```env
LLM_API_KEY=sk-openai-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_MODEL_FAST=gpt-4o-mini
# Smart agents need a separate provider registered in engine.ts
```

For completely different LLM backends per agent, register multiple providers and set `provider` on the `AgentProfile`. See `@backendkit-labs/agent-core` docs for the multi-provider setup.

---

## License

MIT © [BackendKit Labs](https://github.com/BackendKit-labs)
