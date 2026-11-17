---
title: Agents that connect
description: Agents wired to SaaS tools, documents and payments - MCP connectors, document extraction and payment tools.
---

Agents become useful when they reach the systems where work happens. The framework ships ready-made pieces for three common cases, each a package you add only when you need it.

## SaaS tools: `mcp-connectors`

MCP servers that expose business tools to any agent: **HubSpot CRM**, **Jira** and **Google Calendar**. Each is a standalone binary that runs over stdio (for any MCP client) or HTTP (for multi-tenant deployments).

```bash
npm install @backendkit-labs/mcp-connectors
```

| Binary | Tools for |
|---|---|
| `bk-mcp-hubspot` | HubSpot CRM |
| `bk-mcp-jira` | Jira |
| `bk-mcp-gcal` | Google Calendar |

An engine connects to them with the MCP client:

```ts
import { MCPClientManager } from '@backendkit-labs/agent-core';

const mcp = new MCPClientManager([
  { name: 'hubspot', command: 'bk-mcp-hubspot', env: { HUBSPOT_TOKEN: process.env.HUBSPOT_TOKEN! } },
  // ...
]);
```

Their tools then sit next to yours, under the same [policy](../../concepts/governance/): a tool that creates a deal or sends an invite can be made to ask first.

## Documents: `document-extract`

Text out of PDF, Word (`.docx`), Excel (`.xlsx`), CSV and plain text, for agents. It extracts **content, not meaning**: it will not decide what an "invoice total" is, the agent does.

```ts
import { extractDocument } from '@backendkit-labs/document-extract';

const doc = await extractDocument(bytes, { filename: 'invoice.pdf', limits: { maxPages: 50 }, signal });
// { format: 'pdf', text: '--- page 1 ---\n...', pages: 2, bytes: 48211, hasTextLayer: true, truncated: false }
```

Limits (bytes, pages) and stable error codes make it safe to point at files you do not control. As a ready tool, `createReadDocumentTool` gives the agent `read_document` for files under its working directory.

## Payments: `aval-tools`

Payment tools for agents that spend through an AVAL instance: a credential per agent, a budget checked before the payment, and a chained log.

- **`pay`** asks for a spending ceiling and AVAL decides: paid (with the real cost), held (with an authorization id to check later) or denied (with the reason). Every answer says how much budget the agent has left.
- **`check_payment`** looks up the state of one of its own authorizations, which is how a held payment gets resolved later without blocking a session on a human.

Money is the clearest case for [declaring a tool destructive](../../guides/govern-a-payment-tool/).

Reference: [`mcp-connectors`](../../packages/mcp-connectors/), [`document-extract`](../../packages/document-extract/), [`aval-tools`](../../packages/aval-tools/).
