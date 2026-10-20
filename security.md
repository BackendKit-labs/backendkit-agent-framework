# Security — bk-agent-coding

## Findings (prioritized P0–P3)

### P0 — Critical

#### 1. Command Injection via `run_command` tool (shell injection)

**File**: `packages/coding/src/tools/run-command.ts`
**Severity**: **CRITICAL**
**CVSS-like**: 9.8 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H)

The `run_command` tool passes user-controlled input directly to `execSync()` with only a blocklist of 3 hardcoded dangerous commands (`rm -rf /`, `format`, `del /f /s /q c:\`). This blocklist is trivially bypassable:

- `rm -rf /` can be bypassed as `rm -rf "$(pwd)/"` or `rm -rf /*`
- `format` can be bypassed as `format.com` or `/sbin/mkfs.ext4 /dev/sda`
- No restriction on `curl | bash`, `wget -O- | sh`, `chmod +x`, `dd`, `mkfs`, `:(){ :|:& };:`, or any other destructive command
- The blocklist check uses `command.toLowerCase().includes(blocked)` which is a substring match — trivial to bypass with encoding or indirection

**Impact**: Any agent with `run_command` in its `allowedTools` (coder, backend, frontend, qa-engineer, security, architecture, infrastructure) can execute arbitrary shell commands on the host system. This includes reading/writing any file, exfiltrating data, installing malware, or destroying the system.

**Mitigation**: Replace `execSync` with `execa` or `child_process.spawn` with an allowlist of safe commands (e.g., `npm`, `git`, `node`, `tsc`, `make`). Never pass raw user/LLM-generated strings to a shell.

**Current state (2026-10)**: a binary allowlist (`COMMAND_ALLOWLIST`) validates every segment of a chain split on `&&`, `||`, `|`, `;`, `&`, backtick, `$(`, `\r` and `\n`. Newline was missing from that split and let `git status\nbash` through; fixed, with regression tests. **Accepted residual risk**: the allowlist includes interpreters and tools that run arbitrary code (`node`, `npx`, `python`, `curl`, `docker`, `rm`, ...). The allowlist limits which binaries are named, not what they do — it is not a sandbox. Run coding agents in an isolated environment (container/VM) when the prompt source is untrusted.

---

#### 2. Path Traversal in all file tools (no sandbox)

**Files**: `read-file.ts`, `write-file.ts`, `edit-file.ts`, `list-directory.ts`, `search-files.ts`
**Severity**: **CRITICAL**
**CVSS-like**: 8.6 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L)

All file tools resolve paths relative to `workingDir` using `path.resolve()`, but there is **no sandbox enforcement**. An LLM can craft paths like:

- `../../etc/passwd` — read system files
- `../../.ssh/id_rsa` — steal SSH keys
- `../../.aws/credentials` — steal cloud credentials
- `~/.bk-agent/config.json` — read API keys of other providers

The `path.resolve()` call normalizes the path but does **not** check that the result stays within `workingDir`. A simple `path.resolve(workingDir, '../../etc/passwd')` escapes the sandbox.

**Impact**: Any agent with file tools can read, write, or modify any file on the filesystem accessible to the user running the process.

**Mitigation**: After resolving the absolute path, verify it starts with `path.resolve(workingDir)` using `path.relative()` or a proper sandbox check. Reject paths that escape the working directory.

---

#### 3. API Keys Stored in Plaintext on Disk

**File**: `packages/coding/src/config/ConfigLoader.ts`
**Severity**: **CRITICAL**
**CVSS-like**: 7.5 (AV:L/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:H)

API keys for DeepSeek, Anthropic, OpenAI, Kimi, and Grok are stored in **plaintext** in `~/.bk-agent/config.json`. The file has no special permissions (default umask). Any process or user with read access to the home directory can extract all LLM provider API keys.

Additionally, the `ConfigLoader._bootstrap()` method writes the config template with empty API keys, but when the user fills them in, they remain in plaintext indefinitely.

**Impact**: Compromise of all LLM provider accounts. Potential financial loss (API usage billed to the key owner), data exfiltration via LLM API access.

**Mitigation**: 
- Document that users should set file permissions to `600` (`chmod 600 ~/.bk-agent/config.json`)
- Recommend using environment variables exclusively (already supported)
- Add a warning on first run if config.json contains API keys with permissive permissions
- Consider supporting OS keychain integration (macOS Keychain, Windows Credential Manager, Linux secret-tool)

---

### P1 — High

#### 4. No Input Validation on Tool Arguments (JSON Schema bypass)

**Files**: All tool implementations
**Severity**: **HIGH**
**CVSS-like**: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N)

Tool arguments are parsed from LLM-generated JSON but **never validated against the declared JSON Schema**. The `parameters` field on each `ToolDefinition` is a JSON Schema that describes expected types and constraints, but the `execute()` function casts directly:

```typescript
const { command, timeout_ms = 30_000 } = args as { command: string; timeout_ms?: number };
```

If the LLM generates unexpected types (e.g., `command: null`, `command: 12345`, or extra fields), there is no validation layer. A malicious or hallucinating LLM could:

- Pass `command: ""` (empty string — executes a shell with no command, hangs)
- Pass `file_path: null` (crashes `resolve()` with a type error)
- Pass `content: undefined` (writes "undefined" to a file)
- Pass `timeout_ms: -1` (negative timeout — `execSync` behavior is undefined)

**Impact**: Unexpected tool behavior, potential crashes, or undefined `execSync` behavior with negative/zero timeouts.

**Mitigation**: Use a JSON Schema validation library (e.g., `ajv`, `zod`) to validate all tool arguments against their declared schema before execution. Reject invalid inputs with a clear error message.

---

#### 5. Secrets in Logs and Context (no sanitization)

**Files**: `packages/coding/src/store/ProjectStore.ts`, `packages/coding/src/tools/append-log.ts`, `packages/coding/src/tools/save-context.ts`
**Severity**: **HIGH**
**CVSS-like**: 6.5 (AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N)

The `appendLog`, `save_context`, `save_learning`, and `saveUserPreference` tools write arbitrary LLM-generated content to persistent files (`log.md`, `context.md`, `learnings.md`, `USER.md`). There is **no mechanism to detect or redact secrets** (API keys, tokens, passwords, connection strings) before they are persisted.

The `buildSystemContext()` method reads these files and injects them into the orchestrator's system prompt, which is sent to the LLM provider. If a secret was previously logged, it will be re-exposed to the LLM on every subsequent session.

**Impact**: Secrets leaked to persistent storage and potentially re-exposed to LLM providers (which may log API traffic for training/monitoring).

**Mitigation**: 
- Implement a secrets detection regex (e.g., `(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]+['"]`) in the write path
- Add a `.gitignore`-style secrets allowlist/blocklist
- Warn users when sensitive patterns are detected in tool output

---

#### 6. No Rate Limiting or Retry on LLM API Calls

**Files**: `packages/coding/src/providers/OpenAICompatibleProvider.ts`, `packages/coding/src/providers/AnthropicProvider.ts`
**Severity**: **HIGH**
**CVSS-like**: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)

LLM API calls are made directly without:
- Rate limiting (token bucket or leaky bucket)
- Retry with exponential backoff
- Circuit breaker pattern
- Request timeout (the `maxTokens` parameter limits response size, not request duration)

A burst of parallel delegations (up to 6 per wave) × multiple waves can trigger 429 (Rate Limit) errors from the API provider. Without retry logic, these errors propagate immediately and fail the entire delegation wave.

**Impact**: Unreliable behavior under load. Wasted API calls. Poor user experience when rate limits are hit.

**Mitigation**: 
- Implement retry with exponential backoff + jitter (e.g., 1s, 2s, 4s, 8s — max 3 retries)
- Add configurable rate limiting (requests per minute) per provider
- Add a configurable timeout for LLM requests

---

#### 7. Message History Grows Unbounded (no token budget enforcement)

**File**: `packages/core/src/engine/AgentEngine.ts`
**Severity**: **HIGH**
**CVSS-like**: 6.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)

The `messages` array in `AgentEngine` grows without bound. Each iteration appends the assistant message + tool results. With a default max of 100 iterations, the message history can easily exceed the LLM's context window (typically 8K–128K tokens). When the context window is exceeded:

- OpenAI: throws an error (context_length_exceeded)
- Anthropic: throws an error
- The session fails with no graceful degradation

There is **no sliding window, no summarization, no token counting** to manage context.

**Impact**: Sessions fail unpredictably on long conversations. Wasted API calls on messages that will be truncated.

**Mitigation**:
- Implement token counting (using `tiktoken` for OpenAI, Anthropic's token counting)
- Implement a sliding window that drops oldest messages when approaching the context limit
- Implement automatic summarization of old messages
- Expose `maxContextTokens` as a configurable option

---

### P2 — Medium

#### 8. `search_files` Tool Uses Shell-Executed `grep` (Command Injection Vector)

**File**: `packages/coding/src/tools/search-files.ts`
**Severity**: **MEDIUM**
**CVSS-like**: 6.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:L)

The `search_files` tool constructs a `grep` command string and passes it to `execSync`:

```typescript
const cmd = `grep ${flags.join(' ')} "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
```

While the pattern has basic quote escaping (`pattern.replace(/"/g, '\\"')`), this is insufficient:
- Backtick injection: `` pattern = "`malicious_command`" `` — backticks are not escaped
- `$()` command substitution: `pattern = "$(malicious_command)"` — dollar signs are not escaped
- Flag injection: `pattern = "--help"` or `pattern = "-e 'malicious' --include='*.sh'"` — the pattern is treated as a flag if it starts with `-`

**Impact**: An LLM could craft a search pattern that executes arbitrary commands via shell injection.

**Mitigation**: 
- Use `child_process.spawn` with `grep` as the command and arguments as an array (never a string)
- Escape all shell metacharacters, not just double quotes
- Validate that `pattern` does not start with `-` (to prevent flag injection)
- Better yet: implement search natively in Node.js using `fs.readdirSync` + regex matching

---

#### 9. No TLS/SSL Verification Configuration

**Files**: `packages/coding/src/providers/OpenAICompatibleProvider.ts`, `packages/coding/src/providers/AnthropicProvider.ts`
**Severity**: **MEDIUM**
**CVSS-like**: 5.9 (AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N)

The OpenAI SDK and Anthropic SDK use default TLS settings. There is no:
- Custom CA certificate support (for enterprise proxies)
- Certificate pinning
- Configuration option to disable TLS verification (for testing with local proxies)
- Proxy configuration

**Impact**: In enterprise environments with custom CAs, connections may fail. No ability to inspect traffic for debugging.

**Mitigation**: 
- Expose `baseUrl` for proxy support (already partially done for OpenAI-compatible)
- Add optional `ca`, `cert`, `key` options for mTLS
- Document that users should set `HTTPS_PROXY` / `HTTP_PROXY` environment variables for proxy support

---

#### 10. No Session Isolation Between Concurrent Users

**File**: `packages/core/src/engine/AgentEngine.ts`
**Severity**: **MEDIUM**
**CVSS-like**: 5.5 (AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N)

The `AgentEngine` is a single-instance runtime. If used in a server context (e.g., embedded in a web app), each user would need their own `AgentEngine` instance. However, the `ProjectStore` uses a shared filesystem (`~/.bk-agent/projects/{cwd-hash}/`), and `PersistentMemory` writes to a single `memory.json` file. Concurrent sessions on the same project would:

- Corrupt `memory.json` (last write wins — no atomicity)
- Interleave `context.md` and `log.md` entries
- Race condition on audit file writes

**Impact**: Data corruption under concurrent access. Not suitable for multi-user or server deployments.

**Mitigation**: 
- Document that the framework is single-user/single-session only
- Add file locking (e.g., `proper-lockfile` npm package) for concurrent access
- If server mode is desired, implement proper session isolation with per-session storage directories

---

#### 11. Agent System Prompts Can Be Overridden by Untrusted Files

**File**: `packages/coding/src/agents/AgentLoader.ts`
**Severity**: **MEDIUM**
**CVSS-like**: 5.3 (AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N)

The `AgentLoader` reads agent definitions from:
1. `~/.bk-agent/agents/` (global — any user process can write here)
2. `{cwd}/.bk-agent/agents/` (project — any contributor can add files)

If an attacker can write a `.json` or `.md` file to either directory, they can:
- Override the system prompt of any built-in agent (e.g., make the "security" agent ignore vulnerabilities)
- Add a new agent with arbitrary capabilities
- Change the `allowedTools` of an existing agent to grant write access to read-only agents

The `.md`-only override mechanism (no `.json` counterpart) is particularly dangerous because it silently overrides built-in agents without the user's explicit awareness.

**Impact**: Privilege escalation via agent profile manipulation. An attacker could make the orchestrator delegate to a malicious agent.

**Mitigation**:
- Validate that agent files are owned by the current user (or root)
- Add a checksum/hash verification for built-in agent profiles
- Log a warning when an agent is overridden
- Consider requiring explicit user confirmation for agent overrides

---

### P3 — Low

#### 12. No Input Size Limits on Prompts or Tool Results

**Files**: `packages/core/src/engine/AgentEngine.ts`, all tool implementations
**Severity**: **LOW**
**CVSS-like**: 3.3 (AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L)

There are no limits on:
- User input size (could be megabytes of text)
- Tool result size (the `run_command` tool truncates at 20KB, but other tools don't)
- Message history size (grows unbounded — see finding #7)

A user could paste a multi-megabyte file as input, causing excessive memory usage and API costs.

**Impact**: Denial of service via resource exhaustion. Unexpected API costs.

**Mitigation**: 
- Add configurable input size limits (e.g., 100KB max per user message)
- Add configurable tool result size limits
- Warn when inputs exceed recommended sizes

---

#### 13. No Audit Trail for Sensitive Operations

**Files**: All tool implementations
**Severity**: **LOW**
**CVSS-like**: 3.3 (AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N)

There is no audit trail for:
- Which agent wrote/modified which files
- Which commands were executed
- Which API keys were accessed
- When sessions started/ended

The `appendLog` tool is opt-in and relies on the LLM remembering to call it. There is no automatic logging of tool executions.

**Impact**: No forensic capability after a security incident. Cannot determine which agent performed a malicious action.

**Mitigation**: 
- Add automatic audit logging for all tool executions (agent ID, tool name, args preview, timestamp)
- Store audit logs in a tamper-evident format (e.g., append-only with HMAC)
- Log all `run_command` executions with full command text

---

#### 14. No Dependency Vulnerability Scanning

**File**: `package.json` (root and packages)
**Severity**: **LOW**
**CVSS-like**: 2.6 (AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L)

The project has no:
- `npm audit` integration in CI
- Snyk / Dependabot / Renovate configuration
- SBOM (Software Bill of Materials)
- Vulnerability scanning for transitive dependencies

Dependencies include `openai` ^4.0.0 and `@anthropic-ai/sdk` ^0.98.0, which are large SDKs with their own transitive dependencies.

**Impact**: Vulnerabilities in dependencies may go undetected until exploitation.

**Mitigation**: 
- Add `npm audit` to CI pipeline
- Configure Dependabot or Renovate for automated dependency updates
- Run `npm audit` regularly
- Pin exact dependency versions in production

---

#### 15. No Security Headers or CSP (Not Applicable — CLI Tool)

This finding is intentionally omitted as the project is a CLI tool, not a web application. No HTTP headers, CSP, or XSS protections are needed.

---

#### 16. Token Counting Stubbed to Zero (No Cost Visibility)

**File**: `packages/core/src/delegation/DelegationBus.ts` (line: `inputTokens: 0, outputTokens: 0`)
**Severity**: **LOW**
**CVSS-like**: 1.0 (AV:L/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:N)

All token counts are hardcoded to `0`. The `metrics` event is defined in the protocol but never emitted. This means:
- No cost tracking
- No ability to detect anomalous usage
- No ability to enforce token budgets
- No visibility into which agents consume the most tokens

**Impact**: Users may be surprised by API costs. No ability to detect billing anomalies.

**Mitigation**: 
- Implement token counting using `tiktoken` (OpenAI) and Anthropic's token counting API
- Emit `metrics` events after each LLM call
- Track cumulative token usage per session
- Add optional token budget enforcement

## Authentication & Authorization Review

### Authentication

The project is a **CLI tool** with no user authentication. There is no:
- User login/registration
- Session tokens or API keys for users
- Multi-factor authentication
- Password management

**Risk**: Low — this is appropriate for a CLI tool. Authentication is not needed.

### Authorization (Agent-Level)

The project implements a **tool allowlist** system for authorization:

| Mechanism | Implementation | Status |
|---|---|---|
| **Tool allowlist** | `AgentProfile.allowedTools` restricts which tools each agent can call | ✅ Implemented |
| **Delegation allowlist** | `AgentProfile.delegatesTo` restricts which agents can be delegated to | ✅ Implemented |
| **Orchestrator restriction** | The "general" agent has only read-only tools | ✅ Implemented |
| **Provider override** | Per-agent `provider` field allows different LLM providers per agent | ✅ Implemented |

**Gaps**:

1. **No principle of least privilege enforcement**: The `delegatesTo: ['*']` wildcard on the "general" agent allows delegation to ALL registered agents, including any malicious agents added via the layered loading system.

2. **No agent identity verification**: When `ask_agent` is called, there is no verification that the target agent is who it claims to be. A project-level agent override could impersonate a built-in agent.

3. **No tool execution audit**: There is no record of which agent executed which tool. If a malicious agent writes to a file, there is no audit trail.

4. **No separation of concerns for sensitive tools**: The `run_command` tool is available to 7 out of 9 agents. Only the "general" (orchestrator) and "data" agents are restricted from running commands.

### Authorization (File-Level)

There is no file-level authorization:
- Any agent with write tools can modify any file within the working directory
- Any agent with read tools can read any file within the working directory (and escape it — see Finding #2)
- No concept of "read-only zones" or "protected files"

### Recommendations

1. Remove the `['*']` wildcard from `delegatesTo` — require explicit delegation targets
2. Add a `protectedFiles` or `allowedPaths` configuration to restrict file access
3. Add automatic audit logging for all tool executions
4. Consider adding a "confirmation required" flag for dangerous tools (run_command, write_file outside project dir)

## Data Protection Gaps

### 1. API Keys at Rest — Plaintext Storage

**Severity**: CRITICAL

API keys for all LLM providers are stored in **plaintext** in `~/.bk-agent/config.json`:
- `DEEPSEEK_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `KIMI_API_KEY`
- `GROK_API_KEY`

**Risk**: Any process with read access to the home directory can extract all keys. The config file has default permissions (typically `644` on Linux/macOS, readable by all users).

**Mitigation**: 
- Environment variables are the recommended approach (already supported)
- Document `chmod 600 ~/.bk-agent/config.json`
- Consider OS keychain integration

### 2. API Keys in Transit — TLS Only

API keys are transmitted to LLM providers over TLS (HTTPS). This is adequate for transit protection. However:
- No certificate pinning
- No mTLS support
- No proxy authentication support

### 3. Secrets in Persistent Storage

**Severity**: HIGH

The following files may contain secrets written by LLM agents:
- `context.md` — project context (could contain API keys, connection strings)
- `learnings.md` — learned preferences (could contain passwords)
- `log.md` — activity log (could contain tokens, secrets)
- `memory.json` — key-value memory (could contain sensitive data)
- `audits/*.md` — audit reports (could contain vulnerability details with secrets)

These files are stored in `~/.bk-agent/projects/{cwd-hash}/` with default filesystem permissions.

### 4. No Encryption at Rest

All persistent data is stored as plaintext files:
- No filesystem-level encryption
- No per-field encryption for sensitive values
- No encryption key management

### 5. No Data Classification

There is no mechanism to classify data sensitivity:
- No "sensitive" flag on memory keys
- No redaction patterns for common secrets
- No data retention policies
- No data purge mechanism

### 6. Cross-Session Data Leakage

The `buildSystemContext()` method reads all persistent files and injects them into the LLM system prompt. This means:
- Data written in one session is visible to all future sessions
- If a secret was accidentally logged, it will be re-exposed to the LLM on every subsequent run
- The LLM provider receives all context data (subject to their data usage policies)

### 7. No Data Sanitization on Output

Tool results are returned to the LLM as-is. If a file contains secrets (e.g., reading `.env` or `config.json`), those secrets are sent to the LLM provider. There is no:
- Output sanitization
- Secrets redaction
- Content inspection before sending to LLM

## Quick Wins

These are low-effort, high-impact fixes that can be implemented immediately:

### 1. Path Traversal Sandbox (1 hour)

Add a `isWithinProject()` helper and apply it to all file tools:

```typescript
function isWithinProject(absPath: string, workingDir: string): boolean {
    const relative = path.relative(workingDir, absPath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}
```

Apply in `read_file`, `write_file`, `edit_file`, `list_directory` after `path.resolve()`.

### 2. Strengthen `run_command` Blocklist (30 minutes)

Replace the substring-based blocklist with a comprehensive one and add command allowlist mode:

```typescript
const BLOCKED_PATTERNS = [
    /rm\s+-rf/, /rm\s+--recursive/, /format/, /mkfs/, /dd\s+if=/,
    /:\(\)/, /curl\s+\S+\s*\|/, /wget\s+\S+\s*\|/, /bash\s+-c/,
    /chmod\s+777/, /chown/, /sudo/, /su\s+-/, /passwd/,
    /\/etc\//, /\/dev\//,
];
```

Better yet, switch to an **allowlist** of safe commands (`npm`, `git`, `node`, `npx`, `tsc`, `make`, `docker`, `kubectl`).

### 3. Add `npm audit` to CI (15 minutes)

Add a `.github/workflows/security.yml` file:

```yaml
name: Security
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm audit --audit-level=high
```

### 4. Add Secrets Detection Regex to Write Tools (2 hours)

Add a shared `detectSecrets()` function that checks for common secret patterns before writing to persistent storage:

```typescript
const SECRET_PATTERNS = [
    /(?:api[_-]?key|apikey|secret|password|token|credential)\s*[:=]\s*['"][^'"]+['"]/i,
    /(?:-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----)/,
    /(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{36}/,  // GitHub tokens
    /(?:sk-[A-Za-z0-9]{20,})/,  // OpenAI keys
    /(?:xox[bpsa]-[A-Za-z0-9-]{10,})/,  // Slack tokens
];
```

Log a warning when secrets are detected in tool output.

### 5. Add Input Validation with Zod (4 hours)

Add `zod` as a dependency and create validation schemas for all tool arguments:

```typescript
import { z } from 'zod';

const RunCommandSchema = z.object({
    command: z.string().min(1).max(1000),
    timeout_ms: z.number().int().positive().max(300000).default(30000),
});
```

Apply validation in each tool's `execute()` function before casting.

### 6. Document Security Best Practices (1 hour)

Add a `SECURITY.md` file to the repository root with:
- How to securely configure API keys (env vars preferred)
- File permission recommendations
- How to report vulnerabilities
- Known security limitations

### 7. Add File Permission Warning on Config Bootstrap (30 minutes)

In `ConfigLoader._bootstrap()`, check file permissions on `config.json` and warn if they are too permissive:

```typescript
if (process.platform !== 'win32') {
    const stat = fs.statSync(this.configPath);
    const mode = stat.mode & 0o777;
    if (mode & 0o077) {
        console.warn(`[security] Warning: ${this.configPath} has permissions ${mode.toString(8)}. Consider: chmod 600 ${this.configPath}`);
    }
}
```

## Security Requirements

### R1 — Path Traversal Prevention (P0)
All file tools MUST validate that resolved paths stay within the working directory. Implement a `isWithinProject()` check in `read_file`, `write_file`, `edit_file`, `list_directory`, and `search_files`.

### R2 — Command Injection Prevention (P0)
The `run_command` tool MUST NOT pass user/LLM-generated strings directly to a shell. Replace `execSync` with `spawn` using an allowlist of safe commands, or implement proper shell escaping with validated argument arrays.

### R3 — API Key Protection (P0)
API keys MUST NOT be stored in world-readable files. The config bootstrap MUST warn if `config.json` has permissions more permissive than `600`. Environment variables MUST be documented as the recommended approach.

### R4 — Input Validation (P1)
All tool arguments MUST be validated against their declared JSON Schema before execution. Use a schema validation library (zod, ajv, or similar).

### R5 — Secrets Detection (P1)
All write paths (file tools, log tools, context tools) MUST scan for common secret patterns and warn before persisting. The `buildSystemContext()` method MUST redact detected secrets before injecting into the system prompt.

### R6 — Rate Limiting and Retry (P1)
LLM provider calls MUST implement:
- Retry with exponential backoff (max 3 retries)
- Configurable rate limiting per provider
- Configurable request timeout

### R7 — Context Window Management (P1)
The engine MUST implement token counting and context window management:
- Track token usage per message
- Implement sliding window or summarization when approaching context limits
- Emit `metrics` events with real token counts

### R8 — Audit Logging (P2)
All tool executions MUST be automatically logged with:
- Agent ID
- Tool name and arguments (preview)
- Timestamp
- Success/failure status

### R9 — Agent Profile Integrity (P2)
The agent loading system MUST:
- Warn when a built-in agent is overridden
- Verify file ownership of agent definition files
- Log all agent overrides

### R10 — Dependency Security (P2)
The project MUST:
- Run `npm audit` in CI
- Configure automated dependency updates (Dependabot/Renovate)
- Pin exact dependency versions in production

### R11 — Session Isolation (P2)
If the framework is used in a multi-session context, file-based persistence MUST implement:
- File locking for concurrent access
- Per-session storage directories
- Atomic write operations

### R12 — Security Documentation (P3)
The project MUST include:
- `SECURITY.md` with vulnerability reporting process
- Security configuration guide
- Known limitations documentation

### R13 — Token Counting (P3)
Implement real token counting and emit `metrics` events with accurate `input_tokens`, `output_tokens`, and `cost_usd` values.

---

## Summary

| ID | Finding | Severity | Effort | Priority |
|---|---|---|---|---|
| #1 | Command Injection via `run_command` | CRITICAL | 4h | P0 |
| #2 | Path Traversal in file tools | CRITICAL | 1h | P0 |
| #3 | API Keys in plaintext on disk | CRITICAL | 2h | P0 |
| #4 | No input validation on tool args | HIGH | 4h | P1 |
| #5 | Secrets in logs and context | HIGH | 2h | P1 |
| #6 | No rate limiting/retry on LLM calls | HIGH | 3h | P1 |
| #7 | Message history grows unbounded | HIGH | 4h | P1 |
| #8 | `search_files` shell injection | MEDIUM | 2h | P2 |
| #9 | No TLS verification configuration | MEDIUM | 1h | P2 |
| #10 | No session isolation | MEDIUM | 4h | P2 |
| #11 | Agent prompt override by untrusted files | MEDIUM | 2h | P2 |
| #12 | No input size limits | LOW | 1h | P3 |
| #13 | No audit trail | LOW | 3h | P3 |
| #14 | No dependency scanning | LOW | 1h | P3 |
| #16 | Token counting stubbed to zero | LOW | 4h | P3 |

**Total estimated effort to address all findings**: ~38 hours
