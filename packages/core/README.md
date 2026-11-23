# @backendkit-labs/agent-core

The foundation engine for the BackendKit Labs agent framework. Provides everything needed to build, run, and compose AI agents: typed tool definitions, provider adapters, session memory, MCP client, workflow orchestration, and advanced multi-layer memory.

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-core)](https://www.npmjs.com/package/@backendkit-labs/agent-core)

---

## Installation

```bash
npm install @backendkit-labs/agent-core
```

Requires Node.js ≥ 18 and TypeScript ≥ 5.0.

---

## Quick start

The fastest path to a running agent:

```typescript
import {
  AgentEngine,
  AgentRegistry,
  ToolRegistry,
  ProviderRegistry,
  defineTool,
  z,
  StdoutTransport,
  selfAssertedIdentities,
} from '@backendkit-labs/agent-core';

// 1. Define a tool
const weatherTool = defineTool({
  name: 'get_weather',
  description: 'Returns current weather for a city',
  input: z.object({
    city: z.string().describe('City name'),
  }),
  execute: async ({ city }) => `Weather in ${city}: sunny, 22°C`,
});

// 2. Register tools and agents
const tools = new ToolRegistry();
tools.register(weatherTool);

const agents = new AgentRegistry();
agents.register({
  id:           'general',
  name:         'General Assistant',
  systemPrompt: 'You are a helpful assistant. Use available tools when relevant.',
  tools:        ['get_weather'],
});

// 3. Register an LLM provider
const providers = new ProviderRegistry();
providers.register('my-provider', myLLMProvider);

// 4. Run
const engine = new AgentEngine({
  model:           { provider: 'my-provider', id: 'gpt-4o' },
  agents,
  tools,
  providers,
  defaultProvider: 'my-provider',
  defaultAgentId:  'general',
  transport:       new StdoutTransport(),
  maxIterations:   10,
  iterationMode:   'auto',
  agentIdentity:   selfAssertedIdentities(),   // who the agent is
  identity:        { userId: 'me' },           // on whose behalf it acts
});

await engine.run("What's the weather in London?");
```

An agent that acts needs an identity and a person to act for, or the engine denies every tool call and says how to fix it. [Identity and external identity services](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#identity-who-the-agent-is-and-external-identity-services) explains how to plug in a real identity provider.

---

## What else is in it

New here? Start with the [learning path](https://backendkit-agent-framework.vercel.app/start/learning-path/). Everything below is in the **[reference](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md)**: each topic has its own section with examples.

| Topic | What it covers |
|---|---|
| [defineTool — typed tools with Zod](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#definetool--typed-tools-with-zod) | `defineTool` wraps a function with a Zod input schema. |
| [AgentEngine — the execution core](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#agentengine--the-execution-core) | `AgentEngine` is the stateful agent runner. |
| [createBaseEngine — high-level factory](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#createbaseengine--high-level-factory) | `createBaseEngine` assembles all internals from a flat options object so you don't have to instantiate registries manually. |
| [Context compaction (token budget)](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#context-compaction-token-budget) | `maxContextMessages` caps the history by message count and discards what it cuts. |
| [Guardrails](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#guardrails) | Checks on what enters and leaves the agent loop, applied to the main agent and every sub-agent |
| [Tool cancellation and time limits](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#tool-cancellation-and-time-limits) | Every tool call receives `ctx.signal`, an `AbortSignal` that fires when the engine is aborted (`engine.abort()`, or a budget stop with... |
| [Providers](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#providers) | Providers wrap LLM APIs and implement the `LLMProvider` interface. |
| [Transports](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#transports) | Transports receive `AgentEvent` objects and deliver them to consumers. |
| [SessionMemory](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#sessionmemory) | `SessionMemory` stores conversation messages for the current session. |
| [MCP client](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#mcp-client) | `MCPClientManager` connects to external MCP (Model Context Protocol) servers, discovers their tools, and makes them available to the engine. |
| [MCP tool server (tools without a model)](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#mcp-tool-server-tools-without-a-model) | `createToolServer` exposes `ToolDefinition`s as MCP tools that run directly |
| [Workflow engine](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#workflow-engine) | Build declarative multi-agent workflows with `WorkflowBuilder`. |
| [Flows — declarative and durable](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#flows--declarative-and-durable) | A business flow is data |
| [Advanced memory system](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#advanced-memory-system) | Beyond session history, agents can use a three-layer persistent memory. |
| [Observability](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#observability) | `ObservabilityManager` ties together cost tracking, metrics collection, and distributed tracing. |
| [Identity: who the agent is, and external identity services](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#identity-who-the-agent-is-and-external-identity-services) | Since 0.49 an agent that acts carries two things, and the engine refuses every tool call without them |
| [Learning from experience](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#learning-from-experience) | An agent learns from what happens to it. |
| [What `engine.run` returns](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#what-enginerun-returns) | Every tool that fails with a `ToolError(code, message)` (or `ToolArgumentError`) shows its `code` in `toolCalls`, in the audit event and in the... |
| [Sources of agents, skills and instructions](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#sources-of-agents-skills-and-instructions) | The engine reads no file by itself. |
| [Skills and slash commands](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#skills-and-slash-commands) | Skills are reusable prompt snippets that augment agent behavior. |
| [Checkpoints](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#checkpoints) | Save and restore session state for recovery and branching. |
| [Workspaces](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#workspaces) | Manage multiple projects and let agents switch context between them. |
| [Autonomous agents and triggers](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#autonomous-agents-and-triggers) | Create fire-and-forget agents that run on schedules or in response to events. |
| [Delegation bus](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#delegation-bus) | `DelegationBus` enables multi-agent collaboration — orchestrators delegate sub-tasks to specialized agents and collect results. |
| [Type reference](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/REFERENCE.md#type-reference) | Key types exported from `@backendkit-labs/agent-core` |
