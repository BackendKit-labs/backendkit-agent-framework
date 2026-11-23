# @backendkit-labs/agent-enterprise

Business agents on top of `agent-core`: RAG over an Obsidian vault with per-department isolation, six department agent profiles, a vault writing tool, YAML flows with compliance gates, and a factory that wires it all into an `AgentEngine` per session.

[![npm](https://img.shields.io/npm/v/@backendkit-labs/agent-enterprise)](https://www.npmjs.com/package/@backendkit-labs/agent-enterprise)

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
import { ProviderRegistry, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { AgentServer } from '@backendkit-labs/agent-web';

// 1. Configure your LLM providers
const providers = new ProviderRegistry();
providers.register('openai', myOpenAIProvider);

// 2. Create the enterprise setup
const enterprise = createEnterpriseSetup({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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

## What else is in it

Everything below is in the **[reference](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/REFERENCE.md)**: each topic has its own section with examples.

| Topic | What it covers |
|---|---|
| [createEnterpriseSetup](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/REFERENCE.md#createenterprisesetup) | The main factory. Returns `{ indexAll, engineFactory }`. |
| [Enterprise agent profiles](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/REFERENCE.md#enterprise-agent-profiles) | Six department profiles are built in. |
| [RAG pipeline](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/REFERENCE.md#rag-pipeline) | The RAG pipeline works in two phases |
| [ObsidianRAGProvider](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/REFERENCE.md#obsidianragprovider) | Indexes an Obsidian vault into a vector store and answers searches. |
| [VaultWriter](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/REFERENCE.md#vaultwriter) | `VaultWriter` lets agents write knowledge back to the vault, closing the loop |
| [Embedders](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/REFERENCE.md#embedders) | Embedders convert text into vectors for similarity search. |
| [Events and reconciliation](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/REFERENCE.md#events-and-reconciliation) | When one agent must tell another system that something happened ("invoice approved"), `EventPublisher` sends a typed event through a queue... |
| [The n8n trigger tool](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/REFERENCE.md#the-n8n-trigger-tool) | `createN8nTriggerTool({ webhookUrl })` gives an agent a tool, `n8n_trigger`, that starts an n8n workflow by POSTing `{ event, correlationId,... |
| [Full production example with AgentServer](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/enterprise/REFERENCE.md#full-production-example-with-agentserver) | An on-prem deployment |
