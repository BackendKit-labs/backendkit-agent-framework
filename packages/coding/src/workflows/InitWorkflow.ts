import { existsSync } from 'fs';
import { join } from 'path';

export type InitMode = 'new' | 'existing' | 'hybrid';

const CODE_MARKERS = [
    'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml',
    'pom.xml', 'composer.json', 'Gemfile', 'mix.exs',
];
const SRC_DIRS = ['src', 'lib', 'app', 'pkg', 'cmd', 'api'];

function hasSourceCode(cwd: string): boolean {
    if (CODE_MARKERS.some(f => existsSync(join(cwd, f)))) return true;
    return SRC_DIRS.some(d => existsSync(join(cwd, d)));
}

export class InitWorkflow {
    static detectMode(cwd: string): InitMode {
        const hasPrompt = existsSync(join(cwd, 'prompt.md'));
        const hasCode   = hasSourceCode(cwd);
        if (hasPrompt && !hasCode) return 'new';
        if (!hasPrompt && hasCode)  return 'existing';
        return 'hybrid';
    }

    static buildPrompt(cwd: string, mode?: InitMode): string {
        const resolved = mode ?? this.detectMode(cwd);
        switch (resolved) {
            case 'new':      return NEW_PROJECT_PROMPT;
            case 'existing': return EXISTING_PROJECT_PROMPT;
            case 'hybrid':   return HYBRID_PROJECT_PROMPT;
        }
    }
}

// ── Shared rules injected into every prompt ───────────────────────────────────

const FILE_RULES = `
CRITICAL — FILE OPERATION RULES (MANDATORY):
- To CREATE a new file: use the write_file tool
- To APPEND or MODIFY an existing file: use the edit_file tool
- To READ a file: use the read_file tool
- NEVER use run_command for any file operation (no cat, echo, tail, sed, awk, etc.)
- Write large documents in multiple small edit_file calls — NOT one huge write_file
`.trim();

// ── Output file set (same across all modes) ───────────────────────────────────
//
//  design.md         — current architecture (concise, stable)
//  specification.md  — API contracts and data models
//  security.md       — security findings and requirements (grows with audits)
//  roadmap.md        — phases, priorities, current status (living document)
//  AGENT.md          — operational instructions injected into every agent session

// ── Prompts ───────────────────────────────────────────────────────────────────

const NEW_PROJECT_PROMPT = `
INIT WORKFLOW — NEW PROJECT

You are executing the project initialization workflow.
Follow these phases STRICTLY and IN ORDER. Do NOT skip any phase.

${FILE_RULES}

---
PHASE 1 — Generate design and specification
Emit BOTH ask_agent calls in the same response so they run IN PARALLEL:

ask_agent "architecture":
  1. Use read_file to read prompt.md at the project root.
  2. Use write_file to CREATE design.md with skeleton headers only (no content yet):
     # Design — [Project Name]
     ## Overview
     ## Components
     ## Data Models
     ## API Design
     ## Tech Stack
     ## Infrastructure
     ## Key Decisions
  3. Use edit_file to fill each section ONE AT A TIME.

ask_agent "backend" (simultaneously):
  1. Use read_file to read prompt.md.
  2. Use write_file to CREATE specification.md with skeleton headers only:
     # Specification — [Project Name]
     ## Functional Requirements
     ## API Endpoints
     ## Data Models
     ## Business Logic
     ## Integrations
     ## Non-functional Requirements
  3. Use edit_file to fill each section ONE AT A TIME.

---
PHASE 2 — Security and QA audit (after Phase 1 — WAIT for both files)
Emit BOTH ask_agent calls in the same response IN PARALLEL:

ask_agent "security":
  1. Use read_file to read design.md.
  2. Use read_file to read specification.md.
  3. Use write_file to CREATE security.md with skeleton headers only:
     # Security — [Project Name]
     ## Threat Model
     ## Authentication & Authorization
     ## Data Protection
     ## Input Validation
     ## OWASP Checklist
     ## Security Requirements
  4. Use edit_file to fill each section ONE AT A TIME.
  IMPORTANT: CREATE security.md as a NEW file — do NOT append to design.md.

ask_agent "qa-engineer" (simultaneously):
  1. Use read_file to read specification.md.
  2. Use edit_file to APPEND a "## QA Review" section to specification.md with:
     test strategy, test cases per requirement, edge cases, acceptance criteria.

---
PHASE 3 — Roadmap (after Phase 2 results arrive)
Single call:

ask_agent "architecture":
  1. Use read_file to read design.md, specification.md, security.md.
  2. Use write_file to CREATE roadmap.md with skeleton headers only:
     # Roadmap — [Project Name]
     ## Current Status
     ## Phase 1 — [Name]
     ## Phase 2 — [Name]
     ## Phase 3 — [Name]
     ## Deferred / Out of Scope
  3. Use edit_file to fill each section ONE AT A TIME.
     Each phase must include: objective, responsible agent, tasks checklist, definition of done.
  IMPORTANT: CREATE roadmap.md as a NEW file — do NOT append to design.md.

---
PHASE 4 — AGENT.md (after Phase 3)
You do this yourself (no delegation):
Use write_file to CREATE AGENT.md with this exact structure:

# AGENT.md — [Project Name]

## Commands
- Build: [detected from package.json / Makefile / etc, or "TODO"]
- Test: [detected or "TODO"]
- Dev: [detected or "TODO"]
- Lint: [detected or "TODO"]

## Stack
[One-line summary: language, framework, database, infra]

## Architecture
[2-3 sentences describing the main layers and their responsibilities]

## Conventions
- [Key conventions found or inferred from prompt.md]
- [Naming patterns, folder structure rules]

## Do NOT touch
- [Files or folders that should not be modified]

## Current phase
[Phase 1 from roadmap.md — copy the objective here]

## Key documents
- design.md — architecture and key decisions
- specification.md — API contracts and data models
- security.md — security requirements and findings
- roadmap.md — phases and current status

---
PHASE 5 — Persist (use these tools directly, no delegation):
1. Call save_context with this exact format:
   ## Project: [name]
   Stack: [one line]
   Mode: new project

   ## Documents
   - design.md — architecture ([N] sections)
   - specification.md — [N] endpoints documented
   - security.md — [N] security requirements
   - roadmap.md — [N] phases, currently Phase 1
   - AGENT.md — operational instructions

   ## Current phase
   [copy Phase 1 objective from roadmap.md]

`.trim();

const EXISTING_PROJECT_PROMPT = `
INIT WORKFLOW — EXISTING PROJECT

You are executing the initialization workflow for an EXISTING codebase.
Follow these phases STRICTLY and IN ORDER.

${FILE_RULES}

---
PHASE 1 — Explore (do this yourself before delegating)
Use list_directory (max_depth: 3) and read_file for key files:
package.json / pyproject.toml / go.mod / README.md / main entry point.
Build a mental model of the project structure, stack, and entry points.

---
PHASE 2 — Document architecture and spec
Emit BOTH ask_agent calls in the same response IN PARALLEL:

ask_agent "architecture":
  1. Explore the codebase (list_directory + read_file for key files).
  2. Use write_file to CREATE design.md with skeleton headers only:
     # Design — [Project Name]
     ## Overview
     ## Components
     ## Data Models
     ## API Design
     ## Tech Stack
     ## Infrastructure
     ## Key Decisions
  3. Use edit_file to fill each section ONE AT A TIME.
     Document what EXISTS — reverse-engineered from the codebase.

ask_agent "backend" (simultaneously):
  1. Explore the codebase (list_directory + read_file).
  2. Use write_file to CREATE specification.md with skeleton headers only:
     # Specification — [Project Name]
     ## Endpoints
     ## Data Models
     ## Business Logic
     ## Integrations
     ## Non-functional Requirements
  3. Use edit_file to fill each section ONE AT A TIME.
     Mark undocumented gaps as "Undocumented".

---
PHASE 3 — Security and QA audit (after Phase 2 — WAIT for both files)
Emit BOTH ask_agent calls in the same response IN PARALLEL:

ask_agent "security":
  1. Use read_file to read design.md and specification.md.
  2. Use write_file to CREATE security.md with skeleton headers only:
     # Security — [Project Name]
     ## Findings (prioritized P0–P3)
     ## Authentication & Authorization Review
     ## Data Protection Gaps
     ## Quick Wins
     ## Security Requirements
  3. Use edit_file to fill each section ONE AT A TIME.
  IMPORTANT: CREATE security.md as a NEW file — do NOT append to design.md.

ask_agent "qa-engineer" (simultaneously):
  1. Use read_file to read specification.md.
  2. Use edit_file to APPEND a "## QA Findings" section to specification.md with:
     test coverage gaps, missing scenarios, quality concerns, recommendations.

---
PHASE 4 — Roadmap (after Phase 3 results arrive)
Single call:

ask_agent "architecture":
  1. Use read_file to read design.md, specification.md, security.md.
  2. Use write_file to CREATE roadmap.md with skeleton headers only:
     # Roadmap — [Project Name]
     ## Current Status
     ## Phase 1 — [Name] (recommended first priority)
     ## Phase 2 — [Name]
     ## Phase 3 — [Name]
     ## Deferred / Out of Scope
  3. Use edit_file to fill each section ONE AT A TIME.
     Prioritize security P0/P1 findings. Each phase: objective, agent, tasks, definition of done.
  IMPORTANT: CREATE roadmap.md as a NEW file — do NOT append to design.md.

---
PHASE 5 — AGENT.md (after Phase 4)
You do this yourself (no delegation):
Use write_file to CREATE AGENT.md with this exact structure:

# AGENT.md — [Project Name]

## Commands
- Build: [detected from package.json / Makefile / etc]
- Test: [detected]
- Dev: [detected]
- Lint: [detected]

## Stack
[One-line summary: language, framework, database, infra]

## Architecture
[2-3 sentences describing the main layers and their responsibilities]

## Conventions
- [Key conventions observed in the codebase]
- [Naming patterns, folder structure, coding style]

## Do NOT touch
- [Files or folders observed as sensitive/legacy/generated]

## Current phase
[Phase 1 from roadmap.md — copy the objective here]

## Key documents
- design.md — architecture (reverse-engineered)
- specification.md — API contracts and data models
- security.md — security findings and requirements
- roadmap.md — phases and current status

---
PHASE 6 — Persist (use these tools directly, no delegation):
1. Call save_context with this exact format:
   ## Project: [name]
   Stack: [one line]
   Mode: existing project

   ## Documents
   - design.md — architecture ([N] sections)
   - specification.md — [N] endpoints documented
   - security.md — [N] findings (list P0 count)
   - roadmap.md — [N] phases, currently Phase 1
   - AGENT.md — operational instructions

   ## Current phase
   [copy Phase 1 objective from roadmap.md]

`.trim();

const HYBRID_PROJECT_PROMPT = `
INIT WORKFLOW — HYBRID (existing project + new direction)

prompt.md describes the DESIRED direction. The codebase is the CURRENT state.
Follow these phases STRICTLY and IN ORDER.

${FILE_RULES}

---
PHASE 1 — Explore (do this yourself)
Use read_file to read prompt.md (desired direction).
Use list_directory (max_depth: 3) and read_file for key files (current state).

---
PHASE 2 — Gap analysis: design and spec
Emit BOTH ask_agent calls in the same response IN PARALLEL:

ask_agent "architecture":
  1. Use read_file to read prompt.md and explore the codebase.
  2. Use write_file to CREATE design.md with skeleton headers only:
     # Design — [Project Name]
     ## Current Architecture
     ## Target Architecture
     ## Migration Path
     ## Tech Stack Decisions
     ## Key Decisions
  3. Use edit_file to fill each section ONE AT A TIME.

ask_agent "backend" (simultaneously):
  1. Use read_file to read prompt.md and explore the codebase.
  2. Use write_file to CREATE specification.md with skeleton headers only:
     # Specification — [Project Name]
     ## Current State
     ## New Requirements
     ## Build vs Modify vs Remove
     ## API Changes
     ## Data Model Changes
  3. Use edit_file to fill each section ONE AT A TIME.

---
PHASE 3 — Security and QA audit (after Phase 2 — WAIT for both files)
Emit BOTH ask_agent calls in the same response IN PARALLEL:

ask_agent "security":
  1. Use read_file to read design.md and specification.md.
  2. Use write_file to CREATE security.md with skeleton headers only:
     # Security — [Project Name]
     ## Migration Security Impact
     ## New Attack Surface
     ## Existing Findings
     ## Security Requirements for New Features
  3. Use edit_file to fill each section ONE AT A TIME.
  IMPORTANT: CREATE security.md as a NEW file — do NOT append to design.md.

ask_agent "qa-engineer" (simultaneously):
  1. Use read_file to read specification.md.
  2. Use edit_file to APPEND a "## QA Plan" section to specification.md with:
     test strategy for new features, regression risks, acceptance criteria.

---
PHASE 4 — Roadmap (after Phase 3 results arrive)
Single call:

ask_agent "architecture":
  1. Use read_file to read design.md, specification.md, security.md.
  2. Use write_file to CREATE roadmap.md with skeleton headers only:
     # Roadmap — [Project Name]
     ## Current Status
     ## Immediate Next Steps
     ## Phase 1 — [Name]
     ## Phase 2 — [Name]
     ## Phase 3 — [Name]
     ## Deferred / Out of Scope
  3. Use edit_file to fill each section ONE AT A TIME.
  IMPORTANT: CREATE roadmap.md as a NEW file — do NOT append to design.md.

---
PHASE 5 — AGENT.md (after Phase 4)
You do this yourself (no delegation):
Use write_file to CREATE AGENT.md with this exact structure:

# AGENT.md — [Project Name]

## Commands
- Build: [detected]
- Test: [detected]
- Dev: [detected]
- Lint: [detected]

## Stack
[One-line summary: current stack + target changes]

## Architecture
[2-3 sentences: current state and migration direction]

## Conventions
- [Key conventions observed in the codebase]

## Do NOT touch
- [Files or folders that are sensitive/legacy/generated]

## Current phase
[Immediate Next Steps from roadmap.md]

## Key documents
- design.md — current + target architecture and migration path
- specification.md — current spec + new requirements
- security.md — security impact of migration
- roadmap.md — phases and migration priorities

---
PHASE 6 — Persist (use these tools directly, no delegation):
1. Call save_context with this exact format:
   ## Project: [name]
   Stack: [current] → [target]
   Mode: hybrid (migration)

   ## Documents
   - design.md — current + target architecture
   - specification.md — [N] endpoints, [N] new requirements
   - security.md — security impact documented
   - roadmap.md — [N] phases, immediate next steps defined
   - AGENT.md — operational instructions

   ## Current phase
   [copy Immediate Next Steps from roadmap.md]

`.trim();
