# @backendkit-labs/agent-enterprise — reference

The detailed reference of [@backendkit-labs/agent-enterprise](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/README.md): every topic beyond the quick start. Start with the README if you are new.

## Contents

- [createEnterpriseSetup](#createenterprisesetup)
- [Enterprise agent profiles](#enterprise-agent-profiles)
- [RAG pipeline](#rag-pipeline)
- [ObsidianRAGProvider](#obsidianragprovider)
- [VaultWriter](#vaultwriter)
- [Embedders](#embedders)
- [Events and reconciliation](#events-and-reconciliation)
- [The n8n trigger tool](#the-n8n-trigger-tool)
- [Full production example with AgentServer](#full-production-example-with-agentserver)

---

## createEnterpriseSetup

The main factory. Returns `{ indexAll, engineFactory }`.

### Options

```typescript
interface EnterpriseSetupOptions {
  // Required
  vaultPath:       string;           // absolute path to the Obsidian vault
  providers:       ProviderRegistry;
  defaultProvider: string;           // provider ID used when no per-agent override is set

  // Optional
  indexDir?:       string;           // where to store index files
                                     // default: ~/.bk-agent/rag/enterprise/
  embedder?:       Embedder;         // custom embedder, default: SimpleEmbedder
  sessionsDir?:    string;           // per-session memory dir
                                     // default: ~/.bk-agent/sessions/
  extraProfiles?:  AgentProfile[];   // add custom agent profiles alongside the 6 defaults
  maxIterations?:  number;           // per-engine run limit, default: 20
}
```

### Return value

```typescript
interface EnterpriseSetup {
  // Call once at startup (or periodically to pick up new vault notes)
  indexAll(opts?: { verbose?: boolean }): Promise<void>;

  // Compatible with AgentServer's engineFactory option
  engineFactory: (sessionId: string, transport: Transport) => AgentEngine;
}
```

### What gets created per session

Each call to `engineFactory` assembles a fresh, isolated `AgentEngine` with:

- One `ObsidianRAGProvider` per department scoped to that department's vault folders
- One global `ObsidianRAGProvider` for the General agent (all vault folders)
- A shared `VaultWriter` for persisting knowledge back to the vault
- All six enterprise `AgentProfile`s plus any `extraProfiles`
- Per-session episodic, semantic, and procedural `MemorySystem` stored in `sessionsDir/<sessionId>/`

---

## Enterprise agent profiles

Six department profiles are built in. Each has a system prompt, a scoped RAG tool, and an optional provider override for on-prem data isolation.

| Profile ID | Agent Name | RAG tool | Default provider |
|-----------|-----------|----------|-----------------|
| `general` | General | `search_knowledge` (whole vault) | `defaultProvider` |
| `support` | Support Agent | `search_support_kb` | `defaultProvider` |
| `hr` | HR Agent | `search_hr_kb` | `local` (sensitive) |
| `sales` | Sales Agent | `search_sales_kb` | `defaultProvider` |
| `finance` | Finance Agent | `search_finance_kb` | `local` (sensitive) |
| `ops` | Ops Agent | `search_ops_kb` | `defaultProvider` |

HR and Finance default to the `local` provider so sensitive payroll and financial data never leaves your network.

### Using profiles individually

```typescript
import {
  GENERAL_PROFILE,
  SUPPORT_PROFILE,
  HR_PROFILE,
  SALES_PROFILE,
  FINANCE_PROFILE,
  OPS_PROFILE,
  ALL_ENTERPRISE_PROFILES,
  ENTERPRISE_TOOLS,
  VAULT_FOLDERS,
} from '@backendkit-labs/agent-enterprise';

// Register only the profiles you need
const agents = new AgentRegistry();
agents.register(GENERAL_PROFILE);
agents.register(SUPPORT_PROFILE);
agents.register({ ...HR_PROFILE, provider: 'ollama' });      // force on-prem
agents.register({ ...FINANCE_PROFILE, provider: 'ollama' }); // force on-prem

// Tool name constants
ENTERPRISE_TOOLS.SEARCH_GENERAL;  // 'search_knowledge'
ENTERPRISE_TOOLS.SEARCH_SUPPORT;  // 'search_support_kb'
ENTERPRISE_TOOLS.SEARCH_HR;       // 'search_hr_kb'
ENTERPRISE_TOOLS.SEARCH_SALES;    // 'search_sales_kb'
ENTERPRISE_TOOLS.SEARCH_FINANCE;  // 'search_finance_kb'
ENTERPRISE_TOOLS.SEARCH_OPS;      // 'search_ops_kb'
ENTERPRISE_TOOLS.WRITE_KNOWLEDGE; // 'write_knowledge' (VaultWriter)
ENTERPRISE_TOOLS.ASK_AGENT;       // 'ask_agent'

// Vault folder name constants
VAULT_FOLDERS.GENERAL;     // 'general'
VAULT_FOLDERS.SUPPORT;     // 'soporte'
VAULT_FOLDERS.HR;          // 'rrhh'
VAULT_FOLDERS.SALES;       // 'ventas'
VAULT_FOLDERS.FINANCE;     // 'finanzas'
VAULT_FOLDERS.OPS;         // 'operaciones'
VAULT_FOLDERS.AGENTS;      // 'agentes'    (where VaultWriter writes)
VAULT_FOLDERS.POLICIES;    // 'politicas'  (indexed by every department)
```

### Adding custom profiles

```typescript
const enterprise = createEnterpriseSetup({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  ...opts,
  extraProfiles: [
    {
      id:           'legal',
      name:         'Legal Advisor',
      icon:         '⚖️',
      description:  'Answers from the legal knowledge base',
      systemPrompt: `You are a legal knowledge assistant.
        Search the knowledge base for relevant precedents and policies.
        Always recommend consulting a licensed attorney for case-specific advice.`,
      allowedTools: ['search_knowledge'],
      provider:     'local',  // sensitive — stays on-prem
    },
    {
      id:           'engineering',
      name:         'Engineering Assistant',
      icon:         '🛠️',
      description:  'Internal technical documentation',
      systemPrompt: 'You are a software engineering assistant with access to our internal technical documentation.',
      allowedTools: ['search_knowledge', 'write_knowledge'],
    },
  ],
});
```

---

## RAG pipeline

The RAG pipeline works in two phases: **indexing** and **search**.

### Indexing phase

At startup, `indexAll()` walks each vault folder, chunks the markdown files, embeds each chunk with the configured embedder, and saves the index to disk as JSON.

```typescript
// Full or incremental re-index (skips unchanged files)
await enterprise.indexAll({ verbose: true });
// [VaultIndexer] Indexed 142 files, 1,847 chunks in 4.2s (38 skipped, unchanged)
```

### Search phase

When an agent's RAG tool is called, it performs cosine-similarity search over the pre-built index and injects the top-K chunks as context into the LLM prompt:

```
User: "What is our parental leave policy?"
  → HR agent selected
  → search_hr_kb("parental leave policy")
  → Top 5 chunks from rrhh/, general/ and politicas/ returned
  → LLM answers using the retrieved excerpts as grounding context
```

---

## ObsidianRAGProvider

Indexes an Obsidian vault into a vector store and answers searches. It is what `createEnterpriseSetup` uses for every department; use it directly for a custom setup.

```typescript
import { ObsidianRAGProvider, OllamaEmbedder } from '@backendkit-labs/agent-enterprise';

const rag = new ObsidianRAGProvider({
  vaultPath: '/shared/obsidian-vault',
  folders:   ['Support', 'General'],          // only these folders (omit for the whole vault)
  indexPath: '/cache/support-index.json',     // default: ~/.bk-agent/rag/<vault-name>.json
  embedder:  new OllamaEmbedder({ model: 'nomic-embed-text' }),
  topK:      5,                               // default 5
  minScore:  0.3,                             // default 0.3
  excludeTags: ['skill'],                     // notes with these frontmatter tags are skipped
});

const { indexed, removed } = await rag.index({ verbose: true, onProgress: p => console.log(p.processed, '/', p.total) });

const text = await rag.search('How do I reset my password?');   // the best passages, formatted as text for a prompt
const tool = rag.createTool();                                  // the `search_knowledge` ToolDefinition
```

`index()` is incremental: it compares modification times and only embeds new or changed notes, and removes the chunks of deleted ones. Run it on start and whenever the vault changes (a cron job, a file watcher). For large vaults, `batchPacingMs`, `stageSize`, `stagePacingMs` and `checkpointIntervalMs` pace the embedding calls and save progress.

### VaultIndexer and VectorStore

The two pieces under `ObsidianRAGProvider`, for when you bring your own pipeline:

- `new VaultIndexer({ vaultPath, folders?, excludeTags?, excludeFiles? })` finds what changed (`getChangedFiles(knownMtimes)`) and splits notes into chunks (`buildChunks(filePath, mtime)`, `toVectorChunk(raw, embedding)`).
- `new VectorStore(storePath, embeddingModel)` keeps the embedded chunks on disk: `load()`, `addChunks(chunks)`, `removeFile(filePath)`, `search(queryEmbedding, topK)` and `save()`.

---

## VaultWriter

`VaultWriter` lets agents write knowledge back to the vault, closing the loop: the next incremental `index()` makes the note searchable. Notes go to one sub-folder (default `agentes`), with YAML frontmatter, and concurrent writes to the same note are serialised.

```typescript
import { VaultWriter } from '@backendkit-labs/agent-enterprise';

const writer = new VaultWriter({ vaultPath: '/shared/obsidian-vault', agentFolder: 'agentes' });

// From your own code
const path = await writer.writeNote({
  title:   'API auth pattern',
  content: '# API auth pattern\n\nAll endpoints require a Bearer token...',
  agentId: 'general',
  tags:    ['api', 'security'],
  related_notes: ['General/api-overview'],
});

// As a tool for an agent (the agent id is baked in, so the note records who wrote it)
const writeTool = writer.createTool('general');
```

---

## Embedders

Embedders convert text into vectors for similarity search.

### SimpleEmbedder (default, no external dependencies)

A deterministic, hash-based embedder. It needs no API key or service. Less accurate than neural models, but always available:

```typescript
import { SimpleEmbedder } from '@backendkit-labs/agent-enterprise';

const embedder = new SimpleEmbedder();   // prototyping, CI, air-gapped systems, fallback
```

### OllamaEmbedder (recommended for production)

Uses a local Ollama embedding model:

```bash
ollama pull nomic-embed-text    # general purpose, fast
ollama pull mxbai-embed-large   # higher accuracy
```

```typescript
import { OllamaEmbedder, createEnterpriseSetup } from '@backendkit-labs/agent-enterprise';
import { selfAssertedIdentities } from '@backendkit-labs/agent-core';

const enterprise = createEnterpriseSetup({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  vaultPath: '/vault',
  providers,
  defaultProvider: 'local',
  embedder: new OllamaEmbedder({ host: 'http://localhost:11434', model: 'nomic-embed-text' }),
});
```

### Custom embedder

```typescript
import type { Embedder } from '@backendkit-labs/agent-enterprise';

class OpenAIEmbedder implements Embedder {
  async embed(texts: string[]): Promise<number[][]> {
    const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: texts });
    return res.data.map(d => d.embedding);
  }
  async embedOne(text: string): Promise<number[]> {
    return (await this.embed([text]))[0];
  }
}
```

---

## Events and reconciliation

When one agent must tell another system that something happened ("invoice approved"), `EventPublisher` sends a **typed event** through a queue (BullMQ, or anything shaped like `QueueLike`) and leaves a note about it in the vault, in one call. `ReconciliationSweeper` then finds the events that nobody acted on.

```ts
import { z } from '@backendkit-labs/agent-core';
import { EventPublisher, ReconciliationSweeper, type EventSchema } from '@backendkit-labs/agent-enterprise';
import { Queue } from 'bullmq';

// A named, versioned event. The schema validates every payload before it is sent.
const InvoiceApproved: EventSchema<{ invoiceId: string; total: number }> = {
  type: 'invoice.approved',
  version: 1,
  schema: z.object({ invoiceId: z.string(), total: z.number() }),
};

const publisher = new EventPublisher({
  queue: new Queue('eventos.invoice.approved', { connection }),
  vaultPath: '/srv/vault',
  source: 'finance-agent',                 // who publishes: goes in the envelope and the note
});

const event = await publisher.publish(InvoiceApproved, { invoiceId: 'F-1', total: 100 });
// event: { id, type, occurredAt, source, version, payload }
await publisher.publish(InvoiceApproved, payload, { attempts: 5, jobId: 'F-1-approved' });
```

`publish` does four things:

1. Validates the payload with the schema. A wrong payload throws a `ZodError` and **nothing is sent**.
2. Wraps it in an envelope with a UUID, the time, the source and the schema version.
3. Adds the job to the queue: 3 attempts with exponential backoff (`attempts`, `backoffDelay`), and the finished jobs are kept (`removeOnComplete: false`) so they can be reconciled. The job id is the envelope id; pass `jobId` to make a publish **idempotent** (the same id is not queued twice).
4. Writes a note to `eventos/` in the vault: auditable, and searchable by the RAG like any other note. Its table has the `ID` of the event.

Order matters: the job is queued **before** the note is written. If the process dies between the two, the event is queued but has no note; if the queue is down, `publish` throws and nothing is written.

### Finding events nobody handled

A consumer that handles an event writes an audit note under `auditoria/` that mentions the event id. The sweeper compares the two folders:

```ts
const sweeper = new ReconciliationSweeper({ vaultPath: '/srv/vault' });   // eventsFolder / auditFolder to rename them
const report = await sweeper.sweep();
// { checked: 2, matched: 1, orphaned: [{ eventId, type, occurredAt, source, notePath }], sweptAt }

for (const event of report.orphaned) await republishOrAlert(event);
```

An event is **orphaned** when its id appears nowhere in the `auditoria/` tree. Run `sweep()` on a schedule (hourly, daily) and decide what an orphan means for you: republish it, or alert someone. It detects a gap; it does not repair it, and it uses the vault as the source of truth instead of an outbox transaction. An event that was handled but whose consumer did not write an audit note also shows as orphaned, so make writing the audit note part of the consumer.

---

## The n8n trigger tool

`createN8nTriggerTool({ webhookUrl })` gives an agent a tool, `n8n_trigger`, that starts an [n8n](https://n8n.io) workflow by POSTing `{ event, correlationId, ...payload }` to a webhook. The model passes the `event` name and a `payload`; a `correlation_id` is generated when it does not give one, and the tool returns it so the run can be traced in n8n. A non-2xx answer is an error the model sees.

```ts
import { createN8nTriggerTool } from '@backendkit-labs/agent-enterprise';

const n8n = createN8nTriggerTool({ webhookUrl: process.env.N8N_WEBHOOK_URL });   // or just set N8N_WEBHOOK_URL
// add n8n to the tools of the engine and 'n8n_trigger' to the allowedTools of the agent
```

It throws at construction if there is no URL. The tool starts something outside the framework: put it behind a governance policy or an approval (see the Governance page of the documentation) if the workflow has effects (sends mail, moves money).

---

## Full production example with AgentServer

An on-prem deployment: Ollama embeddings, DeepSeek for general agents, a local model for HR and Finance, Redis sessions, JWT auth and a weekly digest:

```typescript
import { createEnterpriseSetup, OllamaEmbedder } from '@backendkit-labs/agent-enterprise';
import { ProviderRegistry, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { DeepSeekProvider, OllamaProvider } from '@backendkit-labs/agent-providers';
import { AgentServer, JwtAuth, TriggerBus, RedisSessionMetaStore } from '@backendkit-labs/agent-web';
import Redis from 'ioredis';

const providers = new ProviderRegistry();
providers.register('deepseek', new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY!, model: 'deepseek-chat' }));
providers.register('local', new OllamaProvider({ host: 'http://ollama.internal:11434', model: 'llama3.2' }));   // sensitive data stays on-prem

const enterprise = createEnterpriseSetup({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  vaultPath:       process.env.VAULT_PATH!,
  providers,
  defaultProvider: 'deepseek',
  embedder:        new OllamaEmbedder({ host: 'http://ollama.internal:11434', model: 'nomic-embed-text' }),
  indexDir:        '/var/bk-agent/rag-indexes',
  sessionsDir:     '/var/bk-agent/sessions',
  maxIterations:   20,
});
await enterprise.indexAll({ verbose: true });

const triggers = new TriggerBus(enterprise.engineFactory)
  .addCron({
    name:        'weekly-digest',
    schedule:    '0 9 * * 1',
    buildPrompt: () => 'Summarize the knowledge base updates of the past week.',
    onComplete:  (result) => intranet.post('/announcements', result.output),
  });

// Pick up new vault notes every night (incremental: only changed notes are embedded)
setInterval(() => void enterprise.indexAll(), 24 * 60 * 60 * 1000);

const server = new AgentServer({
  port:          3000,
  host:          '0.0.0.0',
  engineFactory: enterprise.engineFactory,
  auth:          new JwtAuth({ secret: process.env.JWT_SECRET! }).hook(),
  store:         new RedisSessionMetaStore(new Redis(process.env.REDIS_URL!)),
  cors:          ['https://intranet.company.com'],
  rateLimiting:  { max: 30, timeWindow: '1 minute' },
  metrics:       { enabled: true },
  maxIdleMs:     30 * 60 * 1000,
  triggers,
});

await server.start();
process.on('SIGTERM', () => server.stop());
```

### Vault folder structure

```
/obsidian-vault
├── general/        ← shared by every department
├── soporte/        ← Support agent
├── rrhh/           ← HR agent (on-prem LLM)
├── ventas/         ← Sales agent
├── finanzas/       ← Finance agent (on-prem LLM)
├── operaciones/    ← Ops agent
├── politicas/      ← business policies, indexed by every department
└── agentes/        ← where VaultWriter (write_knowledge) saves notes
```

The names are the `VAULT_FOLDERS` constants. Each department agent searches only its own folder plus `general/` and `politicas/`, so HR content is not reachable from the Sales agent. The General agent's `search_knowledge` covers the whole vault. The indexer discovers markdown files recursively.
