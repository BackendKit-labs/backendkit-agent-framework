---
title: Agents that connect
description: Agents wired to SaaS tools, documents and payments - MCP connectors, document extraction and payment tools, each with a policy in front.
---

Agents become useful when they reach the systems where work happens. The framework ships ready-made pieces for three common cases, each a package you add only when you need it.

## SaaS tools: `mcp-connectors`

MCP servers that expose business tools to any agent: **HubSpot CRM**, **Jira**, **Google Calendar**, **Odoo** and an **AI vault**. Each is a standalone binary that runs over stdio (for any MCP client) or HTTP (for multi-tenant deployments).

```bash
npm install @backendkit-labs/mcp-connectors
```

| Binary | Tools for |
|---|---|
| `bk-mcp-hubspot` | HubSpot CRM |
| `bk-mcp-jira` | Jira |
| `bk-mcp-gcal` | Google Calendar |
| `bk-mcp-odoo` | Odoo |
| `bk-mcp-ai-vault` | An AI vault |

### Connect it, and decide what it may do alone

An engine connects to MCP servers with `mcpServers`. Their tools appear next to yours with the server name as a prefix (`mcp__hubspot__create_deal`) and every call goes through the same [policy](../../concepts/governance/). Here a sales agent reads the CRM freely, but anything that creates or changes a record asks a person first:

```ts
import { createBaseEngine, StdoutTransport, consoleApprover, type AgentProfile, type ToolPolicy } from '@backendkit-labs/agent-core';
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';

const sales: AgentProfile = {
  id: 'sales', name: 'Sales', icon: '🤝', description: 'Works the CRM',
  systemPrompt: 'You help the sales team with the CRM. Look things up before you change anything.',
  allowedTools: [],                                   // the tools of the MCP server are added to the agent
};

// Reading is free. Creating or changing a record asks a person.
const crmPolicy: ToolPolicy = {
  decide: (_principal, call) =>
    /^mcp__hubspot__(create|update|delete)_/.test(call.tool.name)
      ? { effect: 'ask', reason: 'changes the CRM', accepts: ['human'] }
      : { effect: 'allow' },
};

const engine = createBaseEngine({
  providers: { main: new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY! }) },
  defaultProvider: 'main',
  agents: [sales],
  defaultAgent: 'sales',
  tools: [],
  transport: new StdoutTransport(),
  workingDir: process.cwd(),
  iterationMode: 'auto',
  mcpServers: [
    { name: 'hubspot', command: 'bk-mcp-hubspot', env: { HUBSPOT_TOKEN: process.env.HUBSPOT_TOKEN! } },
  ],
  policy: crmPolicy,
  approver: consoleApprover(),                        // a person at the terminal answers y/n
  approverTimeoutMs: 5 * 60_000,                      // and if nobody answers in five minutes, the call is denied
});

await engine.run('Find the Acme deal and create a renewal for next quarter');
```

This pattern was run end to end with a stand-in MCP server: the lookup ran, the creation asked, and a "no" meant the tool never ran. Tools of an MCP server do not declare `readOnly`, so a rule by name (as above) is how you tell the reads from the writes.

## Documents: `document-extract`

Text out of PDF, Word (`.docx`), Excel (`.xlsx`), CSV and plain text, for agents. It extracts **content, not meaning**: it will not decide what an "invoice total" is, the agent does.

```ts
import { extractDocument } from '@backendkit-labs/document-extract';
import { readFile } from 'node:fs/promises';

const bytes = await readFile('invoice.pdf');
const doc = await extractDocument(bytes, { filename: 'invoice.pdf', limits: { maxPages: 50 } });
// { format: 'pdf', text: '--- page 1 ---\n...', pages: 2, bytes: 48211, hasTextLayer: true, truncated: false }
```

Limits (bytes, pages) and stable error codes make it safe to point at files you do not control. As a ready tool, `createReadDocumentTool` gives the agent `read_document` for files under its working directory:

```ts
import { createReadDocumentTool } from '@backendkit-labs/document-extract';

// give it to an agent: tools: [createReadDocumentTool()], allowedTools: ['read_document']
// by default it reads files under the working directory; pass resolvePath to decide where a path may point
```

## Payments: `aval-tools`

Payment tools for agents that spend through an AVAL instance: a credential per agent, a budget checked before the payment, and a chained log.

- **`pay`** asks for a spending ceiling and AVAL decides: paid (with the real cost), held (with an authorization id to check later) or denied (with the reason). Every answer says how much budget the agent has left.
- **`check_payment`** looks up the state of one of its own authorizations, which is how a held payment gets resolved later without blocking a session on a human.

Money is the clearest case for [declaring a tool destructive](../../guides/govern-a-payment-tool/): the guide builds the policy, the approver, the role check and the four-eyes rule step by step, with a test that proves each one.

Reference: [`mcp-connectors`](../../packages/mcp-connectors/), [`document-extract`](../../packages/document-extract/), [`aval-tools`](../../packages/aval-tools/).
