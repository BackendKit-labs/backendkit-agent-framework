# @backendkit-labs/agent-core

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
registerBuiltinCommands(registry);  // adds /help /agents /skills /workspace etc.

registry.register('/my-command', 'Description', async (ctx) => {
  ctx.emit('Hello from my command!');
});
```

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
