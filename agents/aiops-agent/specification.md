# Specification Document — AIOps Agent (CHEW-style white-box)

> **Status**: Draft  
> **Last Updated**: 2026-10-19  
> **Version**: 0.1.0

---

## 1. Data Models

### 1.1 Closed action catalog

```typescript
const ActionEnum = z.enum([
  'restart_service', 'scale_cpu', 'open_ticket', 'update_ticket',
  'escalate', 'no_action', 'needs_human',
]);
type Action = z.infer<typeof ActionEnum>;
```

Any model output outside this enum is rejected and coerced to `needs_human`.

### 1.2 Alert

```typescript
interface Alert {
  id: string;            // uuid or scenario id
  source: string;        // monitoring system name
  text: string;          // "Servidor prod-01 caído por CPU al 99%"
  receivedAt: string;    // ISO-8601
  server?: string;       // extracted host, optional
}
```

### 1.3 Classification

```typescript
interface Classification {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'cpu' | 'memory' | 'disk' | 'network' | 'service_down' | 'other';
  server: string | null;
  summary: string;       // <= 200 chars
  confidence: number;    // 0..1
}
```

### 1.4 Decision (decider output, validated by zod)

```typescript
interface Decision {
  action: Action;
  toolArgs: Record<string, unknown>;
  justification: string[];   // 3..5 technical bullets, evidence-based
  evidenceRefs: string[];    // ids: server:prod-01, policy:P-02, incident:INC-014
  confidence: number;        // 0..1
  riskLevel: 'low' | 'medium' | 'high';
}
```

### 1.5 SQLite schema (local file, `data/aiops.db`)

| Table | Columns |
|-------|---------|
| `servers` | name PK, env (prod/stg/dev), criticality (low/med/high), cpu_pct, mem_pct, status, services JSON, autoscale INTEGER, updated_at |
| `policies` | id PK, description, applies_env, applies_category, max_severity_autonomous, allowed_actions JSON, requires_approval INTEGER |
| `incidents` | id PK, title, category, server, resolution_action, outcome, text, embedding BLOB (float32) |
| `tickets` | id PK, alert_id, title, status, body, created_at, updated_at (simulated) |

Seed is idempotent (`INSERT OR IGNORE`).

### 1.6 AuditEvent (one JSONL line per step)

Minimum fields: `timestamp, alert_id, step, agent, input_summary, analysis_summary, evidence, policy_check, selected_tool, tool_args, justification, confidence, risk_level, requires_approval, tool_result, final_decision`. Non-applicable fields are `null` (never omitted) so lines are uniform.

```json
{"timestamp":"...","alert_id":"cpu_99","step":"policy_check","agent":"orchestrator",
 "input_summary":"...","analysis_summary":"...","evidence":["policy:P-02"],
 "policy_check":{"policy_id":"P-02","allowed":["scale_cpu","escalate"],"passed":true},
 "selected_tool":null,"tool_args":null,"justification":null,"confidence":null,
 "risk_level":"high","requires_approval":true,"tool_result":null,"final_decision":null}
```

`step` ∈ `received | classify | server_status | policy_check | similar_incidents | knowledge_lookup | decide | policy_guard | tool_exec | final`. (`knowledge_lookup` solo con `--use-vault`.)

---

## 2. Tool Contracts (mocks, zod-typed, via `defineTool`)

| Tool | Input | Output | Side effects |
|------|-------|--------|--------------|
| `get_server_status` | `{server}` | `{found, env, criticality, cpu_pct, mem_pct, status, services[], autoscale}` | read-only SQLite |
| `search_similar_incidents` | `{query, k<=5}` | `{matches:[{id,score,resolution_action,outcome}], latency_ms}` | read-only |
| `upsert_ticket` (open/update) | `{alert_id, title?, ticket_id?, body}` | `{ticket_id, status:"simulated"}` | row in simulated `tickets` table only |
| `restart_service` | `{server, service}` | `{status:"simulated", message}` | none |
| `scale_cpu` | `{server, delta_vcpu<=4}` | `{status:"simulated"}` | none |
| `escalate` | `{reason, severity}` | `{status:"simulated", ticket_ref}` | none |

Rules: a missing/unknown tool or missing required info returns `{status:"needs_human", reason}`. No tool shells out, calls the network (except local Ollama), or touches files outside `data/` and `logs/`.

---

## 3. Agent Communication Protocol

### 3.1 Agents

| Agent | Role | Model use |
|-------|------|-----------|
| `ClassifierAgent` | alert → `Classification` | Ollama, JSON-only output |
| `DeciderAgent` | evidence → `Decision` | Ollama, JSON-only output, action ∈ enum |
| `Orchestrator` | owns flow, policy guard, tool execution, audit | deterministic code |

The LLM never calls tools: it only returns JSON. The orchestrator executes the chosen tool after the deterministic policy guard.

### 3.2 Flow

```
received → classify → server_status → policy_check → similar_incidents
        → [knowledge_lookup] → decide → policy_guard → tool_exec → final
```

`knowledge_lookup` is optional (`--use-vault`) — see §3.5.

### 3.5 Knowledge lookup (optional, advisory)

- Source: local Markdown vault (`VAULT_PATH`, default `./vault`), searched with `ObsidianRAGProvider` (local embeddings, Transformers.js). Read-only; never calls `curate_*` or any LLM.
- Query: classification summary + category. `topK<=3`. Output `{notes:[{title,path,relevance}], latency_ms}`.
- Results appear in `evidence` as `doc:<title>` and may be cited in `justification`; they are passed to the decider as untrusted context and **never** to the policy guard.
- Missing vault / embedder / timeout → step skipped, event with `analysis_summary:"skipped: <reason>"`; flow continues.
- Note format (hand-written, no LLM): Markdown with frontmatter `title, area, tipo, resumen, tags, aplica_a, source_ref` under `vault/runbooks/`. Index with `reindex_vault`/`indexVault()`.

### 3.3 Policy guard (deterministic)

1. Load applicable policies by `env` + `category`.
2. If `decision.action ∉ allowed_actions` → replace with `needs_human`, log `policy_check.passed=false`.
3. If `severity > max_severity_autonomous` or `criticality=high` or `requires_approval` → `requires_approval=true`; autonomous execution of write-like actions is replaced by `escalate`/`needs_human`.
4. Server not found in SQLite → `needs_human`.
5. P-06: `scale_cpu` only if cpu>=80% (else `no_action` if status ok, otherwise `needs_human`).
6. When `requires_approval` and the action mutates infra, the mock runs in dry-run (`tool_result.status="pending_approval"`) instead of being replaced.
7. Deterministic corrections (ADR-011): severity can only be raised from inventory facts; category corrected when exactly one resource keyword appears in the text. Each is noted in the event.

### 3.4 LLM output handling

Parse JSON (strip fences) → zod validate → on failure 1 retry with error feedback → on second failure `needs_human` with `analysis_summary` explaining parse failure. LLM calls: temperature 0, timeout and retry via `@backendkit-labs/retry` (HTTP resilience).

---

## 4. Business Rules (seed policies)

| ID | Rule |
|----|------|
| P-01 | `restart_service` allowed only on non-critical servers in dev/stg; in prod needs approval |
| P-02 | prod + category=cpu: allowed `scale_cpu` (if autoscale) or `escalate`; never autonomous restart if criticality=high |
| P-03 | severity=critical in prod always `requires_approval` |
| P-04 | No info about server → `needs_human` |
| P-05 | `no_action` allowed when cpu_pct < 80 and status=ok (false alarm) |

Mandatory scenario `cpu_99`: "Servidor prod-01 caído por CPU al 99%" with prod-01 = prod, criticality high, autoscale=1 → expected decision `scale_cpu` (or `escalate`), `requires_approval=true`, never `restart_service`.

---

## 5. Error Handling

| Failure | Behavior |
|---------|----------|
| Ollama unreachable | clear error with `ollama serve` hint; exit code 2; no fake decision |
| Invalid JSON from model (x2) | `needs_human` |
| Action outside enum | `needs_human`, event notes rejected value |
| Embedder unavailable | keyword (token overlap) fallback, flagged in evidence |
| SQLite error | `needs_human`, error logged in event |
| JSONL write error | surfaced to stderr; run fails (audit is mandatory) |

---

## 6. Testing Strategy

- Jest + ts-jest, injected stub `LLMProvider` (deterministic JSON) → no Ollama needed in CI.
- `cpu99.test.ts`: decision ∈ enum; every flow step logged with all minimum fields; JSONL file written; `requires_approval=true`; tool_result.status simulated.
- Guard tests: action outside enum → `needs_human`; disallowed action by policy → downgraded; unknown server → `needs_human`; invalid JSON twice → `needs_human`.
- Mock purity test: tools do not write outside `tickets` table.
- Similarity test: latency measured; assert <30 ms on seed (vectors in memory, query embedding stubbed).
- Optional live smoke (manual, Ollama required): `npm start -- --scenario cpu_99`.
