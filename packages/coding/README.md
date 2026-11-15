# @backendkit-labs/agent-coding

A production-ready coding agent engine built on `@backendkit-labs/agent-core`. Bundles 10 specialized agents, filesystem tools, multi-provider support (DeepSeek, OpenAI, Anthropic, Ollama, Kimi, Grok), automatic stack detection, persistent memory, QA review, reflection, and an orchestration pipeline — all in a single `createCodingEngine()` call.

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-coding)](https://www.npmjs.com/package/@backendkit-labs/agent-coding)

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [createCodingEngine](#createcodingengine)
- [createCodingEngineFromConfig](#createcodingenginefromconfig)
- [Providers](#providers)
- [Built-in agents](#built-in-agents)
- [Built-in tools](#built-in-tools)
- [Skill packs](#skill-packs)
- [Orchestration pipeline](#orchestration-pipeline)
- [Learning](#learning)
- [MCP server integration](#mcp-server-integration)
- [Multi-agent examples](#multi-agent-examples)
- [Config file](#config-file)

---

## Installation

```bash
npm install @backendkit-labs/agent-coding
```

All provider adapters are bundled — no separate packages needed.

---

## Quick start

```typescript
import { createCodingEngine } from '@backendkit-labs/agent-coding';

const engine = createCodingEngine({
  providers:       { deepseek: { apiKey: process.env.DEEPSEEK_API_KEY! } },
  defaultProvider: 'deepseek',
});

await engine.run('List all TypeScript files in src/ and tell me which ones have no tests');
```

That single call gives you: 10 specialized agents, filesystem tools (read/write/edit/search), persistent project memory, skill loading, and stack auto-detection.

---

## createCodingEngine

The primary factory. Returns a fully configured `AgentEngine`.

### Options reference

```typescript
interface CodingEngineOptions {
  // Required
  providers:       ProvidersConfig;
  defaultProvider: string;

  // Agents and engine
  defaultAgent?:          string;       // default: 'general'
  workingDir?:            string;       // default: process.cwd()
  maxIterations?:         number;       // default: 100
  maxParallelAgents?:     number;       // default: 6

  // I/O
  transport?:             Transport;    // default: StdoutTransport

  // App identity
  appName?:               string;       // default: 'bk-agent' — used for ~/.{appName}/

  // Persistence
  disablePersistence?:    boolean;      // skip ProjectStore (useful for testing)

  // MCP servers
  mcpServers?:            MCPServerConfig[];

  // Context sharing
  subAgentContextMessages?: number;    // messages visible to sub-agents (recommend 10-20)

  // Iteration control
  onToolApproval?:   (toolName, agentId, argsPreview) => Promise<ToolApprovalDecision>;
  onIterationLimit?: (stats: IterationStats) => Promise<boolean>;
  onStep?:           (stats: IterationStats) => Promise<boolean>;

  // Orchestration
  orchestration?:    boolean | OrchestrationOptions;
}
```

### Minimal setup

```typescript
const engine = createCodingEngine({
  providers:       { deepseek: { apiKey: 'sk-...' } },
  defaultProvider: 'deepseek',
});
```

### Multiple providers

```typescript
const engine = createCodingEngine({
  providers: {
    deepseek:  { apiKey: process.env.DEEPSEEK_API_KEY! },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY!, model: 'claude-opus-4-8' },
    ollama:    { host: 'http://localhost:11434', model: 'llama3.2' },
  },
  defaultProvider: 'deepseek',
  // Each agent profile can specify a provider override
});
```

### With full orchestration

```typescript
const engine = createCodingEngine({
  providers:       { deepseek: { apiKey: '...' } },
  defaultProvider: 'deepseek',
  orchestration:   true,
  // Enables:
  //   intent detection → domain detection → risk scoring
  //   policy engine → agent routing → QA auto-review → reflection
});
```

### With MCP servers

```typescript
const engine = createCodingEngine({
  providers:       { openai: { apiKey: '...' } },
  defaultProvider: 'openai',
  mcpServers: [
    { name: 'github',   command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],  env: { GITHUB_TOKEN: '...' } },
    { name: 'postgres', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { DATABASE_URL: '...' } },
  ],
  subAgentContextMessages: 15,
});
```

### With manual tool approval

```typescript
const engine = createCodingEngine({
  providers:       { deepseek: { apiKey: '...' } },
  defaultProvider: 'deepseek',
  onToolApproval:  async (toolName, agentId, argsPreview) => {
    const write = ['write_file', 'edit_file', 'run_command'];
    if (!write.includes(toolName)) return 'approve';
    console.log(`\n⚠  [${agentId}] ${toolName}:\n${argsPreview}\n`);
    const a = await prompt('Approve? (y/n/all): ');
    if (a === 'y')   return 'approve';
    if (a === 'all') return 'approve_all';
    return 'reject';
  },
});
```

`onToolApproval` is the right option for coding agents today. Package installs ask even after "all". `agent-core` also has a policy path (`policy`, `approver`, `approvals`) where approval is decided by what each tool declares. Do not switch a coding engine to it yet: the coding tools do not declare `readOnly`, so every `read_file` would ask. Declaring those facts on the coding tools is planned in SPEC-0015.

---

## createCodingEngineFromConfig

Reads credentials from `~/.{appName}/config.json`. No code changes needed to switch providers:

```typescript
import { createCodingEngineFromConfig } from '@backendkit-labs/agent-coding';

const engine = createCodingEngineFromConfig();

// With overrides
const engine = createCodingEngineFromConfig({
  workingDir:    '/my-project',
  orchestration: true,
});
```

---

## Providers

### DeepSeek

```typescript
providers: {
  deepseek: {
    apiKey:       process.env.DEEPSEEK_API_KEY!,
    model?:       'deepseek-chat',    // default
    maxTokens?:   8192,
    temperature?: 0.7,
  }
}
```

### OpenAI

```typescript
providers: {
  openai: {
    apiKey:   process.env.OPENAI_API_KEY!,
    model?:   'gpt-4o',
    baseUrl?: 'https://api.openai.com/v1',
  }
}
```

### Anthropic (Claude)

```typescript
providers: {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model?: 'claude-sonnet-4-6',    // default
  }
}
```

### Ollama (local — no API key)

```bash
# Prerequisites
ollama serve
ollama pull llama3.2
```

```typescript
providers: {
  ollama: {
    host?:  'http://localhost:11434',
    model?: 'llama3.2',
  }
}
```

### OpenAI-compatible (Kimi, Grok, any endpoint)

```typescript
providers: {
  kimi: { apiKey: process.env.KIMI_API_KEY!, model: 'moonshot-v1-8k' },
  grok: { apiKey: process.env.GROK_API_KEY!, model: 'grok-3' },
  // Any OpenAI-compatible endpoint
  vllm: { apiKey: 'local', baseUrl: 'http://localhost:8080/v1', model: 'my-model' },
}
```

---

## Built-in agents

Ten specialist agents are bundled. Orchestration routes tasks automatically; you can also select explicitly.

| Agent ID | Specialty |
|----------|-----------|
| `general` | General-purpose — default starting point |
| `architect` | System design, ADRs, architecture decisions |
| `backend-agent` | APIs, server logic, databases |
| `frontend-agent` | React, CSS, accessibility, UX |
| `devops-agent` | CI/CD, Docker, Kubernetes, infra |
| `database-agent` | SQL, indexes, migrations, query tuning |
| `security-reviewer` | Security audits, OWASP, threat modeling |
| `qa-engineer` | Test strategy, edge cases, QA reviews |
| `documentation-agent` | Docs, READMEs, API docs, changelogs |
| `refactoring-agent` | Code cleanup, technical debt, design patterns |

### Selecting an agent

```typescript
await engine.run('Audit src/ for SQL injection risks', { agentId: 'security-reviewer' });
```

### Adding custom agents

Create `~/.bk-agent/agents/my-agent.json`:

```json
{
  "id":           "my-agent",
  "name":         "My Custom Agent",
  "systemPrompt": "You are specialized in ...",
  "tools":        ["read_file", "run_command"],
  "provider":     "anthropic"
}
```

Loaded automatically — no code changes needed.

### Project agents and skills need a trusted project

Agents in `{project}/.bk-agent/agents/` and skills in `{project}/.bk-agent/skills/` are the **repository's** content, not yours: a cloned repo could ship an agent that replaces the built-in orchestrator with its own prompt and tools. So they load only for a project you trusted. Your own agents and skills under `~/.bk-agent/` always load.

```text
/trust              # is this project trusted, and what would its project layer load
/trust add          # trust it (records the real path in ~/.bk-agent/trusted-projects.json)
/trust remove       # stop trusting it
/trust list
```

- Trust is by **exact path**: trusting `~/code` does not trust a repository cloned inside it.
- For a project that is not trusted, the engine emits a warning naming what was left out. Skills load right after `/trust add`; agents the next time the agent starts.
- `BK_TRUST_PROJECT=1` trusts every path (CI, containers). A host that decides by itself can pass `trustedProject: true | false` to `createCodingEngine`.
- A missing or damaged trust file means nobody is trusted.

---

## Built-in tools

All agents have access to these tools via `CODING_TOOLS`:

| Tool | Description |
|------|-------------|
| `read_file` | Read a file by path |
| `write_file` | Create or overwrite a file |
| `edit_file` | Apply a targeted patch to a file |
| `list_directory` | List files in a directory |
| `run_command` | Execute a shell command |
| `search_files` | Recursive content search |
| `save_context` | Write to `session.md` (persisted notes) |
| `save_learning` | Append to `lecciones-aprendidas.md` |
| `save_audit` | Write a structured audit entry |
| `get_latest_audit` | Read the latest audit |
| `list_audits` | List audit entries |
| `save_user_preference` | Persist user preferences |
| `update_session` | Update the in-progress session note |

---

## Skill packs

Built-in packs activate based on detected project stack:

| Pack | Activates for |
|------|---------------|
| `GLOBAL_BUILTIN_SKILLS` | All projects |
| `NODE_PACK_SKILLS` | Node.js / TypeScript (`package.json`) |
| `GO_PACK_SKILLS` | Go (`go.mod`) |
| `JAVA_PACK_SKILLS` | Java (`pom.xml`, `build.gradle`) |
| `KOTLIN_PACK_SKILLS` | Kotlin / Android |
| `PYTHON_PACK_SKILLS` | Python (`requirements.txt`, `pyproject.toml`) |

---

## Orchestration pipeline

When `orchestration: true`, an intelligent routing layer runs before each LLM call:

```
Input
  → Intent Detection (feature? bug? refactor? question?)
  → Domain Detection (backend? frontend? security? ops?)
  → Risk Scoring (reads only? writes files? runs commands?)
  → Policy Engine (enforce domain-level rules)
  → Agent Selection (best agent for detected domain + risk)
  → LLM Call
  → QA Review (auto-review code-heavy responses)
```

### Custom orchestration

```typescript
orchestration: {
  capabilityMatrix: {
    'my-specialist': {
      owns:       ['payments', 'billing'],
      skills:     ['typescript', 'stripe'],
      baseWeight: 0.95,
    },
  },
  customRules: [
    {
      if:   { domain: 'security' },
      then: { mustInclude: ['security-reviewer'] },
    },
  ],
  enableQA:   true,
  noQA:       false,
  onQAReview: (review) => logger.info('[QA]', review),
}
```

---

## Learning

With `orchestration` on, the project learns from its audit gates and from tool calls that keep failing (the learning module of `agent-core`):

- The findings of each gate become experiences. The same failure seen 3 times becomes a **lesson** in the prompt of the agent that failed, and a **proposed rule** for the orchestrator.
- **A proposed rule is never applied on its own.** It waits for a person, kept in `~/.{appName}/projects/<project>/learning/`. Once approved, the orchestrator adds it to its policies on every `orchestrate()`.

```typescript
import { createCodingLearning } from '@backendkit-labs/agent-coding/pipeline';

const learning = createCodingLearning({ appName: 'my-app', projectRoot: process.cwd() });
createCodingEngine({ ..., orchestration: { learning } });      // or leave it out: a default instance is created

for (const p of await learning.proposals()) console.log(p.id, p.reason, p.subject);
await learning.approve(id, { kind: 'human', id: 'ana' });      // or learning.reject(id, ...)
await learning.retire(id);                                     // withdraws an approved rule
```

`learning: false` turns it off. The Reflection Engine (`reflection: true`), which promoted rules to `manifest.yaml` without asking, is deprecated and no longer on by default.

---

## MCP server integration

```typescript
mcpServers: [
  {
    name:    'code-intelligence',
    command: 'bk-mcp',               // @backendkit-labs/mcp-server
    args:    [],
    env:     { BK_APP_NAME: 'bk-agent', BK_CWD: process.cwd() },
  },
  {
    name:    'github',
    command: 'npx',
    args:    ['-y', '@modelcontextprotocol/server-github'],
    env:     { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
  },
],
subAgentContextMessages: 20,
```

---

## Multi-agent examples

### Feature implementation

```typescript
await engine.run(`
  Implement JWT authentication middleware for Express:
  - Validate Bearer token in Authorization header
  - Attach decoded user to req.user
  - Return 401 with clear error messages
  - Include unit tests with valid/expired/malformed token cases
`);
// architect plans → backend-agent implements → qa-engineer writes tests
```

### Security audit

```typescript
await engine.run(`
  Audit all routes in src/routes/ for:
  1. Missing auth middleware
  2. SQL injection vulnerabilities
  3. Exposed sensitive data
  Output a prioritized fix list.
`, { agentId: 'security-reviewer' });
```

### Database migration

```typescript
await engine.run(`
  Write a zero-downtime migration: add NOT NULL column 
  'last_login_at TIMESTAMP DEFAULT NOW()' to the users table (50M rows).
  Include rollback script and backfill strategy.
`, { agentId: 'database-agent' });
```

### Full stack refactor

```typescript
await engine.run(`
  Refactor auth from session cookies to JWT.
  Update both Express middleware and React login flow.
  Keep backward compatibility for 2 more sprints.
`);
// backend-agent + frontend-agent + security-reviewer
```

---

## Config file

`~/.bk-agent/config.json`:

```json
{
  "defaultProvider": "deepseek",
  "providers": {
    "deepseek": { "apiKey": "sk-xxxx", "model": "deepseek-chat" },
    "anthropic": { "apiKey": "sk-ant-xxxx", "model": "claude-sonnet-4-6" },
    "ollama":    { "host": "http://localhost:11434", "model": "llama3.2" }
  },
  "mcpServers": [
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxxx" }
    }
  ]
}
```

## `agent-coding/cli`

The file-based adapters and the terminal-app pieces that used to live in `agent-core` (SPEC-0016): `fileAgentSource` and `fileInstructionSource` (`AGENT.md`, `USER.md`, `~/.appName/agents`), `SkillLoader` / `SkillManager` and the skill providers, `detectStack`, `registerBuiltinCommands`, workspaces, checkpoints, trust and the first-run seed. `createCodingEngine` wires them for you; use the subpath when you build your own engine with `createBaseEngine({ agentSources, skillSources, instructionSources })`.
