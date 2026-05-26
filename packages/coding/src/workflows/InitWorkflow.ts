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

CRITICAL — FILE OPERATION RULES (MANDATORY):
- To CREATE a new file: use the write_file tool
- To APPEND or MODIFY an existing file: use the edit_file tool
- To READ a file: use the read_file tool
- NEVER use run_command for any file operation (no cat, echo, tail, sed, awk, etc.)

---
PHASE 1 — Generate design and specification
Emit BOTH ask_agent calls in the same response so they run IN PARALLEL:

ask_agent "architecture":
  1. Use read_file to read prompt.md at the project root.
  2. Use write_file to CREATE disene.md with a skeleton: title + section headers only (no content yet).
     Sections: Executive Summary, Components, Data Models, API Design, Tech Stack, Infrastructure, Key Decisions.
  3. Use edit_file to APPEND the full content of each section ONE AT A TIME to disene.md.
     Write each section separately — first Executive Summary, then Components, etc.
  IMPORTANT: Write in multiple small edit_file calls — NOT one huge write_file. Do NOT use run_command.

ask_agent "backend" (simultaneously with architecture):
  1. Use read_file to read prompt.md.
  2. Use write_file to CREATE especification.md with a skeleton: title + section headers only (no content yet).
     Sections: Functional Requirements, API Endpoints, Data Models, Business Logic, Integrations, Non-functional Requirements.
  3. Use edit_file to APPEND the full content of each section ONE AT A TIME to especification.md.
     Write each section separately.
  IMPORTANT: Write in multiple small edit_file calls — NOT one huge write_file. Do NOT use run_command.

---
PHASE 2 — Audit (after Phase 1 results arrive — WAIT for both files to exist)
Emit BOTH ask_agent calls in the same response so they run IN PARALLEL:

ask_agent "qa-engineer":
  1. Use read_file to read especification.md.
  2. Use edit_file to APPEND a "## QA Review" section to especification.md with:
     test strategy, test cases for each requirement, edge cases, acceptance criteria, quality risks.
  IMPORTANT: Use edit_file to append — do NOT use run_command.

ask_agent "security":
  1. Use read_file to read disene.md.
  2. Use edit_file to APPEND a "## Security Review" section to disene.md with:
     authentication and authorization design, data protection, OWASP threat model, security requirements.
  IMPORTANT: Use edit_file to append — do NOT use run_command.

---
PHASE 3 — Final architectural review (after Phase 2 results arrive)
Single call:

ask_agent "architecture":
  1. Use read_file to read disene.md.
  2. Use read_file to read especification.md.
  3. Use edit_file to APPEND a "## Final Decisions" section to disene.md that reconciles all inputs.
  IMPORTANT: Use edit_file to append — do NOT use run_command.

---
PHASE 4 — Persist (use these tools directly, no delegation):
1. Call save_context with a concise summary of the key architectural decisions
2. Call append_log with the entry: "/init completed — disene.md + especification.md generated and audited"
`.trim();

const EXISTING_PROJECT_PROMPT = `
INIT WORKFLOW — EXISTING PROJECT

You are executing the initialization workflow for an EXISTING codebase.
Follow these phases STRICTLY and IN ORDER.

CRITICAL — FILE OPERATION RULES (MANDATORY):
- To CREATE a new file: use the write_file tool
- To APPEND or MODIFY an existing file: use the edit_file tool
- To READ a file: use the read_file tool
- NEVER use run_command for any file operation (no cat, echo, tail, sed, awk, etc.)

---
PHASE 1 — Explore (do this yourself before delegating)
Use list_directory (max_depth: 3) and use read_file for key files:
package.json / pyproject.toml / go.mod / README.md / main entry point.
Build a mental model of the project structure.

---
PHASE 2 — Document existing architecture and spec
Emit BOTH ask_agent calls in the same response so they run IN PARALLEL:

ask_agent "architecture":
  1. Explore the codebase thoroughly (list_directory + read_file for key files).
  2. Use write_file to CREATE disene.md with a skeleton: title + section headers only (no content yet).
     Sections: Overview, Components, Data Models, API Design, Tech Stack, Infrastructure.
  3. Use edit_file to APPEND the full content of each section ONE AT A TIME to disene.md.
     Write each section separately: first Overview, then Components, then Data Models, etc.
  IMPORTANT: Write in multiple small edit_file calls — NOT one huge write_file. Do NOT use run_command.

ask_agent "backend" (simultaneously):
  1. Use list_directory and read_file to explore the codebase.
  2. Use write_file to CREATE especification.md with a skeleton: title + section headers only (no content yet).
     Sections: Endpoints, Data Models, Business Logic, Integrations, Non-functional Requirements.
  3. Use edit_file to APPEND the full content of each section ONE AT A TIME to especification.md.
     Write each section separately, mark gaps as "Undocumented".
  IMPORTANT: Write in multiple small edit_file calls — NOT one huge write_file. Do NOT use run_command.

---
PHASE 3 — Audit (after Phase 2 results arrive — WAIT for both files to exist)
Emit BOTH ask_agent calls in the same response so they run IN PARALLEL:

ask_agent "qa-engineer":
  1. Use read_file to read especification.md.
  2. Use edit_file to APPEND a "## QA Findings" section to especification.md with:
     test coverage gaps, missing test scenarios, quality concerns found in the codebase.
  IMPORTANT: Use edit_file to append — do NOT use run_command.

ask_agent "security":
  1. Use read_file to read disene.md.
  2. Use edit_file to APPEND a "## Security Findings" section to disene.md with:
     vulnerabilities or risks found, auth review, data protection gaps, quick wins.
  IMPORTANT: Use edit_file to append — do NOT use run_command.

---
PHASE 4 — Final review + recommendations (after Phase 3 results arrive)
Single call:

ask_agent "architecture":
  1. Use read_file to read disene.md.
  2. Use read_file to read especification.md.
  3. Use edit_file to APPEND a "## Recommended Improvements" section to disene.md
     with prioritized action items incorporating all audit findings.
  IMPORTANT: Use edit_file to append — do NOT use run_command.

---
PHASE 5 — Persist:
1. Call save_context with: current stack, main architecture patterns, key findings
2. Call append_log: "/init completed — existing project documented and audited"
`.trim();

const HYBRID_PROJECT_PROMPT = `
INIT WORKFLOW — HYBRID (existing project + new direction)

prompt.md describes the DESIRED direction. The codebase is the CURRENT state.
Follow these phases STRICTLY and IN ORDER.

CRITICAL — FILE OPERATION RULES (MANDATORY):
- To CREATE a new file: use the write_file tool
- To APPEND or MODIFY an existing file: use the edit_file tool
- To READ a file: use the read_file tool
- NEVER use run_command for any file operation (no cat, echo, tail, sed, awk, etc.)

---
PHASE 1 — Explore (do this yourself)
Use read_file to read prompt.md to understand the desired direction.
Use list_directory (max_depth: 3) and read_file for key files to understand current state.

---
PHASE 2 — Gap analysis and design
Emit BOTH ask_agent calls in the same response IN PARALLEL:

ask_agent "architecture":
  1. Use read_file to read prompt.md.
  2. Use list_directory and read_file to explore the codebase.
  3. Use write_file to CREATE disene.md with a skeleton: title + section headers only (no content yet).
     Sections: Current Architecture, Target Architecture, Migration Path, Tech Stack Decisions.
  4. Use edit_file to APPEND the full content of each section ONE AT A TIME to disene.md.
  IMPORTANT: Write in multiple small edit_file calls — NOT one huge write_file. Do NOT use run_command.

ask_agent "backend" (simultaneously):
  1. Use read_file to read prompt.md.
  2. Use list_directory and read_file to explore the codebase.
  3. Use write_file to CREATE especification.md with a skeleton: title + section headers only (no content yet).
     Sections: Current Specification, New Requirements, Build vs Modify vs Remove.
  4. Use edit_file to APPEND the full content of each section ONE AT A TIME to especification.md.
  IMPORTANT: Write in multiple small edit_file calls — NOT one huge write_file. Do NOT use run_command.

---
PHASE 3 — Audit (after Phase 2 results arrive — WAIT for both files to exist)
Emit BOTH IN PARALLEL:

ask_agent "qa-engineer":
  1. Use read_file to read especification.md.
  2. Use edit_file to APPEND a "## QA Plan" section to especification.md with:
     test strategy for new features, regression risks, acceptance criteria.
  IMPORTANT: Use edit_file to append — do NOT use run_command.

ask_agent "security":
  1. Use read_file to read disene.md.
  2. Use edit_file to APPEND a "## Security Review" section to disene.md with:
     security impact of the migration, new attack surface, recommendations.
  IMPORTANT: Use edit_file to append — do NOT use run_command.

---
PHASE 4 — Final review:
ask_agent "architecture":
  1. Use read_file to read disene.md.
  2. Use read_file to read especification.md.
  3. Use edit_file to APPEND a "## Immediate Next Steps" section to disene.md
     with the first 3 things to implement, incorporating all audit findings.
  IMPORTANT: Use edit_file to append — do NOT use run_command.

---
PHASE 5 — Persist:
1. Call save_context: current stack, target direction, migration priorities
2. Call append_log: "/init completed — gap analysis and migration plan generated"
`.trim();
