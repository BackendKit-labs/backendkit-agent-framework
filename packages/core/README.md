# @backendkit-labs/agent-core

**Status: core** — required for the enterprise story; changes go through full review.
See the [subsystem matrix](../../README.md#backendkit-labsagent-core-subsystem-matrix) for per-subsystem status (`qa`, `reflection`, `agent-memory`, `observability`, `triggers` are **experimental** and frozen during the pilot).

Generic multi-agent engine for TypeScript — model-agnostic, transport-agnostic, extensible.

```bash
npm install @backendkit-labs/agent-core
```

---

## Quick start

```ts
import { createBaseEngine } from '@backendkit-labs/agent-core';
import { AnthropicProvider } from '@backendkit-labs/agent-coding';

const engine = createBaseEngine({
  providers:       { claude: new AnthropicProvider(process.env.ANTHROPIC_API_KEY!) },
  defaultProvider: 'claude',
  agents: [{
    id: 'assistant',
    name: 'Assistant',
    description: 'A helpful assistant',
    systemPrompt: 'You are a helpful assistant.',
    allowedTools: [],
    delegatesTo: [],
  }],
});

await engine.run('Hello, what can you do?');
```

Or scaffold a full project:

```bash
npx create-bk-agent my-project
```

---

## Agent types

| Factory | Package | Use case |
|---------|---------|---------|
| `createBaseEngine` | `agent-core` | Full control — bring your own agents, tools, provider |
| `createCodingEngine` | `agent-coding` | Coding assistant with file tools, git, code execution |
| `createAutonomousAgent` | `agent-core` | Event-driven — cron, webhooks, custom events |

---

## Key APIs

### `createBaseEngine(opts)`

```ts
import { createBaseEngine } from '@backendkit-labs/agent-core';

const engine = createBaseEngine({
  providers:       { [id]: provider },   // LLMProvider instances
  defaultProvider: 'my-provider',
  agents:          [agentProfile],       // AgentProfile[]
  tools:           [toolDef],            // ToolDefinition[]
  defaultAgent:    'agent-id',
  workingDir:      process.cwd(),        // for file tool sandboxing
});

await engine.run('user input');
engine.abort();                          // cancel in-flight request
engine.updateWorkingDir('/new/path');    // live workspace switch
engine.reloadSkills();                   // reload YAML skills from disk
```

### `createAutonomousAgent(opts)`

```ts
import { createAutonomousAgent } from '@backendkit-labs/agent-core';

const agent = createAutonomousAgent({
  providers, defaultProvider, agents,
  goal: 'Monitor PRs and flag security issues',
  triggers: [
    { type: 'schedule', cron: '0 9 * * 1-5', task: 'Send daily digest' },
    { type: 'webhook',  path: '/github/pr',  secret: process.env.GH_SECRET },
    { type: 'event',    topic: 'ci.failed' },
  ],
});

await agent.start();
process.on('SIGTERM', () => agent.stop());
```

### `defineTool(opts)`

```ts
import { defineTool, z } from '@backendkit-labs/agent-core';

const myTool = defineTool({
  name:        'get_weather',
  description: 'Get current weather for a city',
  input: z.object({
    city: z.string().describe('City name'),
  }),
  execute: async ({ city }) => {
    return `Weather in ${city}: sunny, 22°C`;
  },
});
```

### `SkillManager` — install skill packs

```ts
import { createSkillManager } from '@backendkit-labs/agent-core';

const manager = createSkillManager('my-app');
await manager.install('https://github.com/my-org/my-skills');
```

### Slash commands

```ts
import { SlashCommandRegistry, registerBuiltinCommands } from '@backendkit-labs/agent-core';

const registry = new SlashCommandRegistry();
registerBuiltinCommands(registry);  // adds /help /agents /skills /workspace /plugin etc.

registry.register('/my-command', 'Description', async (ctx) => {
  ctx.emit('Hello from my command!');
});
```

Built-in commands registered by `registerBuiltinCommands`:

| Command | Description |
|---------|-------------|
| `/help` | List available commands |
| `/agents` | List agents or switch active agent |
| `/skills` | Manage skill packs — install, create, generate, update, uninstall |
| `/workspace` | Manage multi-project workspaces — create, add, switch, remove |
| `/plugin` | Manage MCP agent plugins — list, add, remove |
| `/status` | Show current agent and model |
| `/iteration` | Change iteration mode (interactive / auto / step-by-step) |
| `/checkpoint` | Create, list, or load session checkpoints |

### `/plugin` — MCP agent plugins

Plugins are MCP servers that extend the agent with new tools (docker, k8s, etc.) without modifying the engine code. `/plugin add` installs the package via `npm install` into `~/.{appName}/plugins/<name>/` and launches it with `node` — no global installs, no npx overhead, works on Windows.

Configuration is stored in `~/.{appName}/config.json` and loaded on next engine start.

```bash
# In the agent CLI
/plugin list              # show active plugins
/plugin add docker        # install @backendkit-labs/docker-agent
/plugin add k8s           # install @backendkit-labs/k8s-agent
/plugin remove docker     # remove a plugin (uninstalls package)
```

`/plugin add` auto-configures the plugin's LLM from the app's `defaultProvider` — no manual env editing needed:

```jsonc
// ~/.my-app/config.json (managed by /plugin add)
{
  "mcpServers": [
    {
      "name": "docker",
      "command": "node",
      "args": ["~/.my-app/plugins/docker/node_modules/@backendkit-labs/docker-agent/dist/mcp.js"],
      "env": {
        "LLM_PROVIDER": "deepseek",
        "LLM_BASE_URL": "https://api.deepseek.com/v1",
        "LLM_MODEL":    "deepseek-chat"
      }
    }
  ]
}
```

The `CommandContext` must have `appName` set for `/plugin` to know which config file to read:

```ts
await registry.dispatch('/plugin add docker', {
  emit: console.log,
  appName: 'my-app',   // reads/writes ~/.my-app/config.json
});
```

---

## Per-agent model overrides

Run routing/reasoning agents on a smarter model and tool-calling specialists on a cheaper one — without multiple engines or extra providers.

### Same LLM, different models

Set `model` on the `AgentProfile`. The engine passes it as a per-call override; providers use `callbacks.model ?? this.model`, so agents without an override use the provider default unchanged.

```ts
const engine = createBaseEngine({
  providers: {
    default: new OpenAICompatibleProvider({
      apiKey:  process.env.LLM_API_KEY!,
      baseUrl: 'https://api.deepseek.com/v1',
      model:   'deepseek-chat',   // fallback for agents with no model override
    }),
  },
  defaultProvider: 'default',
  agents: [
    { id: 'orchestrator', model: 'deepseek-reasoner', ... }, // smart — routing decisions
    { id: 'coder',        model: 'deepseek-chat',     ... }, // fast  — bulk tool calls
    { id: 'data-analyst', model: 'deepseek-chat',     ... }, // fast  — tool calls
  ],
});
```

### Different LLM providers per agent

Register multiple providers, then set `provider` on the agent profile. `model` is still a per-call override within the chosen provider.

```ts
const engine = createBaseEngine({
  providers: {
    deepseek:  new OpenAICompatibleProvider({
      apiKey: process.env.DEEPSEEK_API_KEY!, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
    }),
    anthropic: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  },
  defaultProvider: 'deepseek',
  agents: [
    { id: 'coder',     provider: 'deepseek',  model: 'deepseek-chat'   },  // fast
    { id: 'architect', provider: 'anthropic', model: 'claude-opus-4-8' },  // smart
  ],
});
```

The two levels are independent:

| Field | Selects | Fallback |
|---|---|---|
| `provider` | Which LLM backend (`ProviderRegistry`) | `defaultProvider` |
| `model` | Which model within that backend | Provider's configured default |

---

## Sub-path exports

```ts
import { ... } from '@backendkit-labs/agent-core';             // main
import { ... } from '@backendkit-labs/agent-core/orchestration'; // Orchestrator, FSM, PolicyEngine
import { ... } from '@backendkit-labs/agent-core/skills';        // SkillLoader, SkillManager
import { ... } from '@backendkit-labs/agent-core/workflow';      // WorkflowBuilder, WorkflowRunner
import { ... } from '@backendkit-labs/agent-core/triggers';      // TriggerManager, createAutonomousAgent
import { ... } from '@backendkit-labs/agent-core/memory';        // MemorySystem, EpisodicMemory
import { ... } from '@backendkit-labs/agent-core/observability'; // ObservabilityManager, Tracer
```

---

## License

MIT © [BackendKit Labs](https://github.com/BackendKit-labs)
