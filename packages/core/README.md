# @backendkit-labs/agent-core

The foundation engine for the BackendKit Labs agent framework. Provides everything needed to build, run, and compose AI agents: typed tool definitions, provider adapters, session memory, MCP client, workflow orchestration, and advanced multi-layer memory.

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-core)](https://www.npmjs.com/package/@backendkit-labs/agent-core)

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [defineTool — typed tools with Zod](#definetool--typed-tools-with-zod)
- [AgentEngine — the execution core](#agentengine--the-execution-core)
- [createBaseEngine — high-level factory](#createbaseengine--high-level-factory)
- [Context compaction (token budget)](#context-compaction-token-budget)
- [Guardrails](#guardrails)
- [Providers](#providers)
- [Transports](#transports)
- [SessionMemory](#sessionmemory)
- [MCP client](#mcp-client)
- [MCP tool server (tools without a model)](#mcp-tool-server-tools-without-a-model)
- [Workflow engine](#workflow-engine)
- [Advanced memory system](#advanced-memory-system)
- [Observability](#observability)
- [Skills and slash commands](#skills-and-slash-commands)
- [Checkpoints](#checkpoints)
- [Workspaces](#workspaces)
- [Autonomous agents and triggers](#autonomous-agents-and-triggers)
- [Delegation bus](#delegation-bus)
- [Type reference](#type-reference)

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
});

await engine.run("What's the weather in London?");
```

---

## defineTool — typed tools with Zod

`defineTool` wraps a function with a Zod input schema. The engine validates inputs before calling `execute`, and the TypeScript types flow through automatically.

### Basic tool

```typescript
import { defineTool, z } from '@backendkit-labs/agent-core';

const greetTool = defineTool({
  name:        'greet',
  description: 'Greet a user by name',
  input:       z.object({ name: z.string() }),
  execute:     async ({ name }) => `Hello, ${name}!`,
});
```

### Optional parameters and defaults

```typescript
const searchTool = defineTool({
  name:        'search_products',
  description: 'Search the product catalog',
  input: z.object({
    query:    z.string().describe('Search term'),
    category: z.string().optional().describe('Filter by category'),
    limit:    z.number().min(1).max(50).default(10),
    sort:     z.enum(['price_asc', 'price_desc', 'relevance']).default('relevance'),
  }),
  execute: async ({ query, category, limit, sort }) => {
    const results = await db.products.search({ query, category, limit, sort });
    return results.map(p => `${p.name} — $${p.price}`).join('\n');
  },
});
```

### Structured / nested input

```typescript
const createOrderTool = defineTool({
  name:        'create_order',
  description: 'Create a new customer order',
  input: z.object({
    customer: z.object({
      id:    z.string(),
      email: z.string().email(),
    }),
    items: z.array(z.object({
      productId: z.string(),
      qty:       z.number().int().positive(),
    })).min(1),
    shippingAddress: z.string(),
    notes:           z.string().optional(),
  }),
  execute: async ({ customer, items, shippingAddress, notes }) => {
    const order = await orders.create({ customer, items, shippingAddress, notes });
    return `Order ${order.id} created for ${items.length} item(s).`;
  },
});
```

### Returning JSON

Return a JSON string so the LLM can reason about structured data:

```typescript
const analyzeCodeTool = defineTool({
  name:        'analyze_code',
  description: 'Analyze code and return structured issues',
  input: z.object({
    code:     z.string(),
    language: z.string(),
  }),
  execute: async ({ code, language }) => {
    const issues = await analyzer.run(code, language);
    return JSON.stringify({
      issueCount: issues.length,
      critical:   issues.filter(i => i.severity === 'critical'),
      warnings:   issues.filter(i => i.severity === 'warning'),
    });
  },
});
```

### Tool that throws (error signaling)

When a tool throws, the engine catches the error and tells the LLM, which can retry with corrected arguments or apologize to the user:

```typescript
const lookupUserTool = defineTool({
  name:        'lookup_user',
  description: 'Look up a user by email',
  input:       z.object({ email: z.string().email() }),
  execute: async ({ email }) => {
    const user = await db.users.findByEmail(email);
    if (!user) throw new Error(`No user found with email ${email}`);
    return JSON.stringify(user);
  },
});
```

### Declared facts: readOnly, destructive, meta

A tool can say what it does so the engine and MCP clients can treat it accordingly. The fields are optional and absent unless declared, so existing tools are unaffected.

```typescript
const balancesTool = defineTool({
  name:        'balances_at',
  title:       'Balances at date',
  description: 'Account balances at the end of a day',
  readOnly:    true,                       // implies concurrencySafe; MCP readOnlyHint
  idempotent:  true,                       // MCP idempotentHint
  meta:        { autonomyLevel: 0, erpOperation: 'query' }, // MCP _meta, for governance clients
  input:       z.object({ date: z.string() }),
  execute:     async ({ date }) => JSON.stringify(await ledger.balances(date)),
});

const payTool = defineTool({
  name:        'pay_invoice',
  description: 'Pay an approved invoice',
  destructive: true,                       // MCP destructiveHint; a direct MCP server must authorize every call
  input:       z.object({ invoiceId: z.string(), approvalId: z.string() }),
  execute:     async (args) => JSON.stringify(await treasury.pay(args)),
});
```

| Field | Meaning | MCP |
|---|---|---|
| `title` | Human-readable name | `title` |
| `readOnly` | Mutates nothing. Implies `concurrencySafe`; cannot be combined with `destructive`. | `readOnlyHint` |
| `destructive` | A write that cannot be undone from the outside. Cannot be `concurrencySafe`. | `destructiveHint` |
| `idempotent` | Same arguments again, no additional effect | `idempotentHint` |
| `openWorld` | Talks to entities outside the system | `openWorldHint` |
| `meta` | Free-form, never read by the engine | `_meta` |

Contradictions throw `ToolDefinitionError` at definition time, not at call time. For a hand-written `ToolDefinition`, call `validateToolDefinition(tool)` yourself; the MCP tool server does. When the **client** side consumes an MCP server (`MCPClientManager`), these facts are copied from the server's annotations only with `trustAnnotations: true`: what a server says about its tools is a claim.

### Running a tool outside an engine

`createToolContext()` builds the `ExecutionContext` a tool expects, with in-memory session memory and an `askAgent` that rejects. Use it in tests, scripts, cron jobs or anywhere there is no `AgentEngine`:

```typescript
import { createToolContext } from '@backendkit-labs/agent-core';

const out = await balancesTool.execute({ date: '2026-10-31' }, createToolContext({ workingDir: process.cwd() }));
```

---

## AgentEngine — the execution core

`AgentEngine` is the stateful agent runner. It owns the conversation loop, tool dispatch, multi-agent delegation, and iteration control.

### Constructor options

```typescript
new AgentEngine({
  // Required
  model:           { provider: 'openai', id: 'gpt-4o' },
  agents,
  tools,
  providers,
  defaultProvider: 'openai',
  defaultAgentId:  'general',

  // I/O
  transport:  new StdoutTransport(),
  sessionId:  'session-xyz',

  // Iteration control
  maxIterations: 50,
  iterationMode: 'auto',   // 'auto' | 'step-by-step' | 'interactive' (default)

  // Memory
  sessionMemory: mySessionMemory,
  memorySystem:  myMemorySystem,
  historyPath:   '/path/to/history.json',

  // MCP servers (connected lazily on first run)
  mcpServers: [
    { name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }
  ],

  // Observability
  observability: obsManager,
  audit:         new NdjsonAuditSink('/path/to/audit.ndjson'),   // one AuditEvent per tool call (see Observability → Audit)

  // Context injected into the system prompt
  projectContext: 'You are working in project X...',
})
```

### Running the engine

```typescript
// Basic run — returns when done
const result = await engine.run('Summarize the README.md file');
console.log(result.final); // final assistant response

// Run with a specific agent
const result = await engine.run('Review this code for security issues', {
  agentId: 'security-reviewer',
});

// Stream events to a UI
const events: AgentEvent[] = [];
await engine.run('Analyze the database schema', {
  onEvent: (event) => {
    if (event.type === 'chunk') process.stdout.write(event.content);
    events.push(event);
  },
});
```

### Iteration modes

| Mode | Behavior |
|------|----------|
| `'auto'` | Runs until complete or `maxIterations` reached |
| `'step-by-step'` | Calls `onStep` after every iteration; return `false` to stop |
| `'interactive'` | Calls `onIterationLimit` when cap is reached; return `true` to continue. Without that callback the run stops at the cap |

Tool approval is independent of the mode: whenever `onToolApproval` is set, the engine asks before `write_file`, `edit_file`, `run_command` and package installs. That is the legacy gate, and it is what coding agents should keep using for now. For approval decided by what tools declare (`readOnly`, `destructive`), by a policy, or by another agent or a service, see [Policy and approval](#policy-and-approval-per-call).

```typescript
// Approval — user approves destructive tool calls
const engine = new AgentEngine({
  ...opts,
  onToolApproval: async (toolName, agentId, argsPreview) => {
    console.log(`[${agentId}] → ${toolName}:`, argsPreview);
    const answer = await prompt('Approve? (y/n/all) ');
    if (answer === 'y')   return 'approve';
    if (answer === 'all') return 'approve_all';
    return 'reject';
  },
});
```

```typescript
// Step-by-step — inspect each iteration
const engine = new AgentEngine({
  ...opts,
  iterationMode: 'step-by-step',
  onStep: async (stats) => {
    console.log(`Iteration ${stats.count}/${stats.max} — agent: ${stats.agentId}`);
    return true; // false to stop
  },
});
```

### Multi-turn sessions

The engine retains conversation history between `run()` calls on the same instance:

```typescript
await engine.run('My name is Alice.');
await engine.run("What's my name?"); // → "Your name is Alice."
```

---

## createBaseEngine — high-level factory

`createBaseEngine` assembles all internals from a flat options object so you don't have to instantiate registries manually.

```typescript
import { createBaseEngine } from '@backendkit-labs/agent-core';

const engine = createBaseEngine({
  providers:       { openai: myOpenAIProvider },
  defaultProvider: 'openai',
  agents:          myAgentList,        // AgentProfile[]
  tools:           myToolList,         // ToolDefinition[]
  defaultAgent:    'general',
  transport:       new StdoutTransport(),
  maxIterations:   100,
  workingDir:      process.cwd(),
});

await engine.run('Hello!');
```

### With MCP servers and orchestration

```typescript
const engine = createBaseEngine({
  providers:       { anthropic: myAnthropicProvider },
  defaultProvider: 'anthropic',
  agents:          myAgents,
  tools:           myTools,
  defaultAgent:    'general',
  mcpServers: [
    {
      name:    'github',
      command: 'npx',
      args:    ['-y', '@modelcontextprotocol/server-github'],
      env:     { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
    },
    {
      name:    'postgres',
      command: 'npx',
      args:    ['-y', '@modelcontextprotocol/server-postgres', process.env.DATABASE_URL!],
    },
  ],
  orchestration: true,       // enables intent detection + domain routing + QA review
});
```

---

## Context compaction (token budget)

`maxContextMessages` caps the history by message count and discards what it cuts. With `context` the
history is kept under a **token** budget instead, and old turns are summarized rather than lost:

```typescript
const engine = createBaseEngine({
  // ...
  context: {
    maxTokens: 60_000,                                         // budget for the history (not the system prompt)
    summarizer: { provider: 'deepseek', model: 'deepseek-chat' }, // cheap model for summaries (default: the default provider)
    // strategy: 'summarize' | 'drop'   (default 'summarize'; a failing summarizer falls back to 'drop')
    // keepRecentTurns: 4               (last user turns are never touched)
    // toolResultMaxChars: 8000         (older tool results are cut head+tail)
    // threshold: 0.85                  (compact above 85% of maxTokens, down to 70%)
    // estimateTokens: (msg) => number  (default ~4 chars per token, calibrated with real provider usage)
  },
});
```

Before every LLM call the engine (1) truncates bulky old tool results, (2) folds the oldest turns into one
`<conversation_summary>` block merged into the first kept user turn, extending the previous summary instead
of nesting a new one, and (3) as a last resort drops them. Cuts always fall on a user-turn boundary, so
tool_call / tool result pairs are never orphaned. It emits `compacting` events and a `[Context]` system line;
summarizer usage is reported as `metrics` events like any other call, so `CostTracker` accounts for it.
Compaction is best-effort: any failure is reported and the run continues. Can be combined with `maxContextMessages`.

---

## Guardrails

Checks on what enters and leaves the agent loop, applied to the main agent **and every sub-agent**:

| Phase | Text inspected | When a guardrail blocks |
|---|---|---|
| `input` | the user message | the run ends with an `error` event; the model is never called |
| `tool_call` | the JSON arguments of a tool call (before approval) | the tool does not run; the model is told why and the arguments are scrubbed from the history |
| `tool_result` | what a tool returned (before the model reads it) | the result is replaced by a notice |
| `output` | the model's answer | the answer is replaced by a notice in the history |

```typescript
import { createBaseEngine, secretLeakGuardrail, piiGuardrail, promptInjectionGuardrail } from '@backendkit-labs/agent-core';

const engine = createBaseEngine({
  // ...
  guardrails: [secretLeakGuardrail(), piiGuardrail(), promptInjectionGuardrail()],
  guardrailOutputMode: 'after',   // or 'buffer'
});
```

Ready-made: `piiGuardrail` (email, phone [heuristic], card [Luhn], IBAN [mod 97], US SSN), `secretLeakGuardrail`
(literal `AgentProfile.secrets` of **every** agent plus common key formats; always blocks them in tool arguments),
`promptInjectionGuardrail` (heuristic: wraps suspicious tool results as `<untrusted_content>`; not a guarantee),
`maxLengthGuardrail`, `denyListGuardrail`, `llmJudgeGuardrail` (one extra LLM call per check).

Write your own: `{ name, phases, check(ctx) => { action: 'allow' } | { action: 'redact', content, reason } | { action: 'block', reason }, failMode?, dryRun? }`.
`redact` feeds the next guardrail; the first `block` wins. A guardrail that throws **blocks** (`failMode: 'closed'`, default)
unless you set `failMode: 'open'`. `dryRun: true` only reports, which is the way to tune false positives.

`guardrailOutputMode`: with `after` (default) tokens stream as they arrive; if an output guardrail changes the answer, the
stored history is corrected and a `guardrail` event carries the `replacement` for the UI. With `buffer` tokens are held
until the answer is checked: nothing unchecked is ever shown, but there is no streaming.

Every redaction, block and error emits a `{ type: 'guardrail', name, phase, action, reason, ... }` event, is written to the
legacy `auditLog` as `guardrail:<phase>:<name>`, and is counted in `MetricsSnapshot.guardrails`.

---

## Tool cancellation and time limits

Every tool call receives `ctx.signal`, an `AbortSignal` that fires when the engine is aborted (`engine.abort()`, or a budget stop with `abortOnBudget`) or when the call's time limit passes. Hand it to `fetch`, child processes and anything else cancellable:

```typescript
const fetchPage = defineTool({
  name: 'fetch_page',
  description: 'Fetch a URL',
  input: z.object({ url: z.string().url() }),
  timeoutMs: 15_000,                       // this tool's limit; overrides the engine default
  execute: async ({ url }, ctx) => (await fetch(url, { signal: ctx.signal })).text(),
});

const engine = createBaseEngine({
  // ...
  toolTimeoutMs: 60_000,                   // default limit for tools without their own (default: none)
  toolTimeoutGraceMs: 2000,                // wait for a tool to wind down after its signal fires
});
```

When a limit passes, the signal is aborted and, after the grace period, the model receives `Error: TOOL_TIMEOUT: tool "fetch_page" exceeded 15000ms` (`tool_result.outcome = 'timeout'`); a result that arrives later is discarded. After `engine.abort()` a running tool reports `Error: aborted` (`outcome = 'aborted'`). Time spent waiting for approval does not count. A tool with side effects that times out may still have completed, so make such tools idempotent.

---

## Providers

Providers wrap LLM APIs and implement the `LLMProvider` interface. `ProviderRegistry` holds named providers that the engine selects per-agent.

```typescript
import { ProviderRegistry } from '@backendkit-labs/agent-core';

const providers = new ProviderRegistry();

// Register multiple providers — engine selects per-agent or falls back to defaultProvider
providers.register('openai',    openAIProvider);
providers.register('anthropic', anthropicProvider);
providers.register('local',     ollamaProvider);
```

### Custom LLM provider

Implement `LLMProvider` to add any API:

```typescript
import type { LLMProvider, LLMMessage, LLMStreamCallbacks, ToolDefinition } from '@backendkit-labs/agent-core';

class MyProvider implements LLMProvider {
  async chat(
    messages:  LLMMessage[],
    tools:     ToolDefinition[],
    callbacks: LLMStreamCallbacks,
  ): Promise<void> {
    const stream = await myAPI.stream({ messages, tools });
    for await (const chunk of stream) {
      if (chunk.type === 'text')     callbacks.onChunk(chunk.text);
      if (chunk.type === 'tool_use') callbacks.onToolCall({ id: chunk.id, name: chunk.name, arguments: chunk.input });
    }
    callbacks.onDone();
  }
}

providers.register('my-api', new MyProvider());
```

---

## Transports

Transports receive `AgentEvent` objects and deliver them to consumers.

### StdoutTransport

Prints events as formatted text — good for CLI tools:

```typescript
import { StdoutTransport } from '@backendkit-labs/agent-core';
const engine = new AgentEngine({ ...opts, transport: new StdoutTransport() });
```

### CallbackTransport

Routes events to your own function — use this for server integrations or streaming UIs:

```typescript
import { CallbackTransport } from '@backendkit-labs/agent-core';

const transport = new CallbackTransport((event) => {
  switch (event.type) {
    case 'chunk':      process.stdout.write(event.content); break;
    case 'tool_call':  console.log(`[tool] ${event.name}`); break;
    case 'agent_switch': console.log(`→ ${event.to}`); break;
    case 'done':       console.log('\n[done]'); break;
  }
});
```

### AgentEvent types

| Type | Key fields | Description |
|------|-----------|-------------|
| `'chunk'` | `content: string` | Incremental LLM token |
| `'tool_call'` | `name, args, result` | Tool called and returned |
| `'agent_switch'` | `from, to` | Multi-agent delegation |
| `'iteration'` | `count, max` | Iteration counter |
| `'done'` | `final: string` | Run completed |
| `'error'` | `message: string` | Recoverable error |

---

## SessionMemory

`SessionMemory` stores conversation messages for the current session. `AgentEngine` manages it automatically; use it directly for custom initialization or testing.

```typescript
import { SessionMemory } from '@backendkit-labs/agent-core';

const memory = new SessionMemory();

// Seed with prior context
memory.addMessage({ role: 'user',      content: 'My name is Alice.' });
memory.addMessage({ role: 'assistant', content: 'Nice to meet you, Alice!' });

const engine = new AgentEngine({ ...opts, sessionMemory: memory });

await engine.run("What's my name?"); // → "Your name is Alice."
```

---

## MCP client

`MCPClientManager` connects to external MCP (Model Context Protocol) servers, discovers their tools, and makes them available to the engine. One `MCPServerConfig` per server decides the transport:

- `command` (+ `args`, `env`) — a local subprocess over stdio.
- `url` (+ `headers`) — a remote server over Streamable HTTP, falling back to SSE when the server answers 4xx; force one with `remoteTransport: 'streamable-http' | 'sse'`.
- When both are set, `url` wins.

### Standalone

```typescript
import { MCPClientManager } from '@backendkit-labs/agent-core';

const mcp = new MCPClientManager([
  { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'] },
  { name: 'remote', url: 'https://mcp.example.com/v1', headers: { Authorization: `Bearer ${process.env.MCP_TOKEN}` } },
]);

await mcp.initialize();                  // connects every configured server
const tools = mcp.getTools();            // ToolDefinition[], named mcp__{server}__{tool}
mcp.isConnected('remote');               // per-server status
await mcp.disconnect();
```

Other useful fields: `timeoutMs` (per tool call, default 30 s), `connectTimeoutMs`, `trustAnnotations` (believe the server's `readOnlyHint` and `_meta`; off by default), `mode: 'tools' | 'agent'` and `assignTo` (which agents get the tools).

### Multiple servers via engine options

Passing `mcpServers` to `createBaseEngine` or `AgentEngine` is the recommended path — the engine manages the lifecycle, retries, and disconnect detection:

```typescript
const engine = createBaseEngine({
  ...opts,
  mcpServers: [
    { name: 'github',   command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],   env: { GITHUB_TOKEN: '...' } },
    { name: 'slack',    command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'],     env: { SLACK_TOKEN: '...' } },
    { name: 'postgres', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'],  env: { DATABASE_URL: '...' } },
  ],
});
```

### Disconnect detection (health monitoring)

The client detects server crashes via `client.onclose` and marks them `'failed'`, preventing stale `'connected'` state:

```typescript
// The engine's MCPRegistrar wires this automatically.
// For manual use:
mcp.setDisconnectHandler((serverName) => {
  console.warn(`MCP server "${serverName}" disconnected`);
});
await mcp.reconnectFailed();   // retry the servers marked 'failed'
```

---

## MCP tool server (tools without a model)

`createToolServer` exposes `ToolDefinition`s as MCP tools that run **directly**: the arguments the client sends are the arguments `execute` receives, with no language model in between. Use it for anything a caller already knows how to ask for (a balance at a date, post this draft, run this check), where a model would only add latency, cost and the chance of a rewritten amount. For requests that need interpretation, `AgentMCPServer` in `@backendkit-labs/mcp-server` turns each call into a prompt for an engine. Both can coexist, and a prompt tool may itself call direct tools.

Each call gets: validation against the tool's schema before anything runs (the SDK answers invalid arguments with `isError` and a `-32602` message), an optional `authorize` gate, an `ExecutionContext` whose `signal` aborts on client cancellation or `timeoutMs`, an output cap, and an `audit` record. Tools from `defineTool` are registered with their own Zod schema, so what the client validates against is exactly what `execute` validates against; a hand-written `ToolDefinition` goes through `z.fromJSONSchema`, which fails loudly on constructs it cannot express.

```typescript
import { createToolServer, startToolServerHttp, runToolServer } from '@backendkit-labs/agent-core';
// also available from '@backendkit-labs/agent-core/mcp'

const options = {
  name:    'ledger',
  version: '1.0.0',
  tools:   [balancesTool, payTool],
  // Required because payTool is destructive: a direct tool skips the engine's allowedTools, gates and budget.
  authorize: async ({ tool, args, sessionId }) =>
    !tool.destructive || approvals.isValid(args.approvalId as string),
  audit: record => fs.appendFile('tool-calls.ndjson', JSON.stringify(record) + '\n'),
  context: { workingDir: process.cwd() },   // or a function that builds the whole context per call
  maxOutputChars: 1_048_576,                 // default
};

// 1. Any transport: one McpServer with the tools registered.
const server = createToolServer(options);
await server.connect(new StdioServerTransport());

// 2. Streamable HTTP, stateless: one server and transport per request, bearer required, loopback-only by default.
const running = await startToolServerHttp(options, { port: 3100, authToken: process.env.LEDGER_TOKEN });
// running.url → http://127.0.0.1:3100/mcp

// 3. The usual command line: stdio by default, `--http --port 3100 --host 0.0.0.0 --token <t>`, `--help`.
await runToolServer(options, { bin: 'ledger-mcp', tokenEnv: 'LEDGER_TOKEN' });
```

**Error contract.** `isError: true` means the call did not run to completion: denied by `authorize`, timed out, threw (message only, no stack), or returned more than `maxOutputChars`. Whatever the tool *returned* is payload, even a JSON `{ ok: false }` that encodes a business failure. The `audit` hook receives one record per call, including denied and failed ones, with a SHA-256 of the arguments rather than the arguments themselves; if the hook throws, the failure goes to stderr and the result does not change (the tool has already run).

**HTTP guards.** Without `authToken` the server refuses to listen anywhere but loopback. Bound to loopback, requests whose `Host` or `Origin` is not loopback get 403 (DNS rebinding, cross-site POST). Only `POST <path>` is served: a stateless server has no SSE stream to open and no session to delete. Bodies above `maxBodyBytes` (1 MiB) get 413.

---

## Workflow engine

Build declarative multi-agent workflows with `WorkflowBuilder`. Steps can run sequentially, in parallel, or conditionally.

### Sequential workflow

```typescript
import { workflow, agent } from '@backendkit-labs/agent-core';

const reviewPipeline = workflow('code-review')
  .step('fetch',   agent('general',           'List all TypeScript files in src/'))
  .step('analyze', agent('security-reviewer', 'Review the files for security issues'))
  .step('report',  agent('general',           'Summarize the findings into a report'));

const result = await engine.runWorkflow(reviewPipeline);
console.log(result.steps.report.output);
```

### Context passing between steps

Steps reference previous outputs with `{{stepName.output}}`:

```typescript
const dataPipeline = workflow('etl')
  .step('ingest',    agent('data-agent', 'Read /data/sales.csv'))
  .step('transform', agent('data-agent', 'Clean {{ingest.output}}: fix nulls, normalize dates'))
  .step('analyze',   agent('analyst',    'Find the top 5 trends in: {{transform.output}}'));
```

### Parallel steps

```typescript
const auditWorkflow = workflow('full-audit')
  .parallel([
    agent('frontend-agent',  'Audit React components for accessibility'),
    agent('backend-agent',   'Audit API endpoints for security'),
    agent('database-agent',  'Audit database schema for missing indexes'),
  ])
  .step('merge', agent('general', 'Synthesize all three audit reports'));
```

### Conditional steps

```typescript
const smartReview = workflow('smart-review')
  .step('classify', agent('general', 'Classify this PR: feature, bug fix, or refactor. Reply with just the type.'))
  .when('{{classify.output}} includes "bug"',
    agent('qa-engineer', 'Focus on regression risk and edge cases')
  )
  .otherwise(
    agent('general', 'Perform a standard code quality review')
  );
```

### WorkflowRunner (direct usage)

```typescript
import { WorkflowRunner } from '@backendkit-labs/agent-core';

const runner = new WorkflowRunner(engine);
const result = await runner.run(myWorkflow, {
  initialContext: { projectName: 'my-app', version: '2.0' },
  onStepStart:    (name) => console.log(`▶ ${name}`),
  onStepDone:     (name, out) => console.log(`✓ ${name}: ${out.slice(0, 80)}`),
});

// result.steps  — Map<stepName, { output, durationMs }>
// result.total  — total wall time in ms
// result.failed — boolean
```

---

## Advanced memory system

Beyond session history, agents can use a three-layer persistent memory. Each layer is independently configurable and backed by a pluggable store.

| Layer | Purpose | Use case |
|-------|---------|---------|
| `EpisodicMemory` | What happened — events and interactions | "Last week we refactored auth" |
| `SemanticMemory` | What is known — facts and domain knowledge | "Alice owns the auth module" |
| `ProceduralMemory` | How to do it — step-by-step patterns | "Deploy: build → push → apply" |

### Creating a full memory system

```typescript
import { createMemorySystem } from '@backendkit-labs/agent-core';

const memory = createMemorySystem({
  episodic: {
    provider: 'json',
    path:     '~/.bk-agent/projects/my-project/memory/episodes.json',
  },
  semantic: {
    provider: 'json',
    path:     '~/.bk-agent/projects/my-project/memory/knowledge.json',
  },
  procedural: {
    provider: 'json',
    path:     '~/.bk-agent/projects/my-project/memory/patterns.json',
  },
  retention: {
    maxEpisodes:   500,   // prunes by relevance score when exceeded
    summarizeAfter: 50,
    // Optional: compress old episodes with an LLM summary
    summarizeFn: async (episodes) => {
      const list = episodes.map((e, i) => `${i + 1}. ${e.content}`).join('\n');
      return await llm.summarize(list);
    },
  },
});

// Pass to engine
const engine = new AgentEngine({ ...opts, memorySystem: memory });
```

### Using each layer directly

```typescript
const { episodic, semantic, procedural } = memory;

// --- Episodic ---
await episodic.add({
  content:   'User asked to refactor the auth module',
  tags:      ['refactor', 'auth'],
  timestamp: Date.now(),
});

const recentAuth = await episodic.search('auth', { limit: 5 });
// [{ id, content, tags, timestamp }, ...]

// --- Semantic ---
await semantic.add({
  key:   'auth-module-owner',
  value: 'Alice (Backend Team)',
  tags:  ['ownership', 'auth'],
});

const owner = await semantic.get('auth-module-owner');
// 'Alice (Backend Team)'

const authKnowledge = await semantic.search('auth', { limit: 10 });

// --- Procedural ---
await procedural.add({
  name:  'deploy-to-staging',
  steps: ['npm run build', 'docker build .', 'kubectl apply -f k8s/staging/'],
  tags:  ['deployment'],
});

const deploySteps = await procedural.get('deploy-to-staging');
```

### Forgetting curve

When `maxEpisodes` is set and the limit is exceeded, `EpisodicMemory` prunes by **relevance score** rather than raw age:

```
relevanceScore = recency(0.6) × 1/(1 + daysSince × 0.1)
               + utility(0.4) × log(1 + recallCount)
```

Episodes that are recalled frequently survive longer than episodes that sit idle. `recall()` automatically increments `recallCount` on every matched record — no extra calls needed.

```typescript
// Episode recalled 4× over 30 days: score ~0.43
// Episode that sat idle for 30 days: score ~0.15
// → idle episode is pruned first when the store is full
```

The `recallCount` and `lastRecalledAt` fields are persisted in `JsonFileStore` and survive restarts.

### In-memory store (testing)

```typescript
import { InMemoryStore, EpisodicMemory } from '@backendkit-labs/agent-core';

const episodic = new EpisodicMemory(new InMemoryStore());
await episodic.add({ content: 'test event', tags: [], timestamp: Date.now() });
```

### JSON file store (production)

```typescript
import { JsonFileStore, SemanticMemory } from '@backendkit-labs/agent-core';

const semantic = new SemanticMemory(new JsonFileStore('/app/data/knowledge.json'));
```

### MemoryStoreBackend interface

All backends implement:

```typescript
interface MemoryStoreBackend {
  insert(record: StoredRecord): void;
  upsert(id: string, record: StoredRecord): void;
  getAll(): StoredRecord[];
  deleteOldest(keepNewest: number): void;
  deleteByIds(ids: string[]): void;   // used by relevance-based pruning
  count(): number;
}
```

`deleteByIds` is used internally by `EpisodicMemory` pruning. Use it in custom backends to support the forgetting curve.

### Memory tools (agents writing their own memory)

`buildMemoryTools()` creates tool definitions that let agents read and write all three memory layers:

```typescript
import { buildMemoryTools } from '@backendkit-labs/agent-core';

const memTools = buildMemoryTools(memory);
// Returns: remember_episode, recall_episodes, store_knowledge, recall_knowledge,
//          store_pattern, recall_pattern

memTools.forEach(t => tools.register(t));
```

---

## Observability

`ObservabilityManager` ties together cost tracking, metrics collection, and distributed tracing.

### Enable observability on the engine

```typescript
import { ObservabilityManager } from '@backendkit-labs/agent-core';

const obs = new ObservabilityManager({
  costTracking:   true,
  metricsEnabled: true,
  tracing:        true,
});

const engine = new AgentEngine({ ...opts, observability: obs });
```

### Cost tracking

```typescript
import { CostTracker, MODEL_PRICING } from '@backendkit-labs/agent-core';

const tracker = new CostTracker();

// MODEL_PRICING[model] = { input: $/1M tokens, output: $/1M tokens }
console.log(MODEL_PRICING['gpt-4o']);         // { input: 2.50, output: 10.00 }
console.log(MODEL_PRICING['claude-sonnet-4-6']); // { input: 3.00, output: 15.00 }

tracker.record({ model: 'gpt-4o', inputTokens: 1500, outputTokens: 200 });

console.log(`Cost: $${tracker.getTotalCostUSD().toFixed(6)}`); // $0.005750
```

### Metrics snapshot

```typescript
import { MetricsCollector } from '@backendkit-labs/agent-core';

const metrics = new MetricsCollector();

// After some runs:
const snap = metrics.getSnapshot();
// {
//   sessionsActive:  3,
//   runsTotal:       47,
//   runsSucceeded:   44,
//   runsFailed:       3,
//   avgDurationMs:  1823,
// }
```

### Custom span exporter

Export traces to Jaeger, Honeycomb, Datadog, or any OpenTelemetry backend:

```typescript
import { Tracer } from '@backendkit-labs/agent-core';

const tracer = new Tracer({
  onSpan: (span) => {
    honeycomb.sendEvent({
      'span.name':     span.name,
      'duration_ms':   span.durationMs,
      'agent.id':      span.agentId,
      'tool.calls':    span.toolCallCount,
    });
  },
});
```

### Audit (one event per tool call)

Give the engine one or more `AuditSink`s and it records **exactly one `AuditEvent` per tool call**, whether it ran or was refused (not found, not in `allowedTools`, blocked by a guardrail or the sandbox, rejected by the approver), plus one per `ask_agent` delegation. Arguments are recorded only as a SHA-256 of their canonical JSON, never in clear.

```typescript
import { createBaseEngine, HashChainAuditSink, NdjsonAuditSink, verifyAuditChain } from '@backendkit-labs/agent-core';

const engine = createBaseEngine({
  ...opts,
  identity: { tenantId: 'acme', userId: 'u-42', roles: ['treasury'] },   // part of every event's principal
  audit: [
    new NdjsonAuditSink('/var/log/agent/events.ndjson'),                 // plain, one JSON line per event
    new HashChainAuditSink('/var/log/agent/chain.log', { secret: process.env.AUDIT_KEY }), // tamper-evident
  ],
});

// Later, or on another host:
verifyAuditChain('/var/log/agent/chain.log', { secret: process.env.AUDIT_KEY });
// → { ok: true, entries, head } or { ok: false, brokenAt, reason }
```

An event carries `at`, `principal` (agent, session, delegation chain, tenant, user), `tool`, `argsHash`, `decision` (`allow`, `deny`, `ask`, `not_found`, `not_allowed`, `sandbox_denied`, `guardrail_blocked`), `outcome` when it ran (`ok`, `error`, `timeout`, `aborted`), `durationMs`, the sandbox decisions taken during the call and the tool's `meta`. Sinks receive events one at a time in call order; a failing sink is reported on the transport (`system` warning) and never changes the result. `HashChainAuditSink` links every entry to the previous one, so editing, removing or reordering entries is detected; with a `secret` a log rewritten by someone without it does not verify either. It refuses to extend a log that is already broken.

`auditLog: '/path.ndjson'` (the older option) still works unchanged but is deprecated: it writes up to 200 characters of the arguments in clear. It will be removed in 0.40.

### Policy and approval (per call)

A `ToolPolicy` decides every tool call and every `ask_agent` delegation: `allow`, `deny` or `ask`. It sees the principal (agent, delegation chain, tenant, user, roles) and the call (the tool with its declared facts, the arguments after guardrails). An `ask` goes to the `approver` (a person, another agent, a service), or is stored as pending in `approvals` when nobody answers now.

```typescript
import { createBaseEngine, type ToolPolicy, type Approver } from '@backendkit-labs/agent-core';

const treasuryRules: ToolPolicy = {
  decide(principal, call) {
    if (call.tool.name === 'pay_invoice' && (call.args.amount as number) > 10_000) {
      return { effect: 'ask', reason: 'payment above 10k', accepts: ['human'] };
    }
    if (!principal.roles?.includes('treasury') && !call.tool.readOnly) {
      return { effect: 'deny', reason: 'only treasury writes' };
    }
    return { effect: 'allow' };
  },
};

const engine = createBaseEngine({
  ...opts,
  identity: { tenantId: 'acme', userId: 'u-42', roles: ['treasury'] },
  policy: treasuryRules,           // several combine: deny > ask > allow; a throwing policy denies
  approver: myApprover,            // { ref, request(req) → { decision, by: { kind, id }, at } }
  audit: new HashChainAuditSink('audit.log'),
});
```

- **Without `policy`**, but with someone to ask, `defaultToolPolicy` applies. Tools declared `readOnly` run. Tools declared `destructive` always ask a person. Anything else asks.
- **Approvals are validated before they count:**
  - the approver's kind must be accepted;
  - nobody approves their own request or one from their delegation chain;
  - an agent approves only what it could do itself.

  Every approval is audited with who gave it.
- **`allow` can carry a mode.** `mode: 'dry_run'` runs the tool with `ctx.dryRun = true`. `mode: 'sandboxed'` requires a configured sandbox.
- **Opt-in.** Setting `policy`, `approver` or `approvals` switches to this path. Without them, `onToolApproval` behaves exactly as before. With them, `onToolApproval` is adapted as the approver: "approve all" never covers destructive tools or package installs.

### Durable approvals

If nobody can answer an `ask` right now, give the engine an `approvals` store. The call is stored as pending, the model is told it did not run, and whoever decides later runs it with `runApproved`.

```typescript
import { createBaseEngine, FileApprovalStore, agentApprover, consoleApprover } from '@backendkit-labs/agent-core';

const approvals = new FileApprovalStore('/var/lib/agent/approvals');
const engine = createBaseEngine({ ...opts, approvals });

await engine.run('pay the October invoices');          // asks become pending requests

// Later, maybe in another process (a UI, Hermes, a CLI):
const [req] = await approvals.list({ status: 'pending' });
await approvals.resolve(req.id, { decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() });
const result = await engine.runApproved(req.id);       // runs once; a second call throws

// Approvers that answer right away:
createBaseEngine({ ...opts, approver: consoleApprover() });                                    // a person at the terminal
createBaseEngine({ ...opts, approver: agentApprover((id, q) => engine.consultAgent(id, q), 'supervisor') }); // another agent
```

- **One decision and one execution per request.** `FileApprovalStore` allows exactly one decision and one execution per request, even across processes that share the directory.
- **Everything is checked again.** `runApproved` repeats every check. A stored approval only satisfies an `ask` whose `accepts` admits the approver: an approval from an agent never covers a destructive tool.
- **An invalid approval is spent.** If the approval turns out not to be valid, it is consumed and audited as `deny`.

### Lifecycle hooks

Hooks let a vertical plug into a turn without new engine options. Every hook of one turn shares a `RunContext`: the principal, the input, a `state` map and an abort `signal`.

```typescript
import { createBaseEngine, type EngineHooks } from '@backendkit-labs/agent-core';

const review: EngineHooks = {
  name: 'review',
  beforeRun: (ctx) => ctx.state.set('task', classify(ctx.input)),
  systemPrompt: (ctx, profile) => profile.id === 'general' ? `## Task\n${describe(ctx.state.get('task'))}` : undefined,
  afterTurn: (ctx, turn) => !ctx.state.get('reviewed') && turn.profile.id === 'general'
    ? { action: 'continue', agentId: 'reviewer', message: 'Review the answer above.' }   // another pass, as another agent
    : undefined,
  beforeTool: (ctx, call) => metrics.start(call.tool.name),
  afterTool: (ctx, call, result) => metrics.end(call.tool.name, result.success),
  afterRun: (ctx, result) => store.save(ctx.state.get('task'), result.text),
};

const engine = createBaseEngine({ ...opts, hooks: [review], maxHookContinues: 3 });
```

- **Order.** Hooks run in registration order.
- **`systemPrompt`** adds sections to the active agent and to delegates.
- **`afterTurn`** runs when the model answers without asking for tools. The first hook that asks to `continue` wins. The number of extra passes is capped by `maxHookContinues` (default 5) and by `maxIterations`.
- **`beforeTool` / `afterTool`** wrap only the calls the policy allowed.
- **Errors.** A hook that throws fails the turn, and the error names the hook and the point.

---

## Learning from experience

An agent learns from what happens to it. The same failure seen 3 times becomes a **lesson** in its prompt and a **proposed rule** that waits for a person: nothing it learns applies itself.

```typescript
import { createLearning } from '@backendkit-labs/agent-core';

const learning = createLearning();     // in memory; pass `store`, `approvals` and `rules` to keep them on disk
const engine = createBaseEngine({ ...opts, learning });

await learning.record({ agentId: 'ap', domain: 'qa', kind: 'wrong_total', situation: 'posting an invoice', action: 'post_invoice' });

for (const p of await learning.proposals()) console.log(p.id, p.reason);
await learning.approve(id, { kind: 'human', id: 'ana' });   // only a human by default (`approverKinds`)
await learning.retire(id);                                  // withdraw an approved rule
```

- **What the `learning` option wires.** Every failed, timed-out, denied or blocked tool call becomes an experience. The lessons of each agent, sanitized and capped, join its system prompt. The rules a person approved (`{ tool, effect: 'ask' | 'deny' }`) are enforced only when the engine is on the policy path (`policy`, `approver` or `approvals` is set): `learning` alone never changes how the engine asks for approval. `learning.sink`, `learning.hooks` and `learning.policy` remain available to wire by hand.
- **What makes a pattern.** The same failure (tool, kind and, when the tool's error has one, its code: `ECONNRESET` and `ERP_PERIOD_CLOSED` are different patterns) seen `threshold` times **inside the window** (`window: { days: 30 }`). Correct calls are counted, not stored, so a tool with many calls also needs the failures to be a share of them (`rate`, default 5% from 20 calls): 3 failures in 1000 calls are noise, 3 in 5 are not. `rate: false` counts failures only. `learning.flush()` writes the counters now; they are also written after each turn.
- **Teach it something specific.** A lesson a person writes does not wait for three failures: `await learning.teach({ text: 'Totals are rounded to 2 decimals.', tools: ['post_invoice'] }, { kind: 'human', id: 'ana' })`. It joins the prompt as `Taught lessons`, before the learned ones, sanitized and capped, inside its tenant. `agentId` limits it to one agent, `tools` to agents that have one of those tools in the turn, and it is at most 500 characters. `learning.taught()` lists them and `learning.forget(id)` withdraws one. For knowledge that never changes, `AGENT.md` or `instructionSources` do the same without learning.
- **A rule by hand.** `learning.addRule({ rule: { tool: 'post_invoice', effect: 'deny' }, reason: 'ERP freeze' }, by)` validates the rule, attributes it to a person and stores it next to the ones that came from proposals.
- **Only a person.** Teaching and adding a rule need the same author as approving one (`approverKinds`, default a human): an agent cannot teach itself.
- **Tenants never share what they learn.** Experiences take the tenant of the engine's `identity`. Patterns, lessons, proposals and approved rules stay inside it; no tenant is its own separate space.
- **The text of a lesson is stable.** It carries no counts or dates, so more failures of the same pattern do not change the system prompt and prompt caching keeps working.
- **Domain and kind are free text.** A vertical records its own experiences with `record`, and decides the rule a pattern proposes with `ruleFor`. By default a tool that keeps failing proposes `{ tool, effect: 'ask' }`.
- **`thresholdFor`** sets how many repetitions make a pattern per experience, e.g. a critical failure needs one.
- **`FileRuleStore`**, `MemoryApprovalStore` and `FileApprovalStore` keep the rules and proposals; `agent-coding` and `agent-enterprise` build on this module.
- `ReflectionEngine`, `DomainRegistry` and `ProceduralMemory` are deprecated.

---

## Sources of agents, skills and instructions

The engine reads no file by itself. Where its agents, skills and instruction layers come from is declared with sources, and an engine built without them touches no disk:

```typescript
const engine = createBaseEngine({
  ...opts,
  agentSources: [{ list: async () => myAgents() }],        // AgentSource: merged with `agents`, a later source wins by id
  skillSources: [{ list: async () => mySkills() }],        // SkillSource: merged with `skills` and `loadSkills`
  instructionSources: [{ load: async ({ cwd }) => [        // InstructionSource: layers for the system prompt
    { title: 'House rules', content: await readRules(cwd) },
  ] }],
});
```

Instruction layers are sanitized (`sanitizeDiskContent`) and added after the other sections of the system prompt, through a `systemPrompt` hook. A source that throws fails the turn.

The file-based adapters of a terminal app (`AGENT.md`, `USER.md`, `~/.appName/agents`, skills from GitHub or skills.sh, the built-in slash commands, workspaces, checkpoints and trust) live in `@backendkit-labs/agent-coding/cli`: `fileAgentSource`, `fileInstructionSource`, `SkillLoader`, `registerBuiltinCommands`...

---

## Skills and slash commands

Skills are reusable prompt snippets that augment agent behavior. Slash commands let users invoke agent features directly. The registries (`SkillRegistry`, `SkillActivator`, `SlashCommandRegistry`) are in core; loading, installing and the built-in commands are in `@backendkit-labs/agent-coding/cli`.

### Loading built-in skills

```typescript
import { SkillLoader, createSkillManager } from '@backendkit-labs/agent-coding/cli';

const manager = createSkillManager('my-app');

// Install a skill pack from GitHub
await manager.install({
  source: 'github:backendkit-labs/skills#main',
  pack:   'backend',
});

const installed = manager.listInstalled();
// [{ id, name, pack, version }, ...]
```

### Inline skill definition

```typescript
import { SkillRegistry, SkillActivator } from '@backendkit-labs/agent-core';

const registry = new SkillRegistry();

registry.register({
  id:          'pr-review',
  name:        'PR Review',
  description: 'Perform a thorough pull request review',
  prompt:      `
    Review this pull request with the following criteria:
    1. Correctness — does the code do what the PR description claims?
    2. Security — any new attack surface?
    3. Performance — any obvious regressions?
    4. Tests — are changes covered?
    Output a concise review with LGTM or CHANGES REQUESTED at the end.
  `,
  tags: ['github', 'review'],
});

const activator = new SkillActivator(registry);
const systemContext = activator.buildContext(['pr-review']);
// Returns the skill prompt injected into the system context
```

### Slash commands

Built-in commands: `/help`, `/clear`, `/status`, `/skills`, `/agents`, `/workspace`, `/checkpoint`.

```typescript
import { SlashCommandRegistry } from '@backendkit-labs/agent-core';
import { registerBuiltinCommands } from '@backendkit-labs/agent-coding/cli';

const cmds = new SlashCommandRegistry();
registerBuiltinCommands(cmds);

// Custom command
cmds.register({
  name:        'deploy',
  description: 'Trigger a deployment to an environment',
  handler:     async (ctx) => {
    const env = ctx.args[0] ?? 'staging';
    await ci.triggerDeploy(env);
    return `Deployment to ${env} triggered. Watch: https://ci.company.com/jobs/latest`;
  },
});

// Handle user input
const input = '/deploy production';
if (input.startsWith('/')) {
  const response = await cmds.handle(input, agentContext);
  console.log(response);
}
```

---

## Checkpoints

Save and restore session state for recovery and branching.

### Save a checkpoint

```typescript
import { createCheckpoint, listCheckpoints, readCheckpoint } from '@backendkit-labs/agent-coding/cli';

// After a successful milestone
await createCheckpoint({
  sessionId:   'session-abc',
  messages:    engine.getMessages(),
  projectDir:  '/app/.bk-agent/projects/my-project',
  description: 'After auth module refactor — all tests pass',
});
```

### List and restore

```typescript
// List all checkpoints
const summaries = await listCheckpoints('/app/.bk-agent/projects/my-project');
// [{ id, timestamp, description, messageCount }, ...]

// Restore a specific checkpoint
const checkpoint = await readCheckpoint(summaries[0].id, '/app/.bk-agent/projects/my-project');

const restoredMemory = new SessionMemory();
restoredMemory.loadMessages(checkpoint.messages);

const engine = new AgentEngine({ ...opts, sessionMemory: restoredMemory });
await engine.run('Continue from where we left off');
```

### Compact a long session

```typescript
import { compactSession } from '@backendkit-labs/agent-coding/cli';

// Compress a 200-message conversation to a short summary
const compacted = await compactSession(
  engine.getMessages(),
  async (messages) => await llm.summarize(messages),
);

// Replace memory with compacted version to reduce context size
engine.replaceMessages(compacted);
```

---

## Workspaces

Manage multiple projects and let agents switch context between them.

```typescript
import {
  loadWorkspaces, createWorkspace, addProject,
  setActiveProject, buildWorkspaceContext,
} from '@backendkit-labs/agent-coding/cli';

// One-time setup
const config = await loadWorkspaces('my-app');
await createWorkspace('my-app', 'work');

await addProject('my-app', 'work', {
  name: 'api-server',
  path: '/home/user/projects/api-server',
});

await addProject('my-app', 'work', {
  name: 'frontend',
  path: '/home/user/projects/frontend',
});

// Switch active project
await setActiveProject('my-app', 'work', 'frontend');

// Build context string injected into the engine's system prompt
const ctx = buildWorkspaceContext(await loadWorkspaces('my-app'));
// "Active project: frontend (/home/user/projects/frontend)\nWorkspace: work\n..."
```

---

## Autonomous agents and triggers

Create fire-and-forget agents that run on schedules or in response to events.

### Scheduled agent (cron)

```typescript
import { createAutonomousAgent } from '@backendkit-labs/agent-core';

const standupAgent = createAutonomousAgent({
  engine:      myEngine,
  schedule:    '0 9 * * 1-5',  // cron: weekdays at 9 AM
  buildPrompt: () => 'Generate a daily standup summary from recent git commits and open PRs.',
  onResult:    (output) => slack.postMessage('#standup', output),
  onError:     (err) => logger.error('[standup-agent]', err),
});

await standupAgent.start();
// Stops the cron job
await standupAgent.stop();
```

### Event-driven agent

```typescript
import { EventBus } from '@backendkit-labs/agent-core';

const eventBus = new EventBus();

// Subscribe to an event
eventBus.on('deployment.failed', async (payload) => {
  const analysis = await engine.run(
    `Investigate this deployment failure:\n${JSON.stringify(payload, null, 2)}`
  );
  await pagerduty.alert({ summary: analysis.final });
});

// Publish from your CI/CD system
await eventBus.emit('deployment.failed', {
  service:  'payment-api',
  version:  '2.1.4',
  errorLog: lastError,
});
```

### TriggerManager (low-level)

```typescript
import { TriggerManager } from '@backendkit-labs/agent-core';

const triggers = new TriggerManager();

// Cron trigger
triggers.addSchedule({
  id:       'daily-report',
  schedule: '0 8 * * *',
  handler:  async () => engine.run('Generate daily report'),
});

// Webhook trigger
triggers.addWebhook({
  id:      'github-pr',
  path:    '/webhooks/github',
  handler: async (body) => engine.run(`Review PR: ${body.pull_request.title}`),
});

await triggers.start();
```

---

## Delegation bus

`DelegationBus` enables multi-agent collaboration — orchestrators delegate sub-tasks to specialized agents and collect results.

```typescript
import { DelegationBus } from '@backendkit-labs/agent-core';

const bus = new DelegationBus();

// Register specialized agents
bus.register('security-agent', async (req) => ({
  output:  (await securityEngine.run(req.prompt)).final,
  agentId: 'security-agent',
}));

bus.register('data-agent', async (req) => ({
  output:  (await dataEngine.run(req.prompt)).final,
  agentId: 'data-agent',
}));

// Delegate from orchestrator
const secResult = await bus.delegate({
  targetAgentId: 'security-agent',
  prompt:        'Audit this SQL query for injection risks: SELECT * FROM users WHERE id=' + input,
  context:       currentMessages,
});

console.log(secResult.output);
```

---

## Type reference

Key types exported from `@backendkit-labs/agent-core`:

```typescript
// Engine
AgentEngineOptions        // Full constructor options
BaseEngineOptions         // Options for createBaseEngine

// Agents
AgentProfile              // { id, name, systemPrompt, tools, provider? }

// Tools
ToolDefinition            // { name, description, inputSchema, execute }
TypedToolOptions          // Options for defineTool
ExecutionContext           // Runtime context passed to tool.execute

// LLM
LLMProvider               // Interface for LLM adapters
LLMMessage                // { role, content }
LLMToolCall               // { id, name, arguments }
LLMStreamCallbacks        // { onChunk, onToolCall, onDone, onError }
ModelConfig               // { provider, id }

// Memory
SessionMemoryData         // Serialized session memory
MemorySystemConfig        // createMemorySystem options
MemoryStoreBackend        // 'json' | 'memory'
Episode                   // Episodic memory entry
Knowledge                 // Semantic memory entry
Pattern                   // Procedural memory entry

// MCP
MCPServerConfig           // { name, command, args, env?, baseUrl?, url? }

// Workflows
WorkflowDef               // Compiled workflow definition
WorkflowResult            // { steps, total, failed }
WorkflowRunOptions        // WorkflowRunner.run() options

// Iteration
IterationMode             // 'auto' | 'step-by-step' | 'interactive'
IterationStats            // { count, max, agentId }
ToolApprovalDecision      // 'approve' | 'approve_all' | 'reject'

// Observability
ObservabilityConfig       // { costTracking, metricsEnabled, tracing }
MetricsSnapshot           // Current counters snapshot
Span                      // Tracing span
SpanExporter              // Interface for custom exporters

// Events
AgentEvent                // Union of all transport event types
```
