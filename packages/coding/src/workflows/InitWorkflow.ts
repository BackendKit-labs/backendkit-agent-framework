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

// ── Prompts ───────────────────────────────────────────────────────────────────

const NEW_PROJECT_PROMPT = `
INIT WORKFLOW — NEW PROJECT

You are executing the project initialization workflow. Follow these phases STRICTLY and IN ORDER. Do NOT skip any phase.

---
PHASE 1 — Generate design and specification
Emit BOTH ask_agent calls in the same response so they run IN PARALLEL:

ask_agent "architecture":
  Read prompt.md at the project root.
  Create the file disene.md with a comprehensive architecture document. Include:
  executive summary, system components, data models, API design, tech stack with justification,
  infrastructure and deployment strategy, key architectural decisions and trade-offs.

ask_agent "backend" (simultaneously with architecture):
  Read prompt.md.
  Create especification.md with complete technical specifications. Include:
  functional requirements, API endpoints with request/response schemas,
  data models, business logic rules, integration points, non-functional requirements (performance, scalability).

---
PHASE 2 — Audit (after Phase 1 results arrive)
Emit BOTH ask_agent calls in the same response so they run IN PARALLEL:

ask_agent "qa-engineer":
  Read especification.md.
  Edit the file DIRECTLY to append a "## QA Review" section with:
  test strategy, test cases for each requirement, edge cases, acceptance criteria, quality risks.

ask_agent "security":
  Read disene.md.
  Edit the file DIRECTLY to append a "## Security Review" section with:
  authentication and authorization design, data protection, OWASP threat model, security requirements.

---
PHASE 3 — Final architectural review (after Phase 2 results arrive)
Single call:

ask_agent "architecture":
  Read disene.md and especification.md (both now audited).
  Edit disene.md DIRECTLY to incorporate security and QA findings.
  Add a "## Final Decisions" section that reconciles all inputs.
  Ensure both documents are consistent and production-ready.

---
PHASE 4 — Persist (use these tools directly, no delegation):
1. Call save_context with a concise summary of the key architectural decisions
2. Call append_log with the entry: "/init completed — disene.md + especification.md generated and audited"
`.trim();

const EXISTING_PROJECT_PROMPT = `
INIT WORKFLOW — EXISTING PROJECT

You are executing the initialization workflow for an EXISTING codebase.
Follow these phases STRICTLY and IN ORDER.

---
PHASE 1 — Explore (do this yourself before delegating)
Use list_directory (max_depth: 3) and read key files:
package.json / pyproject.toml / go.mod / README.md / main entry point.
Build a mental model of the project structure.

---
PHASE 2 — Document existing architecture and spec
Emit BOTH ask_agent calls in the same response so they run IN PARALLEL:

ask_agent "architecture":
  Explore the codebase thoroughly (list_directory + read key files).
  Create disene.md documenting the CURRENT architecture:
  system overview, component breakdown, data models, existing API design,
  tech stack (as found), infrastructure. This is reverse-engineered — document what EXISTS.

ask_agent "backend" (simultaneously):
  Explore the codebase.
  Create especification.md documenting CURRENT specifications:
  existing endpoints with schemas, data models, business logic found, integrations.
  Document what EXISTS, mark gaps as "Undocumented".

---
PHASE 3 — Audit (after Phase 2 results arrive)
Emit BOTH ask_agent calls in the same response so they run IN PARALLEL:

ask_agent "qa-engineer":
  Read especification.md.
  Edit DIRECTLY to append "## QA Findings":
  test coverage gaps, missing test scenarios, quality concerns found in the codebase.

ask_agent "security":
  Read disene.md.
  Edit DIRECTLY to append "## Security Findings":
  vulnerabilities or risks found, auth review, data protection gaps, quick wins.

---
PHASE 4 — Final review + recommendations (after Phase 3 results arrive)
Single call:

ask_agent "architecture":
  Read both documents (now audited).
  Edit disene.md DIRECTLY to incorporate audit findings.
  Add "## Recommended Improvements" section with prioritized action items.

---
PHASE 5 — Persist:
1. Call save_context with: current stack, main architecture patterns, key findings
2. Call append_log: "/init completed — existing project documented and audited"
`.trim();

const HYBRID_PROJECT_PROMPT = `
INIT WORKFLOW — HYBRID (existing project + new direction)

prompt.md describes the DESIRED direction. The codebase is the CURRENT state.
Follow these phases STRICTLY and IN ORDER.

---
PHASE 1 — Explore (do this yourself)
Read prompt.md to understand the desired direction.
Use list_directory (max_depth: 3) and read key files to understand current state.

---
PHASE 2 — Gap analysis and design
Emit BOTH ask_agent calls in the same response IN PARALLEL:

ask_agent "architecture":
  Read prompt.md AND explore the codebase.
  Create disene.md with:
  1. Current architecture (what exists)
  2. Target architecture (from prompt.md)
  3. Migration path (how to get from current to target)
  4. Tech stack decisions

ask_agent "backend" (simultaneously):
  Read prompt.md AND explore the codebase.
  Create especification.md with:
  1. Current specification (what exists)
  2. New requirements (from prompt.md)
  3. What needs to be built vs modified vs removed

---
PHASE 3 — Audit (after Phase 2)
Emit BOTH IN PARALLEL:

ask_agent "qa-engineer":
  Read especification.md. Edit DIRECTLY to append "## QA Plan":
  test strategy for new features, regression risks, acceptance criteria.

ask_agent "security":
  Read disene.md. Edit DIRECTLY to append "## Security Review":
  security impact of the migration, new attack surface, recommendations.

---
PHASE 4 — Final review:
ask_agent "architecture":
  Read both audited documents.
  Edit disene.md to finalize the migration plan incorporating all audit findings.
  Add "## Immediate Next Steps" — the first 3 things to implement.

---
PHASE 5 — Persist:
1. Call save_context: current stack, target direction, migration priorities
2. Call append_log: "/init completed — gap analysis and migration plan generated"
`.trim();
