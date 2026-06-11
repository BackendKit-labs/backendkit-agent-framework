# @backendkit-labs/agent-enterprise

Enterprise-grade AI agent setup with RAG (Retrieval-Augmented Generation) over an Obsidian vault, six pre-configured department agent profiles, a vault writing tool, and a factory that wires everything into an `AgentEngine`-compatible setup.

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-enterprise)](https://www.npmjs.com/package/@backendkit-labs/agent-enterprise)

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [createEnterpriseSetup](#createenterprisesetup)
- [Enterprise agent profiles](#enterprise-agent-profiles)
- [RAG pipeline](#rag-pipeline)
- [VaultIndexer](#vaultindexer)
- [VaultWriter](#vaultwriter)
- [Embedders](#embedders)
- [ObsidianRAGProvider](#obsidianragprovider)
- [VectorStore](#vectorstore)
- [Full production example with AgentServer](#full-production-example-with-agentserver)

---

## Installation

```bash
npm install @backendkit-labs/agent-enterprise @backendkit-labs/agent-core
```

For the full web stack:

```bash
npm install @backendkit-labs/agent-enterprise @backendkit-labs/agent-core @backendkit-labs/agent-web
```

---

## Quick start

```typescript
import { createEnterpriseSetup } from '@backendkit-labs/agent-enterprise';
import { ProviderRegistry } from '@backendkit-labs/agent-core';
import { AgentServer } from '@backendkit-labs/agent-web';

// 1. Configure your LLM providers
const providers = new ProviderRegistry();
providers.register('openai', myOpenAIProvider);

// 2. Create the enterprise setup
const enterprise = createEnterpriseSetup({
  vaultPath:       '/shared/obsidian-vault',
  providers,
  defaultProvider: 'openai',
});

// 3. Index the vault (once at startup — subsequent runs only re-index changed files)
await enterprise.indexAll({ verbose: true });

// 4. Start the web server
const server = new AgentServer({
  port:          3000,
  engineFactory: enterprise.engineFactory,
  cors:          '*',
});

await server.start();
```

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
| `general` | General Assistant | `search_kb` (global vault) | `defaultProvider` |
| `support` | Support Agent | `search_support_kb` | `defaultProvider` |
| `hr` | HR Agent | `search_hr_kb` | `local` (sensitive) |
| `sales` | Sales Agent | `search_sales_kb` | `defaultProvider` |
| `finance` | Finance Agent | `search_finance_kb` | `local` (sensitive) |
| `ops` | Operations Agent | `search_ops_kb` | `defaultProvider` |

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
ENTERPRISE_TOOLS.SEARCH_KB;       // 'search_kb'
ENTERPRISE_TOOLS.SEARCH_SUPPORT;  // 'search_support_kb'
ENTERPRISE_TOOLS.SEARCH_HR;       // 'search_hr_kb'
ENTERPRISE_TOOLS.SEARCH_SALES;    // 'search_sales_kb'
ENTERPRISE_TOOLS.SEARCH_FINANCE;  // 'search_finance_kb'
ENTERPRISE_TOOLS.SEARCH_OPS;      // 'search_ops_kb'

// Vault folder name constants
VAULT_FOLDERS.GENERAL;     // 'General'
VAULT_FOLDERS.SUPPORT;     // 'Support'
VAULT_FOLDERS.HR;          // 'HR'
VAULT_FOLDERS.SALES;       // 'Sales'
VAULT_FOLDERS.FINANCE;     // 'Finance'
VAULT_FOLDERS.OPS;         // 'Operations'
```

### Adding custom profiles

```typescript
const enterprise = createEnterpriseSetup({
  ...opts,
  extraProfiles: [
    {
      id:           'legal',
      name:         'Legal Advisor',
      systemPrompt: `You are a legal knowledge assistant.
        Search the knowledge base for relevant precedents and policies.
        Always recommend consulting a licensed attorney for case-specific advice.`,
      tools:        ['search_kb'],
      provider:     'local',  // sensitive — stays on-prem
    },
    {
      id:           'engineering',
      name:         'Engineering Assistant',
      systemPrompt: 'You are a software engineering assistant with access to our internal technical documentation.',
      tools:        ['search_kb', 'write_vault'],
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
  → Top 5 chunks from HR/ and General/ folders returned
  → LLM answers using the retrieved excerpts as grounding context
```

---

## VaultIndexer

Use `VaultIndexer` directly for fine-grained control over indexing.

```typescript
import { VaultIndexer } from '@backendkit-labs/agent-enterprise';

const indexer = new VaultIndexer({
  vaultPath:    '/shared/obsidian-vault',
  indexPath:    '/cache/support-index.json',
  embedder:     myEmbedder,
  folders:      ['Support', 'General'],  // only index these folders (omit for all)
  chunkSize:    500,                     // tokens per chunk
  chunkOverlap: 50,                      // overlap between adjacent chunks
});

await indexer.index({ verbose: true });

const stats = indexer.getStats();
// { files: 42, chunks: 587, lastIndexedAt: '2026-06-11T09:00:00.000Z' }
```

### Incremental re-indexing

The indexer tracks file modification times. Re-running `index()` only processes changed or new files:

```typescript
// First run — full index (may take seconds to minutes depending on vault size)
await indexer.index({ verbose: true });

// Subsequent runs — only re-indexes changed files (very fast)
await indexer.index({ verbose: true });
// [VaultIndexer] 3 files changed, re-indexed 28 chunks
```

---

## VaultWriter

`VaultWriter` lets agents persist knowledge back to the Obsidian vault — closing the knowledge loop.

```typescript
import { VaultWriter } from '@backendkit-labs/agent-enterprise';

const writer = new VaultWriter({
  vaultPath:      '/shared/obsidian-vault',
  allowedFolders: ['General', 'Support'],  // restrict where agents can write
});

// Create a ToolDefinition the engine can call
const writeTool = writer.createTool('general'); // 'write_vault' tool

// Write directly (from non-agent code)
await writer.writeNote({
  folder:   'General',
  filename: 'api-auth-pattern.md',
  content:  '# API Auth Pattern\n\nAll endpoints require a Bearer token...',
  tags:     ['api', 'patterns', 'security'],
});
```

### How agents use VaultWriter

Agents with `write_vault` in their tool list can invoke it directly in conversation:

```
User: "Document the new API authentication pattern we agreed on"
  → General agent
  → LLM calls write_vault({
      folder: "General",
      filename: "api-auth-2026.md",
      content: "# API Auth Pattern\n\n..."
    })
  → File created/updated in the vault
  → LLM: "I've documented the auth pattern in General/api-auth-2026.md"
```

---

## Embedders

Embedders convert text strings into float vectors for similarity search.

### SimpleEmbedder (default — no external dependencies)

A deterministic, hash-based embedder. Requires no API key or running service. Lower accuracy than neural models but always available and zero-latency:

```typescript
import { SimpleEmbedder } from '@backendkit-labs/agent-enterprise';

const embedder = new SimpleEmbedder();
// Good for: prototyping, CI/CD, air-gapped systems, and fallback
```

### OllamaEmbedder (recommended for production)

Uses a local Ollama embedding model for high-quality semantic embeddings. Requires a running Ollama instance with an embedding model installed:

```bash
ollama pull nomic-embed-text    # 274 MB — general purpose, fast
ollama pull mxbai-embed-large   # 669 MB — higher accuracy
```

```typescript
import { OllamaEmbedder, OLLAMA_EMBED_DEFAULT_HOST, OLLAMA_EMBED_DEFAULT_MODEL } from '@backendkit-labs/agent-enterprise';

const embedder = new OllamaEmbedder({
  host:  'http://localhost:11434',  // default: OLLAMA_EMBED_DEFAULT_HOST
  model: 'nomic-embed-text',        // default: OLLAMA_EMBED_DEFAULT_MODEL
});

const enterprise = createEnterpriseSetup({
  vaultPath:       '/vault',
  providers,
  defaultProvider: 'local',
  embedder,
});
```

### Custom embedder (OpenAI, Cohere, Hugging Face, etc.)

```typescript
import type { Embedder } from '@backendkit-labs/agent-enterprise';

class OpenAIEmbedder implements Embedder {
  async embed(texts: string[]): Promise<number[][]> {
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    return res.data.map(d => d.embedding);
  }
}

const enterprise = createEnterpriseSetup({
  ...opts,
  embedder: new OpenAIEmbedder(),
});
```

---

## ObsidianRAGProvider

Combines `VaultIndexer` + `VectorStore` in one class with a search API and a tool factory. Use it directly for custom RAG configurations.

```typescript
import { ObsidianRAGProvider } from '@backendkit-labs/agent-enterprise';

const rag = new ObsidianRAGProvider({
  vaultPath: '/shared/obsidian-vault',
  indexPath: '/cache/support-index.json',
  embedder:  new OllamaEmbedder({ model: 'nomic-embed-text' }),
  folders:   ['Support', 'General'],
  topK:       5,      // return top 5 results
  minScore:   0.15,   // discard results below this similarity threshold
});

// Index the vault
await rag.index({ verbose: true });

// Search
const results = await rag.search('How do I reset my password?');
// [
//   { content: "To reset your password...", score: 0.82, source: "Support/password-reset.md" },
//   { content: "Users can request a reset...", score: 0.71, source: "General/user-guide.md" },
// ]

// Create a typed ToolDefinition for the engine
const searchTool = rag.createTool('search_support_kb');
// → ToolDefinition with name 'search_support_kb' that calls rag.search()
```

---

## VectorStore

Low-level cosine-similarity search engine. Use it when you have your own embedding pipeline.

```typescript
import { VectorStore } from '@backendkit-labs/agent-enterprise';
import type { VectorChunk, SearchResult } from '@backendkit-labs/agent-enterprise';

const store = new VectorStore();

// Add pre-embedded chunks
store.add([
  { id: 'c1', content: 'Password reset procedure...', embedding: [...512 floats...], source: 'support.md' },
  { id: 'c2', content: 'Password policy requires...', embedding: [...512 floats...], source: 'policy.md' },
]);

// Search by query embedding
const queryEmbeddings = await embedder.embed(['reset password steps']);
const results: SearchResult[] = store.search(queryEmbeddings[0], { topK: 3, minScore: 0.1 });

// Persist index to disk
store.saveToFile('/cache/my-index.json');

// Load from disk (on restart)
const loaded = VectorStore.loadFromFile('/cache/my-index.json');
```

---

## Full production example with AgentServer

A complete on-prem enterprise deployment with Ollama embeddings, DeepSeek for general agents, local Ollama for HR/Finance, Redis sessions, and JWT auth:

```typescript
import { createEnterpriseSetup, OllamaEmbedder } from '@backendkit-labs/agent-enterprise';
import { ProviderRegistry } from '@backendkit-labs/agent-core';
import { AgentServer, JwtAuth, TriggerBus, RedisSessionMetaStore } from '@backendkit-labs/agent-web';
import Redis from 'ioredis';

// ── LLM Providers ─────────────────────────────────────────────────────────────

const providers = new ProviderRegistry();

// Cloud: general, support, sales, ops
providers.register('deepseek', new DeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  model:  'deepseek-chat',
}));

// On-prem: HR and Finance (sensitive data)
providers.register('local', new OllamaProvider({
  host:  'http://ollama.internal:11434',
  model: 'llama3.2',
}));

// ── Enterprise Setup ───────────────────────────────────────────────────────────

const enterprise = createEnterpriseSetup({
  vaultPath:       process.env.VAULT_PATH!,
  providers,
  defaultProvider: 'deepseek',
  embedder:        new OllamaEmbedder({
    host:  'http://ollama.internal:11434',
    model: 'nomic-embed-text',
  }),
  indexDir:     '/var/bk-agent/rag-indexes',
  sessionsDir:  '/var/bk-agent/sessions',
  maxIterations: 20,
});

await enterprise.indexAll({ verbose: true });

// Re-index every night at 2 AM to pick up new vault notes
import { CronJob } from 'node-cron';
CronJob.schedule('0 2 * * *', () => enterprise.indexAll());

// ── Infrastructure ─────────────────────────────────────────────────────────────

const redis  = new Redis(process.env.REDIS_URL!);
const jwt    = new JwtAuth({ secret: process.env.JWT_SECRET!, sessionIdClaim: 'sub' });
const triggers = new TriggerBus(enterprise.engineFactory)
  .addCron({
    name:        'weekly-digest',
    schedule:    '0 9 * * 1',
    buildPrompt: () => 'Summarize all knowledge base updates from the past week.',
    onResult:    (out) => intranet.post('/announcements', out),
  });

// ── Server ─────────────────────────────────────────────────────────────────────

const server = new AgentServer({
  port:          3000,
  engineFactory: enterprise.engineFactory,
  auth:          jwt.hook(),
  store:         new RedisSessionMetaStore(redis),
  cors:          ['https://intranet.company.com'],
  rateLimiting:  { max: 30, timeWindow: '1 minute' },
  metrics:       { enabled: true, prefix: 'enterprise_' },
  maxIdleMs:     30 * 60 * 1000,
  triggers,
});

await server.start();
console.log('Enterprise agent server running on :3000');

process.on('SIGTERM', () => server.stop());
```

### Required vault folder structure

```
/obsidian-vault
├── General/          ← all agents can search here
├── Support/          ← Support agent
├── HR/               ← HR agent (on-prem LLM)
├── Sales/            ← Sales agent
├── Finance/          ← Finance agent (on-prem LLM)
└── Operations/       ← Ops agent
```

Create these folders in Obsidian and add `.md` files. The indexer discovers all markdown files recursively.
