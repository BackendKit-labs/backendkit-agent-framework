# @backendkit-labs/agent-enterprise

**Status: core** — RAG and VaultWriter are required for the enterprise story; changes go through full review.

Enterprise knowledge layer for the BackendKit Agent Framework — local RAG over Obsidian vaults, shared knowledge vault with agent write-back, and pluggable embedders.

```bash
npm install @backendkit-labs/agent-enterprise
```

> Requires `@backendkit-labs/agent-core`. Works with any LLM provider — no cloud dependency required.

---

## What it does

Gives your agents a **shared, persistent knowledge base** backed by Markdown files:

- **Read** — agents search the vault semantically (`search_knowledge` tool)
- **Write** — agents contribute new knowledge back to the vault (`write_knowledge` tool)
- **Index** — incremental indexing by file mtime; only re-embeds new or modified files
- **Human-readable** — the vault is plain Markdown, openable in Obsidian or any editor

---

## Quick start — RAG over an Obsidian vault

```ts
import { AgentEngine, ToolRegistry } from '@backendkit-labs/agent-core';
import { ObsidianRAGProvider } from '@backendkit-labs/agent-enterprise';

const rag = new ObsidianRAGProvider({
  vaultPath:      '/path/to/your/vault',
  ollamaHost:     'http://localhost:11434',  // default
  embeddingModel: 'nomic-embed-text',        // default
});

// Index the vault (incremental — only changed files on subsequent runs)
await rag.index({ verbose: true });

// Register the search_knowledge tool with your engine
const tools = new ToolRegistry();
tools.register(rag.createTool());
```

The agent calls `search_knowledge` automatically when it needs information from the vault.

---

## Shared vault with agent write-back

```ts
import { ObsidianRAGProvider, VaultWriter } from '@backendkit-labs/agent-enterprise';

const rag    = new ObsidianRAGProvider({ vaultPath: '/vault', ...opts });
const writer = new VaultWriter({ vaultPath: '/vault' });

const tools = new ToolRegistry();
tools.register(rag.createTool());           // search_knowledge
tools.register(writer.createTool('analyst')); // write_knowledge — baked in with agent id

// After the agent writes a note, re-index to make it searchable:
await rag.index();
```

Agent-written notes land in `<vaultPath>/agentes/` with standard frontmatter:

```markdown
---
title: "Cache Decision for RAG Embeddings"
author: "agent/analyst"
date: 2026-06-10
tags: ["área/rag", "tipo/decisión"]
description: "LRU in-memory cache chosen over persistent or semantic cache"
---

## Context
...
```

---

## Custom embedder — no Ollama required

Pass any object that implements `Embedder` to skip Ollama:

```ts
import { ObsidianRAGProvider, type Embedder } from '@backendkit-labs/agent-enterprise';

class MyEmbedder implements Embedder {
  readonly model = 'my-model-v1';
  async embed(texts: string[]): Promise<number[][]> { /* ... */ }
  async embedOne(text: string): Promise<number[]>   { /* ... */ }
}

const rag = new ObsidianRAGProvider({
  vaultPath: '/vault',
  embedder:  new MyEmbedder(),   // ollamaHost and embeddingModel are ignored
});
```

---

## SimpleEmbedder — local testing without Ollama

For tests and CI where Ollama is not available:

```ts
// Not exported from the package — copy from pilot/src/embedders/SimpleEmbedder.ts
// TF-IDF feature hashing, 256 dims, pure Node.js, zero dependencies
const rag = new ObsidianRAGProvider({
  vaultPath: '/vault',
  embedder:  new SimpleEmbedder(),
  minScore:  0.1,  // lower threshold for keyword-based vectors
});
```

---

## ObsidianRAGProvider options

```ts
new ObsidianRAGProvider({
  vaultPath:      string;          // absolute path to vault directory
  folders?:       string[];        // sub-folders to index (default: all)
  indexPath?:     string;          // where to save the vector index JSON
  embedder?:      Embedder;        // custom embedder (overrides ollamaHost/embeddingModel)
  ollamaHost?:    string;          // default: http://localhost:11434
  embeddingModel?: string;         // default: nomic-embed-text
  topK?:          number;          // max results per search (default: 5)
  minScore?:      number;          // min cosine similarity 0–1 (default: 0.3)
  excludeTags?:   string[];        // frontmatter tags to skip (default: ['skill'])
})
```

---

## VaultWriter options

```ts
new VaultWriter({
  vaultPath:    string;   // must match the ObsidianRAGProvider vaultPath
  agentFolder?: string;   // sub-folder for agent notes (default: 'agentes')
})

writer.createTool(agentId: string): ToolDefinition
// Returns write_knowledge tool with agentId baked into each note's author field
```

---

## Vault structure

Recommended layout for enterprise deployments:

```
vault/
  rrhh/           ← HR domain — only HR Agent indexed here
  ventas/         ← Sales domain
  ops/            ← Operations
  compartido/     ← Cross-domain, all agents read
  agentes/        ← Auto-created — agent-written notes land here
```

Mount only the relevant folders per agent:

```ts
new ObsidianRAGProvider({ vaultPath, folders: ['ventas', 'compartido', 'agentes'] })
```

---

## How indexing works

1. `VaultIndexer` scans `.md` files and reads their `mtime`
2. Compares against stored mtimes in `VectorStore`
3. Only embeds files that are new or modified since last index
4. Chunks each file by `##` headings (max 500 words per chunk)
5. Stores vectors + metadata in a single JSON file on disk

The JSON store scales to ~5–10k chunks. For larger vaults, use a proper vector DB (pgvector, Qdrant) with a custom `Embedder` adapter.

---

## License

MIT © [BackendKit Labs](https://github.com/BackendKit-labs)
