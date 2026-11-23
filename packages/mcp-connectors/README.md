# @backendkit-labs/mcp-connectors

Three production-ready MCP (Model Context Protocol) servers that expose enterprise SaaS integrations as agent tools: **HubSpot CRM**, **Jira**, and **Google Calendar**.

Each connector ships as a standalone binary that runs in stdio mode (for use with any MCP client) or HTTP mode (for multi-tenant server deployments).

[![npm](https://img.shields.io/npm/v/@backendkit-labs/mcp-connectors)](https://www.npmjs.com/package/@backendkit-labs/mcp-connectors)

## Table of contents

- [Installation](#installation)
- [Running the servers](#running-the-servers)
- [HubSpot CRM connector](#hubspot-crm-connector)
- [Jira connector](#jira-connector)
- [Google Calendar connector](#google-calendar-connector)
- [Using with agent-core MCPClientManager](#using-with-agent-core-mcpclientmanager)
- [HTTP mode (multi-session)](#http-mode-multi-session)
- [Wiring all three connectors](#wiring-all-three-connectors)

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

## HubSpot CRM connector

### Authentication

Create a **Private App** in your HubSpot account (`Settings → Integrations → Private Apps`), grant it the required CRM scopes, and copy the access token:

| Environment variable | Required | Description |
|---------------------|----------|-------------|
| `HUBSPOT_TOKEN` | Yes | Private App access token |

### Tools

#### `crm_search_contacts`

Search contacts by name, email, or company name.

```
Tool: crm_search_contacts
Args:
  query  string   Search term — name, email, or company
  limit  number?  Max results (default 10)
```

**Example:**
```
search for alice@acme.com
→ crm_search_contacts({ query: "alice@acme.com" })
→ "ID:12345  Alice Johnson  <alice@acme.com>  Acme Corp  +1-555-0100"
```

**Complex example — search and enrich:**
```
Find all contacts at Acme Corp and tell me their job titles and when they were created
→ crm_search_contacts({ query: "Acme Corp", limit: 50 })
→ For each contact: crm_get_contact({ id: "..." })
→ LLM synthesizes a table of names, titles, and creation dates
```

---

#### `crm_get_contact`

Get full property details for a contact by HubSpot ID.

```
Tool: crm_get_contact
Args:
  id  string  HubSpot contact ID
```

**Returns:** `firstname`, `lastname`, `email`, `phone`, `company`, `jobtitle`, `lifecyclestage`, `createdate`, `lastmodifieddate`

**Example:**
```
Get the full details for contact 12345
→ crm_get_contact({ id: "12345" })
→ "Contact 12345
   firstname: Alice
   lastname: Johnson
   email: alice@acme.com
   jobtitle: VP Engineering
   lifecyclestage: customer"
```

---

#### `crm_create_contact`

Create a new contact in HubSpot CRM.

```
Tool: crm_create_contact
Args:
  email     string   Email address (required)
  firstname string?
  lastname  string?
  phone     string?
  company   string?
  jobtitle  string?
```

**Example:**
```
Add Bob Smith from Globex as a new CRM contact — bob@globex.com, +1-555-9999, Sr. Engineer
→ crm_create_contact({
    email:     "bob@globex.com",
    firstname: "Bob",
    lastname:  "Smith",
    company:   "Globex",
    phone:     "+1-555-9999",
    jobtitle:  "Sr. Engineer"
  })
→ "Created contact ID: 67890"
```

---

#### `crm_search_deals`

Search deals by name and/or deal stage.

```
Tool: crm_search_deals
Args:
  query  string?  Deal name search term
  stage  string?  Deal stage key (e.g. appointmentscheduled, qualifiedtobuy, closedwon, closedlost)
  limit  number?  Max results (default 10)
```

**Example — find open deals:**
```
Show me all deals in the "Qualified to Buy" stage worth over $50k
→ crm_search_deals({ stage: "qualifiedtobuy", limit: 50 })
→ LLM filters by amount from results
→ "ID:111  Enterprise License  stage:qualifiedtobuy  $75,000  close:2026-09-01"
```

**Example — search by name:**
```
Find the Acme Corp deal
→ crm_search_deals({ query: "Acme Corp" })
→ "ID:222  Acme Corp Enterprise  stage:presentationscheduled  $120,000  close:2026-07-15"
```

---

#### `crm_create_note`

Log an activity note, optionally linked to a contact and/or deal.

```
Tool: crm_create_note
Args:
  body        string   Note content
  contact_id  string?  HubSpot contact ID to associate
  deal_id     string?  HubSpot deal ID to associate
```

**Example:**
```
Log a call note: "Spoke with Alice, agreed to send proposal by Friday"
Associate with contact 12345 and deal 222
→ crm_create_note({
    body:       "Spoke with Alice, agreed to send proposal by Friday",
    contact_id: "12345",
    deal_id:    "222"
  })
→ "Created note ID: 333"
```

**Complex workflow example:**

```
After our sales call with Acme Corp today:
1. Find the Acme contact and deal
2. Log a note about the meeting outcome
3. Check if the deal close date needs updating

→ crm_search_contacts({ query: "Alice Acme Corp" })     → contact 12345
→ crm_search_deals({ query: "Acme Corp" })               → deal 222
→ crm_create_note({ body: "...", contact_id: "12345", deal_id: "222" })
→ LLM: "Note logged. The deal close date is 2026-07-15 — would you like to update it?"
```

---

## Jira connector

### Authentication

Generate an **API token** at `https://id.atlassian.com/manage-profile/security/api-tokens`.

| Environment variable | Required | Description |
|---------------------|----------|-------------|
| `JIRA_HOST` | Yes | Your Jira domain (e.g. `mycompany.atlassian.net`) |
| `JIRA_EMAIL` | Yes | Your Atlassian account email |
| `JIRA_TOKEN` | Yes | Jira API token (not your password) |

### Tools

#### `jira_search`

Search Jira issues using JQL (Jira Query Language).

```
Tool: jira_search
Args:
  jql    string   JQL query
  limit  number?  Max results (default 20)
```

**JQL examples:**
```
# All open bugs in PROJ, assigned to me
jql: project = PROJ AND issuetype = Bug AND status != Done AND assignee = currentUser()

# Recently updated critical issues
jql: priority = Critical AND updated >= -7d ORDER BY updated DESC

# Issues in the current sprint
jql: project = PROJ AND sprint in openSprints()

# My unresolved tasks due this week
jql: assignee = currentUser() AND resolution = Unresolved AND due <= endOfWeek()
```

**Example:**
```
Show me all open bugs in the BACKEND project assigned to Alice
→ jira_search({ jql: 'project = BACKEND AND issuetype = Bug AND status != Done AND assignee = "Alice Johnson"' })
→ "BACK-45  [In Progress]  High  Auth token expiry bug  @Alice Johnson
   BACK-51  [To Do]        Medium  Rate limit not enforced  @Alice Johnson"
```

---

#### `jira_get_issue`

Get full details for a Jira issue including description and recent comments.

```
Tool: jira_get_issue
Args:
  key  string  Issue key (e.g. PROJ-123)
```

**Returns:** summary, status, assignee, description (converted from ADF to plain text), last 3 comments.

**Example:**
```
What's the current status and description of BACK-45?
→ jira_get_issue({ key: "BACK-45" })
→ "BACK-45: Auth token expiry bug
   Status: In Progress   Assignee: Alice Johnson
   
   Description:
   When a token expires during an active session, the server returns 500
   instead of 401. Reproduction steps: ...
   
   Comments (last 2):
     [Alice Johnson · 2026-06-10]: Traced to TokenValidator.validate()
     [Bob Smith · 2026-06-11]: PR opened: https://..."
```

---

#### `jira_create_issue`

Create a new Jira issue.

```
Tool: jira_create_issue
Args:
  project      string   Project key (e.g. PROJ)
  summary      string   Issue title
  description  string?  Plain text description
  issue_type   string?  Issue type (default: Task). E.g. Bug, Story, Epic
  priority     string?  Priority (Highest, High, Medium, Low, Lowest)
```

**Example:**
```
Create a high-priority bug in BACK: "Login fails for SAML users with special characters in email"
→ jira_create_issue({
    project:     "BACK",
    summary:     "Login fails for SAML users with special characters in email",
    description: "Users with + in email address cannot log in via SAML SSO. Affects @company.com+alias emails.",
    issue_type:  "Bug",
    priority:    "High"
  })
→ "Created BACK-52 (ID: 100023)"
```

---

#### `jira_add_comment`

Add a comment to a Jira issue.

```
Tool: jira_add_comment
Args:
  key   string  Issue key
  body  string  Comment text
```

**Example:**
```
Add a comment to BACK-45: "Fixed in PR #127, ready for review"
→ jira_add_comment({ key: "BACK-45", body: "Fixed in PR #127, ready for review" })
→ "Comment added to BACK-45."
```

---

#### `jira_transition`

Move an issue to a new status (e.g. move from "To Do" to "In Progress").

```
Tool: jira_transition
Args:
  key     string  Issue key
  status  string  Target status name (e.g. Done, In Progress, To Do, In Review)
```

The tool fetches available transitions first and matches by name (case-insensitive). If the target status isn't available, it reports valid options.

**Example:**
```
Mark BACK-52 as "In Progress"
→ jira_transition({ key: "BACK-52", status: "In Progress" })
→ "BACK-52 → "In Progress""

Mark BACK-45 as done
→ jira_transition({ key: "BACK-45", status: "Done" })
→ "BACK-45 → "Done""
```

**Complex workflow — sprint management:**

```
Close out the sprint: mark all Done issues as closed, move remaining In Progress issues to next sprint

→ jira_search({ jql: "sprint in openSprints() AND status = Done" })
  For each: jira_transition({ key: "...", status: "Closed" })

→ jira_search({ jql: "sprint in openSprints() AND status = 'In Progress'" })
  LLM: "Found 3 in-progress issues: BACK-48, BACK-50, BACK-53. Move them to next sprint? (I need the sprint ID)"
```

---

## Google Calendar connector

### Authentication

Two auth modes are supported, checked in order:

#### Mode 1: Service Account (recommended for production)

Create a service account in Google Cloud Console, download the JSON key, and share the target calendar with the service account email. Supports automatic token refresh — no manual intervention needed.

```bash
# Paste the full JSON content of the service account key file
GCAL_SERVICE_ACCOUNT_KEY='{"type":"service_account","client_email":"bk-agent@my-project.iam.gserviceaccount.com","private_key":"-----BEGIN RSA PRIVATE KEY-----\n...","token_uri":"https://oauth2.googleapis.com/token"}'
```

The private key can also contain literal `\n` (as stored in environment variables) — the server handles unescaping automatically.

#### Mode 2: Access Token (quick testing)

```bash
GCAL_ACCESS_TOKEN=ya29.a0AfH...   # Google OAuth2 access token (expires in ~1h)
```

| Environment variable | Required | Description |
|---------------------|----------|-------------|
| `GCAL_SERVICE_ACCOUNT_KEY` | Recommended | Full JSON content of a service account key |
| `GCAL_ACCESS_TOKEN` | Alternative | Short-lived OAuth2 token |

### Tools

#### `calendar_list_calendars`

List all Google Calendars accessible to the authenticated account.

```
Tool: calendar_list_calendars
Args: (none)
```

**Example:**
```
What calendars do I have access to?
→ calendar_list_calendars()
→ "primary@company.com  "Alice Johnson" (primary)  [owner]
   team-eng@group.calendar.google.com  "Engineering Team"  [writer]
   company-holidays@group.calendar.google.com  "Company Holidays"  [reader]"
```

---

#### `calendar_list_events`

List upcoming events within a time range.

```
Tool: calendar_list_events
Args:
  calendar_id  string?  Calendar ID (default: "primary")
  time_min     string?  Start of range, ISO 8601 (default: now)
  time_max     string?  End of range, ISO 8601 (default: 7 days from now)
  limit        number?  Max events (default 10)
```

**Example — this week:**
```
What's on my calendar this week?
→ calendar_list_events({ limit: 20 })
→ "[2026-06-11 09:00 – 09:30] Daily Standup
   [2026-06-11 14:00 – 15:00] Architecture Review  (4 attendees)
   [2026-06-12 10:00 – 11:00] 1:1 with Bob
   [2026-06-13 All Day] Company Holiday"
```

**Example — specific calendar and range:**
```
Show me all Engineering Team events for next month
→ calendar_list_events({
    calendar_id: "team-eng@group.calendar.google.com",
    time_min:    "2026-07-01T00:00:00Z",
    time_max:    "2026-07-31T23:59:59Z",
    limit:       50
  })
```

---

#### `calendar_create_event`

Create a new event in Google Calendar.

```
Tool: calendar_create_event
Args:
  summary      string    Event title (required)
  start        string    Start time ISO 8601 (required)
  end          string    End time ISO 8601 (required)
  description  string?   Event description
  attendees    string[]? List of attendee email addresses
  timezone     string?   IANA timezone (default: UTC)
  calendar_id  string?   Calendar ID (default: "primary")
```

**Example — simple meeting:**
```
Schedule a 1-hour team sync tomorrow at 2pm Pacific
→ calendar_create_event({
    summary:  "Team Sync",
    start:    "2026-06-12T14:00:00",
    end:      "2026-06-12T15:00:00",
    timezone: "America/Los_Angeles"
  })
→ "Event created: abc123def
   https://calendar.google.com/calendar/event?eid=..."
```

**Example — meeting with attendees:**
```
Book a sprint planning meeting for next Monday 10am-12pm UTC
Invite: alice@co.com, bob@co.com, carol@co.com
Add agenda to description
→ calendar_create_event({
    summary:     "Sprint Planning — Q3 Sprint 2",
    start:       "2026-06-15T10:00:00",
    end:         "2026-06-15T12:00:00",
    timezone:    "UTC",
    description: "Agenda:\n1. Review previous sprint\n2. Story point estimation\n3. Sprint commitment",
    attendees:   ["alice@co.com", "bob@co.com", "carol@co.com"]
  })
→ "Event created: xyz789
   https://calendar.google.com/..."
```

---

#### `calendar_get_freebusy`

Check free/busy availability for one or more users in a time range.

```
Tool: calendar_get_freebusy
Args:
  emails    string[]  List of email addresses to check (required)
  time_min  string    Start of range, ISO 8601 (required)
  time_max  string    End of range, ISO 8601 (required)
```

**Example — find a meeting slot:**
```
Find a 1-hour slot when alice@co.com, bob@co.com, and carol@co.com are all free next Tuesday
→ calendar_get_freebusy({
    emails:   ["alice@co.com", "bob@co.com", "carol@co.com"],
    time_min: "2026-06-16T08:00:00Z",
    time_max: "2026-06-16T18:00:00Z"
  })
→ "alice@co.com:
     BUSY 09:00 – 09:30
     BUSY 11:00 – 12:00
   bob@co.com: FREE all day
   carol@co.com:
     BUSY 10:00 – 11:30
     BUSY 14:00 – 15:00"
→ LLM: "Everyone is free from 12:00 to 14:00 and from 15:00 to 18:00. Should I book 12:00–13:00?"
```

---

## Using with agent-core MCPClientManager

### Standalone client

```typescript
import { MCPClientManager } from '@backendkit-labs/agent-core';

const mcp = new MCPClientManager([
  { name: 'hubspot', command: 'bk-mcp-hubspot', env: { HUBSPOT_TOKEN: process.env.HUBSPOT_TOKEN! } },
  { name: 'jira', command: 'bk-mcp-jira', env: {
      JIRA_HOST: process.env.JIRA_HOST!, JIRA_EMAIL: process.env.JIRA_EMAIL!, JIRA_TOKEN: process.env.JIRA_TOKEN!,
  } },
  { name: 'gcal', command: 'bk-mcp-gcal', env: { GCAL_SERVICE_ACCOUNT_KEY: process.env.GCAL_SERVICE_ACCOUNT_KEY! } },
]);

await mcp.initialize();          // spawns each connector over stdio
const tools = mcp.getTools();    // mcp__hubspot__*, mcp__jira__*, mcp__gcal__*
```

### Via engine options (recommended approach)

Pass `mcpServers` to `createBaseEngine` or `createCodingEngine` — the engine manages lifecycle, retries, and disconnect detection:

```typescript
import { createBaseEngine, selfAssertedIdentities } from '@backendkit-labs/agent-core';

const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  ...baseConfig,
  mcpServers: [
    {
      name:    'hubspot',
      command: 'npx',
      args:    ['-y', '@backendkit-labs/mcp-connectors/hubspot'],
      env:     { HUBSPOT_TOKEN: process.env.HUBSPOT_TOKEN! },
    },
    {
      name:    'jira',
      command: 'npx',
      args:    ['-y', '@backendkit-labs/mcp-connectors/jira'],
      env:     {
        JIRA_HOST:  process.env.JIRA_HOST!,
        JIRA_EMAIL: process.env.JIRA_EMAIL!,
        JIRA_TOKEN: process.env.JIRA_TOKEN!,
      },
    },
    {
      name:    'gcal',
      command: 'npx',
      args:    ['-y', '@backendkit-labs/mcp-connectors/gcal'],
      env:     { GCAL_SERVICE_ACCOUNT_KEY: process.env.GCAL_SERVICE_ACCOUNT_KEY! },
    },
  ],
});
```

---

## HTTP mode (multi-session)

Start the servers in HTTP mode to share one connector process between several agent sessions on the same host:

```bash
# Start connectors as HTTP servers
HUBSPOT_TOKEN=xxx bk-mcp-hubspot --http --port 4001
JIRA_HOST=co.atlassian.net JIRA_EMAIL=me@co.com JIRA_TOKEN=xxx bk-mcp-jira --http --port 4002
GCAL_SERVICE_ACCOUNT_KEY='...' bk-mcp-gcal --http --port 4003
```

The HTTP server listens on `127.0.0.1` only and rejects requests whose `Host` or `Origin` is not loopback (protection against DNS rebinding). Set `BK_MCP_AUTH_TOKEN` to also require `Authorization: Bearer <token>`. Connect from the same host (or a sidecar that shares the network namespace) with a `url` config:

```typescript
const mcp = new MCPClientManager([
  { name: 'hubspot', url: 'http://127.0.0.1:4001/mcp', headers: { Authorization: `Bearer ${process.env.BK_MCP_AUTH_TOKEN}` } },
  { name: 'jira',    url: 'http://127.0.0.1:4002/mcp' },
  { name: 'gcal',    url: 'http://127.0.0.1:4003/mcp' },
]);
await mcp.initialize();
```

Because of the loopback-only binding, running each connector in its own container and calling it by service name (`http://mcp-hubspot:4001`) does not work. Run the connectors in the same container as the agent, as sidecars sharing `localhost`, or over stdio.

---

## Wiring all three connectors

Full example — an agent that can manage CRM contacts, Jira issues, and calendar events together:

```typescript
import { createCodingEngine } from '@backendkit-labs/agent-coding';
import { selfAssertedIdentities } from '@backendkit-labs/agent-core';

const engine = createCodingEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  providers: {
    deepseek: { apiKey: process.env.DEEPSEEK_API_KEY! },
  },
  defaultProvider: 'deepseek',
  mcpServers: [
    {
      name:    'hubspot',
      command: 'bk-mcp-hubspot',
      args:    [],
      env:     { HUBSPOT_TOKEN: process.env.HUBSPOT_TOKEN! },
    },
    {
      name:    'jira',
      command: 'bk-mcp-jira',
      args:    [],
      env:     {
        JIRA_HOST:  process.env.JIRA_HOST!,
        JIRA_EMAIL: process.env.JIRA_EMAIL!,
        JIRA_TOKEN: process.env.JIRA_TOKEN!,
      },
    },
    {
      name:    'gcal',
      command: 'bk-mcp-gcal',
      args:    [],
      env:     { GCAL_SERVICE_ACCOUNT_KEY: process.env.GCAL_SERVICE_ACCOUNT_KEY! },
    },
  ],
});

// Multi-tool agent workflow
await engine.run(`
  I just closed the Acme Corp deal. Please:
  1. Find the Acme Corp deal in HubSpot and log a note: "Deal closed — contract signed"
  2. Create a Jira task in the ONBOARD project: "Onboard Acme Corp — enterprise tier"
  3. Schedule a kickoff meeting for next Wednesday at 2pm ET with alice@acme.com
`);
```
