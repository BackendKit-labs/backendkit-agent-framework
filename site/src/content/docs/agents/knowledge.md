---
title: Knowledge agents
description: Department agents (support, HR, sales, finance, ops) that answer from your company's documents, with per-folder isolation and local models for sensitive data.
---

`@backendkit-labs/agent-enterprise` is for agents that answer from **your own knowledge**: an Obsidian vault of documents, indexed for search, with one agent per department and a boundary around what each may read.

```ts
import { createEnterpriseSetup } from '@backendkit-labs/agent-enterprise';
import { ProviderRegistry, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { AgentServer } from '@backendkit-labs/agent-web';

const providers = new ProviderRegistry();
providers.register('openai', myOpenAIProvider);

const enterprise = createEnterpriseSetup({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
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

### What the general agent can see

The `general` agent uses the default provider, which may be a remote one, and its search (`search_knowledge`) must not become the way around the local provider of HR and Finance. So by default the general search **leaves out the folders of HR and Finance** (`rrhh/` and `finanzas/`): what it retrieves is what its provider may see. To change that, pass the folders yourself:

```ts
createEnterpriseSetup({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  vaultPath, providers, defaultProvider: 'openai',
  globalExcludeFolders: ['rrhh', 'finanzas', 'legal'],   // folders the general agent never searches
  // globalExcludeFolders: [],                           // the whole vault, as in earlier versions: only if its provider may see all of it
});
```

### Where each agent writes

`write_knowledge` writes in the folder of the department of the agent that calls it (HR in `rrhh/`, Finance in `finanzas/`, and so on), and the note says who wrote it (`author: "agent/hr"`). Any other agent writes in `agentes/`. A note is never overwritten: the same title on the same day gets a number, and a note over 200,000 characters is refused.

A note an agent wrote is **a claim of that agent, not a document of the company**: when a search finds it, the result says so (`escrita por un agente (agent/hr), no verificada`), so the agent that reads it does not take it for policy.

## How the knowledge is found

A RAG pipeline indexes the vault into a vector store and searches it per question. Each department's tool searches only its folder, so isolation is enforced by what the tool can see, not by a request to the model to behave.

- **Embedders:** `SimpleEmbedder` (no dependencies, the default), `OllamaEmbedder` (recommended for production), or your own.
- **`VaultWriter`:** lets an agent write notes back to the vault.
- **Per-session memory** and per-user context through the engine factory.

## Flows with compliance gates

Business processes across departments (onboarding an employee involves HR and finance, for example) are [flows](../../concepts/flows/) defined in YAML with `gate.approval: human` where a person must decide, and the enterprise agents as the executors of the steps.

A step with criteria goes through a `ComplianceGate`: the evaluator must differ from the executor, and every attempt is recorded. The gate also writes a readable note in the vault (`auditoria/`), but a note is a file anyone with access to the vault can edit. For a record a third party can verify, give the flow run an audit sink, and every event of every gate becomes a link of a signed-chain log:

```ts
import { HashChainAuditSink } from '@backendkit-labs/agent-core';
import { FlowRunner } from '@backendkit-labs/agent-enterprise';

const runner = new FlowRunner(flowDefinition, {
  runAgent, transport, onGateRequired,
  gateAudit: new HashChainAuditSink('./gates.audit.ndjson'),   // one audit event per gate event, chained
});
await runner.run();
```

A sink that fails stops the evaluation: a decision that cannot be recorded is not taken.

## A deployment

The pieces compose into a service: `createEnterpriseSetup` for the agents and the index, [`agent-web`](../services/) for the browser, JWT authentication and rate limiting on the server, and [OpenTelemetry](../../concepts/observability-and-cost/) for traces.

The `enterprise` architecture of `create-bk-agent` scaffolds it with a local LLM and a vault.

**Try it:** the [`vault-pilot` example](../../examples/starters/#vault-pilot) runs these agents over a sample vault, with offline checks of what each department can see.

Reference: the [`agent-enterprise` page](../../packages/enterprise/).
