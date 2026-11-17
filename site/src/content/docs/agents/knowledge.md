---
title: Knowledge agents
description: Department agents (support, HR, sales, finance, ops) that answer from your company's documents, with per-folder isolation and local models for sensitive data.
---

`@backendkit-labs/agent-enterprise` is for agents that answer from **your own knowledge**: an Obsidian vault of documents, indexed for search, with one agent per department and a boundary around what each may read.

```ts
import { createEnterpriseSetup } from '@backendkit-labs/agent-enterprise';
import { ProviderRegistry } from '@backendkit-labs/agent-core';
import { AgentServer } from '@backendkit-labs/agent-web';

const providers = new ProviderRegistry();
providers.register('openai', myOpenAIProvider);

const enterprise = createEnterpriseSetup({
  vaultPath: '/shared/obsidian-vault',
  providers,
  defaultProvider: 'openai',
});

await enterprise.indexAll({ verbose: true });     // once at startup; later runs re-index only what changed

const server = new AgentServer({ port: 3000, engineFactory: enterprise.engineFactory, cors: '*' });
await server.start();
```

## Six department profiles

Each has a system prompt, a **scoped search tool** and an optional provider override.

| Profile | Search tool | Provider |
|---|---|---|
| `general` | `search_knowledge` (the whole vault) | the default |
| `support` | `search_support_kb` | the default |
| `hr` | `search_hr_kb` | `local` |
| `sales` | `search_sales_kb` | the default |
| `finance` | `search_finance_kb` | `local` |
| `ops` | `search_ops_kb` | the default |

HR and Finance default to a **local** provider, so payroll and financial data never leave your network. You can add your own profiles.

## How the knowledge is found

A RAG pipeline indexes the vault into a vector store and searches it per question. Each department's tool searches only its folder, so isolation is enforced by what the tool can see, not by a request to the model to behave.

- **Embedders:** `SimpleEmbedder` (no dependencies, the default), `OllamaEmbedder` (recommended for production), or your own.
- **`VaultWriter`:** lets an agent write notes back to the vault.
- **Per-session memory** and per-user context through the engine factory.

## Flows with compliance gates

Business processes across departments (onboarding an employee involves HR and finance, for example) are [flows](../../concepts/flows/) defined in YAML with `gate.approval: human` where a person must decide, and the enterprise agents as the executors of the steps.

## A deployment

The pieces compose into a service: `createEnterpriseSetup` for the agents and the index, [`agent-web`](../services/) for the browser, JWT authentication and rate limiting on the server, and [OpenTelemetry](../../concepts/observability-and-cost/) for traces.

The `enterprise` architecture of `create-bk-agent` scaffolds it with a local LLM and a vault.

**Try it:** the [`vault-pilot` example](../../examples/starters/#vault-pilot) runs these agents over a sample vault, with offline checks of what each department can see.

Reference: the [`agent-enterprise` page](../../packages/enterprise/).
