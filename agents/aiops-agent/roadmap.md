# Roadmap — AIOps Agent (CHEW-style white-box)

> **Status**: Active  
> **Last Updated**: 2026-10-19  
> **Current Phase**: Phase 4 done; 4b (vault) pending

---

## Phase 0: Specification
- [x] specification.md, design.md, security.md, roadmap.md

## Phase 1: Foundation
**Objective**: Workspace scaffold, config, types, SQLite.

### Deliverables
- [x] `agents/aiops-agent` workspace (package.json, tsconfig, jest)
- [x] `config.ts` (env), `types.ts` (zod, ActionEnum)
- [x] `db.ts` schema + idempotent seed (servers, policies, incidents)

### Definition of Done
- [x] `npm run build -w agents/aiops-agent` passes
- [x] Seed re-run does not duplicate rows

## Phase 2: Tools, Policy, Similarity
### Deliverables
- [x] `tools.ts` typed mocks via `defineTool`
- [x] `policy.ts` deterministic guard
- [x] `similar.ts` embeddings + cosine + keyword fallback; latency measured

### Definition of Done
- [x] Mock purity and guard unit tests green
- [x] Search latency <30 ms on seed (reported)

## Phase 3: Agents & Orchestrator
### Deliverables
- [x] `prompts.ts`, `agents.ts` (`OllamaProvider`, JSON validation, retry)
- [x] `orchestrator.ts` full flow, `audit.ts` JSONL

### Definition of Done
- [x] Stub-LLM `cpu99.test.ts` green: all steps logged, fields complete
- [x] Invalid JSON / out-of-enum → `needs_human`

## Phase 4: CLI & Docs
### Deliverables
- [x] `main.ts` (`--scenario cpu_99`, `--alert`), readable console summary
- [x] README: install, run, log interpretation, assumptions, white-box explanation
- [x] Real JSONL sample from live Ollama run

### Definition of Done
- [x] `npm start -- --scenario cpu_99` produces valid decision + `logs/decisions.jsonl`
- [x] Works CPU-only, no external calls

## Phase 4b: Knowledge Vault (optional, ADR-010)
### Deliverables
- [ ] `knowledge.ts` (`ObsidianRAGProvider`, read-only, `--use-vault`)
- [ ] `vault/runbooks/` with 3–4 hand-written notes (frontmatter format in spec §3.5)
- [ ] `VAULT_PATH` config; skip-and-log when vault/embedder missing

### Definition of Done
- [ ] Lookup cites `doc:<title>` in evidence; policy guard unaffected (test)
- [ ] Run without `--use-vault` or without vault behaves identically
- [ ] No `curate_*`/LLM calls from the agent (test/static check)

## Phase 5: Hardening (post-MVP)
- [ ] Hash-chained audit log (`prev_hash`)
- [ ] More scenarios (memory, disk, service down, injection)
- [ ] Optional approval prompt in CLI (`--approve`)
- [ ] Expose as MCP agent (`AgentMCPServer`) behind director-agent
- [ ] Optional FAISS/Chroma if incident base grows >10k

---

## Summary

| Phase | Focus | Est. |
|-------|-------|------|
| 1 | Foundation | 0.5 d |
| 2 | Tools/Policy/Similarity | 1 d |
| 3 | Agents/Orchestrator | 1 d |
| 4 | CLI/Docs | 0.5 d |
| 5 | Hardening | later |

## Current Status
Phases 1-4 implemented (23 tests green; live run with llama3.2:3b on CPU). Phase 4b (vault) and 5 pending.
