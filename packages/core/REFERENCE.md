# @backendkit-labs/agent-core — reference

The detailed reference of [@backendkit-labs/agent-core](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/core/README.md): every topic beyond the quick start. Start with the README if you are new.

## Contents

- [defineTool — typed tools with Zod](#definetool--typed-tools-with-zod)
- [AgentEngine — the execution core](#agentengine--the-execution-core)
- [createBaseEngine — high-level factory](#createbaseengine--high-level-factory)
- [Context compaction (token budget)](#context-compaction-token-budget)
- [Guardrails](#guardrails)
- [Tool cancellation and time limits](#tool-cancellation-and-time-limits)
- [Providers](#providers)
- [Transports](#transports)
- [SessionMemory](#sessionmemory)
- [MCP client](#mcp-client)
- [MCP tool server (tools without a model)](#mcp-tool-server-tools-without-a-model)
- [Workflow engine](#workflow-engine)
- [Flows — declarative and durable](#flows--declarative-and-durable)
- [Advanced memory system](#advanced-memory-system)
- [Observability](#observability)
- [Identity: who the agent is, and external identity services](#identity-who-the-agent-is-and-external-identity-services)
- [Learning from experience](#learning-from-experience)
- [What `engine.run` returns](#what-enginerun-returns)
- [Sources of agents, skills and instructions](#sources-of-agents-skills-and-instructions)
- [Skills and slash commands](#skills-and-slash-commands)
- [Checkpoints](#checkpoints)
- [Workspaces](#workspaces)
- [Autonomous agents and triggers](#autonomous-agents-and-triggers)
- [Delegation bus](#delegation-bus)
- [Type reference](#type-reference)

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
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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
import { createBaseEngine, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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
import { createBaseEngine, secretLeakGuardrail, piiGuardrail, promptInjectionGuardrail, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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
import { StdoutTransport, selfAssertedIdentities } from '@backendkit-labs/agent-core';
const engine = new AgentEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, ...opts, transport: new StdoutTransport() });
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
import { SessionMemory, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const memory = new SessionMemory();

// Seed with prior context
memory.addMessage({ role: 'user',      content: 'My name is Alice.' });
memory.addMessage({ role: 'assistant', content: 'Nice to meet you, Alice!' });

const engine = new AgentEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, ...opts, sessionMemory: memory });

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
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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
import { createToolServer, startToolServerHttp, runToolServer, selfAssertedIdentities } from '@backendkit-labs/agent-core';
// also available from '@backendkit-labs/agent-core/mcp'

const options = {
  name:    'ledger',
  version: '1.0.0',
  tools:   [balancesTool, payTool],
  // Who executes the calls, and for whom: required, like in the engine (see "Identity" below).
  agentIdentity: selfAssertedIdentities(),
  identity: { userId: 'svc-ledger' },
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

**Identity.** A direct tool is another way to run a tool, so it needs the same two things as the engine: the server has a digital identity (`agentIdentity`, a provider of identities, here named after the server) and says for whom it acts (`identity.userId`). Without them **every call is denied**, before `authorize` or the policy are even asked, and the reason says how to fix it. Every audit event is attributed to that identity and signed by it when the provider can sign; `requireAgentIdentity: false` is for tests only. A provider that fails or does not answer in time denies the call.

**Error contract.** `isError: true` means the call did not run to completion: denied by `authorize`, timed out, threw, or returned more than `maxOutputChars`. Whatever the tool *returned* is payload, even a JSON `{ ok: false }` that encodes a business failure. A tool that throws a `ToolError(code, message)` tells the client why: its message goes through, and the audit event records its `code`. Any other thrown error is internal (an exception message can carry paths, queries or credentials): the client gets `internal error (<errorId>)`, the error itself goes to `onInternalError(err, { errorId, server, tool, where, requestId })` (default: stderr) under that id, and the audit records only its code. The same holds for an `authorize` hook or an approver that throws.

**Who calls.** A fixed `identity` serves every caller as the same person: with one shared bearer token, the server cannot tell callers apart. Over Streamable HTTP each call carries its request `headers` (and `authInfo`, when an auth layer in front set it) in `ToolCallInfo`, so `identity` can be a function of the call and `authorize` can decide per caller:

```ts
startToolServerHttp({
  name: 'ledger', tools, agentIdentity: selfAssertedIdentities(),
  // for whom this call runs: from a token you verify, never from a header the caller sets by itself
  identity: (call) => verifyUserToken(call.headers?.['x-user-token']),   // → { userId } or undefined (denied)
}, { authToken: process.env.BK_MCP_TOKEN });
```

The policies, the audit events and four-eyes approval then see the real caller. A function that throws denies the call (`internal error (<errorId>)`, the detail to `onInternalError`). The headers include the server's own bearer: never log them. The `audit` hook receives one record per call, including denied and failed ones, with a SHA-256 of the arguments rather than the arguments themselves; if the hook throws, the failure goes to stderr and the result does not change (the tool has already run).

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

## Flows — declarative and durable

A business flow is data: a YAML file with steps, dependencies, approvals and compensations. `runFlow` executes it; **how** a step runs is the `StepExecutor` you pass (one agent, a remote worker, a queue). Adding a flow for a company means writing YAML, not platform code. A runnable example lives in [`examples/flows`](../../examples/flows).

```yaml
flow: close-month
trigger: { type: manual }
steps:
  - id: collect-sales          # no `after`: runs in parallel with collect-costs
    agent: sales
    prompt: "Collect the sales of {{payload.month}}"
  - id: collect-costs
    agent: finance
    prompt: "Collect the costs of {{payload.month}}"
    timeoutMs: 60000
  - id: report
    agent: analyst
    prompt: "Write the month report"
    after: [collect-sales, collect-costs]
    gate: { approval: human }  # stops until a person decides
  - id: publish
    agent: comms
    prompt: "Send the report to the board"
    after: [report]
    when: { step: report, contains: "APPROVED" }   # runs only if the report says so; otherwise skipped
compensation:
  - on: report.failed
    agent: comms
    prompt: "Tell the board the report is delayed"
```

```typescript
import { loadFlow, runFlow, NdjsonRunJournal, MemoryApprovalStore } from '@backendkit-labs/agent-core';

const flow = await loadFlow('flows/close-month.yaml');      // parseFlow(yaml), loadFlowsFromDir(dir), validateFlow(def)
const result = await runFlow(flow, {
  executor: { run: async (step, input) => ({ content: await myAgent(step.agent).run(input.prompt) }) },
  payload: { month: '2026-10' },                              // {{payload.x}} in prompts
  journal: new NdjsonRunJournal('.flows'),                    // durable: survives the process (one file per run)
  approvals: { store: new MemoryApprovalStore() },            // gate.approval: human (or a policy `ask`)
  runId: 'close-2026-10',
  maxConcurrency: 8,                                          // per wave; `limiter` caps per agent/tenant across flows
});
result.status;  // 'completed' | 'failed' | 'rejected' | 'cancelled' | 'awaiting_approval'
result.costUsd; // sum of the costUsd the steps reported (absent if none did)
```

- **Conditional steps (0.44.0):** `when: { step, contains | equals | matches, not? }` runs a step only if the output of a step it waits for says so (`step` must be in `after`; `equals` ignores surrounding whitespace). A step whose condition does not hold, or cannot be evaluated because that step produced no output, is `skipped` before anything else: it does not run, **no approval is asked**, what waits for it is skipped too, and the flow does **not** fail. The skip is in `transitions` with the reason (`condition not met: report contains "APPROVED"`).
- **Tool steps (SPEC-0046):** a step is a prompt for an agent, or, with `kind: tool`, a call to a tool of that agent: `{ id, agent, kind: tool, prompt, tool: { name, args } }`. The `prompt` stays required and only describes the step. The executor receives the call in `input.tool`, with `{{payload.x}}` already resolved in `args` (a value that is exactly one reference keeps its type: `"{{payload.amount}}"` is the number, not a text), and it validates the arguments against the schema of the tool: core knows no tool. A `tool` step answers `{ content, data }`: `data` is the structured result and, if `content` is empty, `content` is `JSON.stringify(data)`. The steps that wait for it get that data in `input.outputs[stepId]` (also after a resume: only the text is in the journal, and a `tool` step's data is read back from it). Everything is optional and a flow without `kind` runs exactly as before. Core does not evaluate expressions over the data: that is the executor's; `when` still looks at the text. **Approval of a tool step:** the request carries the call (`subject.tool`, through `redact`) and its digest, and a resume with another payload that changes the call fails without running it; the policy of `flow.step:<id>` receives the arguments of the call; and with `approvals.when: 'after'` the step fails without running (it is approved before it runs). A mandate bound to an agent identity does not apply to a flow step (the principal of a step has none).
- **Waves and failure:** steps whose `after` are done run together. A failed step skips what depends on it (`onStepFailure: 'continue'` runs them without its output), then the `compensation` entries run. `timeoutMs` per step, `stepTimeoutMs` as a default.
- **Durable and resumable:** with a `journal` each step is written before and after it runs, one process holds the run (`claim`), and calling `runFlow` again with the same `runId` **resumes**: `done` steps are not run again. The claim is **renewed while the run lives** (every `claimRenewMs`, a third of `claimTtlMs` by default), so a run longer than the TTL is not taken over by another process; it expires only when this process stops. If a renewal finds the claim taken, the run stops and `runFlow` throws `FlowClaimError` without writing over the new owner (`claimRenewMs: 0` turns renewal off). A step the journal shows as `running` (the process died) runs again by default — at least once; `input.idempotencyKey` (`runId:stepId:attempt`) lets a step with an external effect be safe. `MemoryRunJournal`, `NdjsonRunJournal` (one `<runId>.ndjson` per run on one host, see below), and `RedisRunJournal` (in [`agent-flow-queue`](../flow-queue)) share one contract. The payload is not stored: pass it again when resuming.
- **`NdjsonRunJournal` (0.45.0, [SPEC-0024](../../docs/specs/SPEC-0024-journal-de-corridas-ndjson.md)):** the journal for runs that live on one host. One line per event, **chained** (each line carries a MAC of the one before, HMAC with `key` if you give one: a line removed, changed or added makes the run `JournalCorrupt` and the other runs are still served; `problems` says which), `fsync` after every event, and a write cut in the middle is ignored and cut off. It has **one writer per run**: if someone else writes to the file, this writer gets `JournalConflict`, and `runFlow` stops without writing more and throws `FlowClaimError`. The claim is a lock file with the pid of the process: a holder that **died** is relieved at once (no TTL to wait for, so no renewal either), one that is alive is respected however long it takes. Files are created readable by their owner only, and still hold step outputs as they are. (`FileRunJournal`, which wrote a file per event, was removed in 0.47.0: it was about 3x slower to write and ~58x slower to read.) It needs the processes to share a host: for several machines use `RedisRunJournal`. Limit: removing the *last* lines of a file leaves a valid chain.
- **Writing your own journal:** implement `RunJournal` and run the shared battery from `@backendkit-labs/agent-core/testing`: `journalConformance('MyJournal', { make: () => new MyJournal(connection) })` registers its cases with the global `describe` and `it`; `journalConformanceCases(options)` returns `{ name, run }` pairs for another runner. Options declare what your journal does differently: `expiresByTtl`, `exclusiveWriter`, `rejectsUnsafeIds`. The memory, file, ndjson and Redis journals pass it.
- **Approval:** `gate.approval: human` or a `policy` that answers `ask` for `flow.step:<id>` stops the run as `awaiting_approval`; decide it and run again with the same `runId`. `when: 'after'` runs the step first and shows its output to the approver.
- **Plan with a model:** `planFlow(task, { agents, provider })` turns a task into a validated `FlowDefinition` (unknown agents, cycles and duplicate ids are rejected and the model is asked again); steps no agent covers come back in `unresolved`. A plan a model writes and a YAML file are the same object. `flowFromTaskPlan` and `flowFromStaticFlow` convert older shapes.
- **Serve and steer it:** `flowFromDefinition(def, opts)` + `createFlowHandler({ name: flow })` give the `flowHandler` an `AgentServer` takes (start, status, pause, resume, cancel). `createApprovalHandler(store)` gives the `approvalHandler` (list, get, decide). `createFlowTools({ flows, approvals, approver })` exposes both as tools for a model or an MCP server; `flow_cancel` and `approval_decide` are `destructive`, so the tool server needs an `authorize` or a `policy`, and a model-driven server should use `approver: { kind: 'service', id }` (it cannot satisfy an approval that needs a human).
- **Across processes:** [`@backendkit-labs/agent-flow-queue`](../flow-queue) provides a BullMQ `StepExecutor` (each step runs on a worker) and a Redis journal.

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
import { createMemorySystem, selfAssertedIdentities } from '@backendkit-labs/agent-core';

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
const engine = new AgentEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, ...opts, memorySystem: memory });
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
import { ObservabilityManager, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const obs = new ObservabilityManager({
  costTracking:   true,
  metricsEnabled: true,
  tracing:        true,
});

const engine = new AgentEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, ...opts, observability: obs });
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
import { createBaseEngine, HashChainAuditSink, NdjsonAuditSink, verifyAuditChain, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
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

An event carries `at`, `principal` (agent, session, delegation chain, tenant, user), `tool`, `argsHash`, `decision` (`allow`, `deny`, `ask`, `not_found`, `not_allowed`, `sandbox_denied`, `guardrail_blocked`), `outcome` when it ran (`ok`, `error`, `timeout`, `aborted`), `durationMs`, why a person was asked (`reason`), who approved (`approval`: the approver, the role that qualified them in `authority`, and the reason they gave), the mandate that covered the call (`mandate`) or the one it went beyond (`exceeded`, which with `approval` says who took the responsibility of going past the limit), the sandbox decisions taken during the call and the tool's `meta`. Sinks receive events one at a time in call order; a failing sink is reported on the transport (`system` warning) and never changes the result. `HashChainAuditSink` links every entry to the previous one, so editing, removing or reordering entries is detected; with a `secret` a log rewritten by someone without it does not verify either. It refuses to extend a log that is already broken.

`auditLog: '/path.ndjson'` (the older option) still works unchanged but is deprecated: it writes up to 200 characters of the arguments in clear. It will be removed in 0.40.

### Policy and approval (per call)

A `ToolPolicy` decides every tool call and every `ask_agent` delegation: `allow`, `deny` or `ask`. It sees the principal (agent, delegation chain, tenant, user, roles) and the call (the tool with its declared facts, the arguments after guardrails). An `ask` goes to the `approver` (a person, another agent, a service), or is stored as pending in `approvals` when nobody answers now.

```typescript
import { createBaseEngine, type ToolPolicy, type Approver, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const treasuryRules: ToolPolicy = {
  decide(principal, call) {
    if (call.tool.name === 'pay_invoice' && (call.args.amount as number) > 10_000) {
      return { effect: 'ask', reason: 'payment above 10k', accepts: ['human'], approverRoles: ['finance'] };
    }
    if (!principal.roles?.includes('treasury') && !call.tool.readOnly) {
      return { effect: 'deny', reason: 'only treasury writes' };
    }
    return { effect: 'allow' };
  },
};

const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  ...opts,
  identity: { tenantId: 'acme', userId: 'u-42', roles: ['treasury'] },
  policy: treasuryRules,           // several combine: deny > ask > allow; a throwing policy denies
  approver: myApprover,            // { ref, request(req) → { decision, by: { kind, id }, at } }
  approverDirectory: myDirectory,  // who an approver is and what roles they hold: YOUR user system, { describe(by) → { roles, tenantId? } | undefined }
  forbidSelfApproval: true,        // u-42, the person the agent acts for, does not approve what it asked either
  audit: new HashChainAuditSink('audit.log'),
});
```

- **Without `policy`**, but with someone to ask, `defaultToolPolicy` applies. Tools declared `readOnly` run. Tools declared `destructive` always ask a person. Anything else asks.
- **Approvals are validated before they count**, in this order:
  - the approver's kind must be accepted (`accepts`);
  - nobody approves their own request or one from their delegation chain;
  - with `forbidSelfApproval: true`, the person the agent acts for (`identity.userId`) does not approve it either. It needs `identity.userId` to know who asked: with none, the rule does nothing and a flow, a handler or a tool server refuse to run with it;
  - when the `ask` carries `approverRoles`, the approver holds at least one of them. The roles come from your `approverDirectory`, never from what the caller says. Fail closed: no directory, an id it does not know, a directory that throws, an approver of another tenant or no role in common refuse the approval and the call does not run;
  - an agent approves only what it could do itself.

  The framework does not authenticate anyone: `by.id` has to come from something your application verified.
- **One check for every way of approving.** The same function enforces all of the above for an approver in process, a stored approval run later (`runApproved`), the `approvals` of a flow, `createApprovalHandler` and the direct tool server: a way that skipped it would be the way around it. Every approval is audited with who gave it, the role that qualified them (`approval.authority`) and the reason they gave (`approval.reason`), next to why they were asked (`reason`).
- **`allow` can carry a mode.** `mode: 'dry_run'` runs the tool with `ctx.dryRun = true`. `mode: 'sandboxed'` requires a configured sandbox.
- **Opt-in.** Setting `policy`, `approver` or `approvals` switches to this path. Without them, `onToolApproval` behaves exactly as before. With them, `onToolApproval` is adapted as the approver: "approve all" never covers destructive tools or package installs.

### Durable approvals

If nobody can answer an `ask` right now, give the engine an `approvals` store. The call is stored as pending, the model is told it did not run, and whoever decides later runs it with `runApproved`.

```typescript
import { createBaseEngine, FileApprovalStore, agentApprover, consoleApprover, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const approvals = new FileApprovalStore('/var/lib/agent/approvals');
const engine = createBaseEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, ...opts, approvals });

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
- **Approvals can expire.** `approvalTtlSeconds` (or `ttlSeconds` in the `ask`) says how long a stored request lives; by default it does not expire, so a Monday approval still authorizes the payment on Friday. `approverTimeoutMs` bounds an approver that should answer right away (past it the call is denied); for people who may take hours, use the store.
- **`list` is oldest first.** `FileApprovalStore.list` orders by `createdAt` and breaks a tie of the same millisecond by `id`, so the first pending request is always the oldest and the order is the same on every host.

### Lifecycle hooks

Hooks let a vertical plug into a turn without new engine options. Every hook of one turn shares a `RunContext`: the principal, the input, a `state` map and an abort `signal`.

```typescript
import { createBaseEngine, type EngineHooks, selfAssertedIdentities } from '@backendkit-labs/agent-core';

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

const engine = createBaseEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, ...opts, hooks: [review], maxHookContinues: 3 });
```

- **Order.** Hooks run in registration order.
- **`systemPrompt`** adds sections to the active agent and to delegates.
- **`afterTurn`** runs when the model answers without asking for tools. The first hook that asks to `continue` wins. The number of extra passes is capped by `maxHookContinues` (default 5) and by `maxIterations`.
- **`beforeTool` / `afterTool`** wrap only the calls the policy allowed.
- **Errors.** A hook that throws fails the turn, and the error names the hook and the point.

---

## Identity: who the agent is, and external identity services

Since 0.49 an agent that acts carries two things, and the engine refuses every tool call without them: a **digital identity** (who the agent is) and **on whose behalf it acts** (`identity.userId`). The denial says how to fix it.

```ts
import { createBaseEngine, selfAssertedIdentities } from '@backendkit-labs/agent-core';

createBaseEngine({
  /* ... */
  agentIdentity: selfAssertedIdentities(),   // who the agent is
  identity: { userId: 'u-42' },              // on whose behalf it acts
});
```

With **no identity service at all**, `selfAssertedIdentities()` (or `staticAgentIdentities({...})`, or `ed25519AgentIdentities({...})` if you want signed events) satisfies the requirement. The identity is marked `assurance: 'self-asserted'` in every audit event, so a reader can tell it from one that someone vouched for. Whoever starts the agent hears it too: the first call with a self-asserted identity writes one warning, once per engine or server (a `system` event of level `warn` on the engine's transport, a line on stderr for a tool server or a capability server), and it stays silent under `NODE_ENV=test`. In tests, `testIdentity()` from `@backendkit-labs/agent-testkit`, or `requireAgentIdentity: false` (not for regulated environments).

### Plugging in an external identity service (an eIDAS 2-compatible service, a corporate IAM, a wallet...)

`agent-core` is tied to **no** identity provider, credential format or legal framework. A service of that kind reaches the engine through two contracts, and nothing else in your agent changes when you swap one for another:

| What the service gives you | Contract in `agent-core` | What `core` does with it |
|---|---|---|
| **Who the agent is**, and its key | `AgentIdentityProvider`: `resolve(agentId, context)` and, optionally, `sign(agentId, message)` | Attributes every audit event to that identity, passes it to the policies (`principal.agentIdentity`), and signs each event with it. A provider that fails or is slow **denies the call**: it never means "no identity needed". |
| **For whom it works, what it may do, up to how much** (a power-of-representation credential) | `MandateVerifier`: turns the service's credential into a `Mandate`, or refuses | `mandatePolicy` decides with the facts of the call: inside the mandate the agent acts alone, outside it asks; with none, the tools it applies to do nothing (`appliesTo` limits it to what is critical; `limits.measures` and `measureOf` cap quantities that are not money). |

```ts
import { createBaseEngine, mandatePolicy, type AgentIdentityProvider } from '@backendkit-labs/agent-core';

// 1. WHO the agent is: an adapter of the service. (idp stands for the SDK or API of YOUR service.)
const identities: AgentIdentityProvider = {
  async resolve(agentId) {
    const agent = await idp.agentOf(agentId);
    return agent && { id: agent.did, kid: agent.keyId, issuer: idp.url, assurance: agent.assurance };
  },
  async sign(agentId, message) {                      // the key may sit in the service's custody
    const s = await idp.sign(agentId, message);
    return { kid: s.keyId, signature: s.signature, format: s.format };
  },
};

// 2. FOR WHOM and up to how much: another adapter, from its credential to a Mandate.
const verifier = myServiceMandateVerifier({ trustedIssuers: { [idp.url]: idp.publicKey }, credentialFor: (req) => wallet.credentialOf(req.principal.agentId) });

createBaseEngine({
  /* ... */
  agentIdentity: identities,
  identity: { userId: 'u-42' },                       // the application's own id for the person
  policy: mandatePolicy({ verifier, amountOf: (args) => ({ value: Number(args.amount), currency: String(args.currency) }) }),
});
```

- **Writing the adapter.** [`@backendkit-labs/agent-mandates`](https://www.npmjs.com/package/@backendkit-labs/agent-mandates) has the pieces so you do not start from zero: the SD-JWT container (RFC 9901), and the rules every adapter applies the same way (well-formed powers, the person's consent, assurance level, and **refusing a restriction it cannot enforce**, because ignoring it would grant more than the issuer meant). A provider whose credential has another format (a W3C VC as a JWT, ISO mdoc, a table of your own) is a different adapter to the **same** `Mandate`.
- **What `core` does not know.** Which issuers to trust, how your application's user ids map to the service's person ids, which proof formats you accept: all of that is operator wiring in the adapter, never a decision of the agent.
- **The proof of a signed event is opaque.** `core` checks Ed25519 itself; any other format (a JWS, a qualified electronic seal, a timestamp) is checked by the verifier **you** register in `verifyAuditChain(path, { agentSignatures: { formats } })`, and a format with no verifier does not pass as verified. What legal value a signature has is for the provider and the operator.
- **Reference adapters.** `examples/mandate-agent` builds, with the real engine and tests, an adapter for an eIDAS 2-compatible credential (an SD-JWT VC), another for a W3C VC-JWT and a conformance suite that runs the same scenarios against both. **The payload is an assumption**: its real format is not public, so there is no adapter for a specific service yet.
- **Capability servers.** An `AgentServer` of `@backendkit-labs/agent-protocol` runs capabilities and flows for remote callers and runs nothing without a `gate`: `capabilityIdentityGate({ name, agentIdentity, identity })` builds it with the same rule and default as the engine and leaves a signed, attributed audit event per run. The protocol authenticates a caller with one shared key, so who a run is **for** comes from you (a fixed identity or a function of something you verified), never from a header the caller sets. A web session's engine acts for the person the server authenticated: `agent-web` hands the factory the user (`caller.userId`).
- **A mandate is the power of one agent.** A credential that names an agent identity is a power of **that** agent: presented by another, or by an agent with no identity, `core` denies the call (it does not ask: nobody could approve it into existence). A credential tied to the agent's key is proven at each call with the agent's own signature: pass `agentIdentity` to `mandatePolicy` so the verifier can ask for the proof (`request.prove`). A bearer credential is accepted unless `requireHolderBinding: true`, and the audit says `holderBinding: none` so it does not look like a possession was shown (SPEC-0044 F3).
- **Which calls need a mandate, and what counts.** `appliesTo(tool)` limits the mandate to what is critical (money, deleting data, publishing, granting access); the other tools go to `otherwise` (default `defaultToolPolicy`: a read-only tool runs, a destructive one asks a person), so forgetting to include a critical tool is annoying, never permissive. A credential of profile 2 can cap quantities that are not money with `limits.measures`, and `measureOf: { rows: (args) => ({ value: args.ids.length }) }` says how to measure each one; a cap with no measure covers nothing (SPEC-0045).
- **A call the mandate does not cover** asks a person (`outOfScope: 'ask'`, the default) or is denied (`'deny'`). `outOfScopeApprover: { approverRoles, accepts, ttlSeconds }` says who may decide it, so an order above the limit is not approved by an intern; the roles are checked against the engine's `approverDirectory`. The audit records the mandate that was exceeded (`exceeded`) next to the `approval` of the person who took the responsibility.
- **What it does not do yet.** The identity of a direct tool server (`createToolServer`) is that of the server, one per server, not one per MCP client.

---

## Learning from experience

An agent learns from what happens to it. The same failure seen 3 times becomes a **lesson** in its prompt and a **proposed rule** that waits for a person: nothing it learns applies itself.

```typescript
import { createLearning, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const learning = createLearning();     // in memory; pass `store`, `approvals` and `rules` to keep them on disk
const engine = createBaseEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, ...opts, learning });

await learning.record({ agentId: 'ap', domain: 'qa', kind: 'wrong_total', situation: 'posting an invoice', action: 'post_invoice' });

for (const p of await learning.proposals()) console.log(p.id, p.reason);
await learning.approve(id, { kind: 'human', id: 'ana' });   // only a human by default (`approverKinds`)
await learning.retire(id);                                  // withdraw an approved rule
```

- **What the `learning` option wires.** Every failed, timed-out, denied or blocked tool call becomes an experience. The lessons of each agent, sanitized and capped, join its system prompt. The rules a person approved (`{ tool, effect: 'ask' | 'deny' }`) are enforced only when the engine is on the policy path (`policy`, `approver` or `approvals` is set): `learning` alone never changes how the engine asks for approval. `learning.sink`, `learning.hooks` and `learning.policy` remain available to wire by hand.
- **What makes a pattern.** The same failure (tool, kind and, when the tool's error has one, its code: `ECONNRESET` and `ERP_PERIOD_CLOSED` are different patterns) seen `threshold` times **inside the window** (`window: { days: 30 }`). Correct calls are counted, not stored, so a tool with many calls also needs the failures to be a share of them (`rate`, default 5% from 20 calls): 3 failures in 1000 calls are noise, 3 in 5 are not. The share is that of the **subject**: to judge a context on its own, put it in the subject (`breakout/trend_flat` and `breakout/trend_up` are judged separately; `breakout` judges both together). The share decides when a pattern **enters**; once in, it stays, so a lesson that works (and fills its subject with correct calls) does not remove itself. `rate: false` counts failures only. `learning.flush()` writes the counters now; they are also written after each turn.
- **How long a lesson lives.** Each pattern has a record (`learning.records()`): its state, its line and its dates. A learned lesson **stays while its subject is still being called**: when the agent obeys it, the failures leave the window, and a lesson that left with them would let the mistake come back. It leaves when the subject has had no calls and no failures for `quietAfterDays` (default: the window), or when a person resolves it: `learning.resolve(patternKey, by, { tenantId?, reason? })`, only for who `approverKinds` allows. A resolved pattern that fails again afterwards is active again and its record says it came back (`reappeared`). A pattern without a subject (a signal of a vertical, with no calls to count) leaves with its window. The line of a lesson is written once, in its record: a later failure, a hint registered afterwards or a restart do not rewrite it, so the system prompt stays the same; a hint its author improves later reaches the patterns that appear after that. The trade-off: a tool that failed three times because of an outage keeps its lesson while it is called, until someone resolves it. The proposal of a rule shows its evidence: `3 x tool_error on place_order (3 of 10 calls, 30%), first to last`.
- **Lessons come in units.** The lessons of an agent are grouped by tool (`### post_invoice`), with `general` first; inside a unit, what a person taught goes before what was learned, and `lessons.maxPerUnit` caps the learned ones. `lessons.maxPerUnit` and `lessons.maxLessons` keep the learned lessons that happen most. The text is cut by dropping whole entries from the end, learned ones first and what a person taught only when nothing learned is left, so the same lessons always give the same system prompt.
- **The advice comes from whoever knows the domain.** A tool declares what to do about each error code: `defineTool({ ..., errorHints: { ERP_PERIOD_CLOSED: 'The period is closed: post it in the next open one.', '*': 'Check the invoice first.' } })`. When that error repeats, the lesson says it. It is only about the errors the tool raises: for the failures the engine sees by itself (a denial, a timeout, a result that was too large) it says one fixed sentence (`ENGINE_HINTS`). Nothing generic is invented for the rest: the lesson states the fact.
- **A unit a person can write and review in git.** `await learning.exportUnit('post_invoice')` gives markdown with a front matter, the `## Taught` lessons (the part an import reads) and the `## Learned` ones (generated: ignored on import). `await learning.importUnit(md, by)` teaches the taught ones; the file is imported whole or not at all, importing it twice changes nothing (a lesson that did not change keeps its place and its first author), and `{ replace: true }` forgets the ones that left the file. **The front matter decides which tenant gets the lessons**: a product with tenants passes `{ tenantId }` to say it itself. `learning.units()` lists the units.
- **Everything in a directory.** `createLearning({ dir })` keeps the experiences, counters, proposals, rules and taught lessons under one directory (`experiences.json`, `counters.json`, `proposals/`, `rules.json`, `lessons.json`); a store you pass replaces its file. Without `dir` nothing touches the disk.
- **Report what happened in one line.** `await learning.trackOutcome({ agentId, domain, subject, ok, context?, kind?, detail? })` counts a success against its subject or records a failure. A success without a subject is refused: it would never be counted.
- **Circumstances in the pattern.** `context` ('trend_flat', 'before_close') makes the same subject be judged apart: the share of failures is measured against the calls *in that context*. Without a context nothing changes.
- **Simulated time.** `createLearning({ now, stamp: 'clock' })` makes the experiences from the audit sink, `record` and the counters use the clock `now`, so a simulation or a backtest runs in simulated time with the window, the counters and the experiences in agreement. The default is the time of the event, as always.
- **Tools enforce the rules a person approved** without owning a store: `const guards = await learnedRules(ctx, isMyGuard)`. `createBaseEngine({ learning })` gives the tools a read-only view of the rules of the engine's tenant under `LEARNED_RULES_SERVICE`, never the `Learning` object (it could approve).
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

## What `engine.run` returns

```typescript
const r = await engine.run('Session 7');
r.text;          // what the agent said after its last tool call
r.toolCalls;     // [{ name, agentId, success, errorCode?, outcome?, preview? }], delegates included
r.errors;        // the messages of the error events of the turn
r.aborted;       // the turn was aborted (engine.abort(), a budget)
r.budgetExceeded;
r.systemPrompts; // the prompt of each model call: only with `emitSystemPrompt: true` (a system prompt can carry secrets)
engine.budgetExceeded; // sticky: the cost budget was reached at some point
```

Every tool that fails with a `ToolError(code, message)` (or `ToolArgumentError`) shows its `code` in `toolCalls`, in the audit event and in the `tool_result` event (`error_code`).

---

## Sources of agents, skills and instructions

The engine reads no file by itself. Where its agents, skills and instruction layers come from is declared with sources, and an engine built without them touches no disk:

```typescript
const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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

const engine = new AgentEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, ...opts, sessionMemory: restoredMemory });
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

Inside the engine, the default agent delegates with `ask_agent`, and `AgentProfile.delegatesTo` is a limit: with a list, a delegation to an agent outside it is refused and audited as `not_allowed`, and the roster in the prompt shows only those agents. `['*']` means every agent. No list, or an empty one, lets the default agent delegate to every other agent. An agent an MCP server registered (`mode: 'agent'`) is always reachable. Only the default agent is offered `ask_agent`.

A tool delegates with `ctx.askAgent(agentId, question, context?)`. It goes through the same check as `ask_agent` (self-delegation, `delegatesTo`, identity and policies), it is audited as an `ask_agent` event, and a refusal throws, so the tool's call fails with the reason.

The engine builds its own bus; you use `DelegationBus` directly only to run agents outside an `AgentEngine`. It does not decide who may delegate: that is the engine's check above. It runs each request through `runAgent`, with a bulkhead per nesting depth (`maxParallel` at a time, default 6), refuses requests deeper than `maxDepth` (default 5) and never throws: a failure comes back as `error` on the result.

```typescript
import { AgentRegistry, DelegationBus, StdoutTransport } from '@backendkit-labs/agent-core';

const agents = new AgentRegistry();
agents.upsert(securityProfile);   // a request for an agent that is not registered fails with error 'agent_not_found'

const bus = new DelegationBus({
  agents,
  transport: new StdoutTransport(),
  maxParallel: 4,
  // How a delegate runs: here, a separate engine per agent.
  runAgent: async (agentId, question, context) => {
    const started = Date.now();
    const result = await engines[agentId].run(context ? `${question}\n\nContext:\n${context}` : question);
    return { agentId, content: result.text, inputTokens: 0, outputTokens: 0, elapsedMs: Date.now() - started };
  },
});

const one = await bus.runSingle({ agentId: 'security-agent', question: 'Audit this SQL query for injection risks', fromAgentId: 'orchestrator' });
if (one.error) console.error(one.error); else console.log(one.content);

// Several at once; each delegate's events are flushed together when it finishes, so their output never interleaves.
const many = await bus.runParallel([
  { agentId: 'security-agent', question: 'Audit the query' },
  { agentId: 'data-agent', question: 'Estimate the row count' },
]);
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
