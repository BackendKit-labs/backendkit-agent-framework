# @backendkit-labs/mcp-connectors

Three production-ready MCP (Model Context Protocol) servers that expose enterprise SaaS integrations as agent tools: **HubSpot CRM**, **Jira**, and **Google Calendar**.

Each connector ships as a standalone binary that runs in stdio mode (for use with any MCP client) or HTTP mode (for multi-tenant server deployments).

[![npm](https://img.shields.io/npm/v/@backendkit-labs/mcp-connectors)](https://www.npmjs.com/package/@backendkit-labs/mcp-connectors)

---

## Installation

```bash
npm install @backendkit-labs/mcp-connectors
```

The package ships three binaries:

| Binary | MCP server name |
|--------|----------------|
| `bk-mcp-hubspot` | `bk-mcp-hubspot` |
| `bk-mcp-jira` | `bk-mcp-jira` |
| `bk-mcp-gcal` | `bk-mcp-gcal` |

Or use via `npx` without installing:

```bash
npx @backendkit-labs/mcp-connectors bk-mcp-hubspot
```

---

## Running the servers

### Stdio mode (default — for MCP clients like Claude Desktop, agent-core)

```bash
# HubSpot
HUBSPOT_TOKEN=pat-xxx bk-mcp-hubspot

# Jira
JIRA_HOST=mycompany.atlassian.net JIRA_EMAIL=me@co.com JIRA_TOKEN=xxx bk-mcp-jira

# Google Calendar (service account — recommended)
GCAL_SERVICE_ACCOUNT_KEY='{ "client_email": "...", "private_key": "..." }' bk-mcp-gcal

# Google Calendar (access token — short-lived, for quick testing)
GCAL_ACCESS_TOKEN=ya29.xxx bk-mcp-gcal
```

### HTTP mode (for remote/multi-session deployments)

```bash
bk-mcp-hubspot --http --port 4001
bk-mcp-jira    --http --port 4002
bk-mcp-gcal    --http --port 4003
```

---

## What else is in it

Everything below is in the **[reference](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/mcp-connectors/REFERENCE.md)**: each topic has its own section with examples.

| Topic | What it covers |
|---|---|
| [HubSpot CRM connector](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/mcp-connectors/REFERENCE.md#hubspot-crm-connector) | Create a Private App in your HubSpot account (`Settings → Integrations → Private Apps`), grant it the required CRM scopes, and copy the access token |
| [Jira connector](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/mcp-connectors/REFERENCE.md#jira-connector) | Generate an API token at `https://id.atlassian.com/manage-profile/security/api-tokens`. |
| [Google Calendar connector](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/mcp-connectors/REFERENCE.md#google-calendar-connector) | Two auth modes are supported, checked in order |
| [Using with agent-core MCPClientManager](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/mcp-connectors/REFERENCE.md#using-with-agent-core-mcpclientmanager) | const mcp = new MCPClientManager([ { name |
| [HTTP mode (multi-session)](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/mcp-connectors/REFERENCE.md#http-mode-multi-session) | Start the servers in HTTP mode to share one connector process between several agent sessions on the same host |
| [Wiring all three connectors](https://github.com/BackendKit-labs/backendkit-agent-framework/blob/master/packages/mcp-connectors/REFERENCE.md#wiring-all-three-connectors) | Full example — an agent that can manage CRM contacts, Jira issues, and calendar events together |
