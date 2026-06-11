# @backendkit-labs/mcp-server

MCP (Model Context Protocol) server that exposes code intelligence, skills management, and project context as tools for any MCP-compatible AI client (Claude Desktop, agent-core, Cursor, etc.).

[![npm](https://img.shields.io/npm/v/@backendkit-labs/mcp-server)](https://www.npmjs.com/package/@backendkit-labs/mcp-server)

> **Status: `stable`** — Maintained and production-ready. No new features during the pilot phase.

## Table of contents

- [Installation](#installation)
- [Running the server](#running-the-server)
- [Tools reference](#tools-reference)
- [Code intelligence index](#code-intelligence-index)
- [Connecting via agent-core](#connecting-via-agent-core)
- [Connecting via Claude Desktop](#connecting-via-claude-desktop)
- [HTTP mode](#http-mode)
- [Environment variables](#environment-variables)

---

## Installation

```bash
npm install -g @backendkit-labs/mcp-server
# or use via npx:
npx @backendkit-labs/mcp-server
```

Binary: `bk-mcp`

---

## Running the server

### Stdio mode (default — for Claude Desktop, agent-core)

```bash
bk-mcp

# Against a specific project
BK_CWD=/my-project bk-mcp

# With a custom app name
BK_APP_NAME=my-app BK_CWD=/my-project bk-mcp
```

### HTTP mode (multi-session)

```bash
bk-mcp --http --port 3100
```

---

## Tools reference

### `stack_detect`

Detect the project's technology stack using file detection and the code index.

```
Args:
  cwd  string?  Project directory (defaults to server cwd)
```

**Example:**
```
What stack does this project use?
→ stack_detect()
→ "Detected stack: typescript, node, react, docker"
```

---

### `code_index`

Index the codebase into a SQLite graph database. Incremental — only re-indexes changed files.

```
Args:
  cwd    string?   Project directory
  watch  boolean?  Enable file watcher for live updates (default: false)
```

**Example:**
```
Index this codebase
→ code_index({ watch: true })
→ "Indexed 234 files, 4,821 symbols. File watcher enabled."
```

**What gets indexed:** functions, classes, interfaces, types, enums from TypeScript/JS/Go/Python/Java/Kotlin. Callers and callees are recorded for each symbol (call graph).

---

### `code_search`

Search for symbols by name or keyword.

```
Args:
  query  string   Symbol name or keyword
  limit  number?  Max results (default 20)
```

**Example:**
```
Where is TokenValidator defined?
→ code_search({ query: "TokenValidator" })
→ "**TokenValidator** (class) — src/auth/token-validator.ts:15
     class TokenValidator { validate(token: string): DecodedToken | null }"
```

**Fuzzy search:**
```
All functions related to payment
→ code_search({ query: "payment", limit: 30 })
→ PaymentProcessor, processPayment, validatePayment, createPaymentIntent, ...
```

---

### `code_context`

Given a task description, find the most relevant symbols and return their code, callers, and callees. Bootstraps context for a coding task without manual file reading.

```
Args:
  task        string   Task or feature description
  max_symbols number?  Max symbols (default 10)
```

**Example:**
```
I need to add rate limiting to the login endpoint
→ code_context({ task: "add rate limiting to login endpoint" })
→ 
### loginHandler (function) — src/routes/auth.ts:67-89
> calledBy: router.post | calls: validateCredentials, createSession
\`\`\`typescript
async function loginHandler(req: Request, res: Response) {
  const { email, password } = req.body;
  ...
}
\`\`\`
```

The agent immediately knows which files and symbols are relevant.

---

### `skills_search`

Search available skills by query.

```
Args:
  query  string   Search term
  cwd    string?  Project directory for stack detection
```

**Example:**
```
Find skills for TypeScript testing
→ skills_search({ query: "typescript testing" })
→ "- **ts-jest-setup** ✓ [global, typescript, ACTIVE]
     Configure Jest for TypeScript with proper transforms
   - **vitest-config** [node, typescript]
     Set up Vitest for unit testing"
```

`✓` means the skill matches the detected stack.

---

### `skills_install`

Install a skill pack from GitHub or a local path.

```
Args:
  source  string   GitHub URL or local path
  skill   string?  Install only a specific skill
  pack    string?  Override the derived pack name
```

**Example:**
```
Install our company skills repo
→ skills_install({ source: "https://github.com/my-org/agent-skills" })
→ "Installed pack "backend" with 12 skill(s)."
```

---

### `skills_list`

List all installed skill packs.

```
Args: (none)
```

**Example:**
```
What packs are installed?
→ skills_list()
→ "**global** (builtin)
     Skills: code-review, refactor-pattern, ...
   **my-org-backend** (installed 2026-06-01)
     Skills: stripe-integration, postgres-pattern, ..."
```

---

## Code intelligence index

The indexer uses **Tree-sitter** (WASM) to parse source code into a SQLite graph with symbols and their relationships. Storage location:

```
~/.{BK_APP_NAME}/code-index/{base64url(CWD)}.db
```

Default: `~/.deepseek-code/code-index/{hash}.db`

Supported languages: TypeScript, JavaScript, Go, Python, Java, Kotlin, Rust.

---

## Connecting via agent-core

```typescript
import { createCodingEngine } from '@backendkit-labs/agent-coding';

const engine = createCodingEngine({
  providers:       { deepseek: { apiKey: process.env.DEEPSEEK_API_KEY! } },
  defaultProvider: 'deepseek',
  mcpServers: [
    {
      name:    'code-intelligence',
      command: 'bk-mcp',
      args:    [],
      env: {
        BK_APP_NAME: 'my-app',
        BK_CWD:      process.cwd(),
      },
    },
  ],
  subAgentContextMessages: 20,
});

// Index then query
await engine.run('Index this codebase');
await engine.run('Find all functions that directly access the database without using the repository layer');
```

---

## Connecting via Claude Desktop

Add to your Claude Desktop config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "bk-code": {
      "command": "bk-mcp",
      "env": {
        "BK_APP_NAME": "claude-code",
        "BK_CWD":      "/path/to/your/project"
      }
    }
  }
}
```

Restart Claude Desktop — the tools will appear in the tool picker.

### Multiple projects

```json
{
  "mcpServers": {
    "bk-api": {
      "command": "bk-mcp",
      "env": { "BK_CWD": "/projects/api-server", "BK_APP_NAME": "claude-code" }
    },
    "bk-frontend": {
      "command": "bk-mcp",
      "env": { "BK_CWD": "/projects/frontend", "BK_APP_NAME": "claude-code" }
    }
  }
}
```

---

## HTTP mode

```bash
BK_CWD=/my-project bk-mcp --http --port 3100
```

Connect:

```typescript
await mcp.connectStreamableHTTP({
  name:    'code-intelligence',
  baseUrl: 'http://localhost:3100',
});
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BK_APP_NAME` | `deepseek-code` | App name — determines `~/.{name}/` storage |
| `BK_CWD` | `process.cwd()` | Project directory to index and serve |
