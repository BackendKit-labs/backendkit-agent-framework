import * as fs   from 'node:fs';
import * as path from 'node:path';
import type { OrchestratorConfig } from './config.js';
import { OpenAICompatibleProvider, callLLM } from '@backendkit-labs/orchestrator-agent';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DesignArtifacts {
    specPath:    string;   // .specs/specification.md
    designPath:  string;   // .specs/design.md
    roadmapPath: string;   // .specs/ROADMAP.md
    spec:        string;
    design:      string;
    roadmap:     string;
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const SPEC_SYSTEM = `You are a senior software architect writing specification.md for a development team.
Output ONLY valid markdown — no preamble, no explanation outside the document.

Structure:
# Specification — {feature}

## Overview
Brief description of the feature and its business value.

## Functional Requirements
| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| RF-01 | ... | - criterion 1\\n- criterion 2 |
| RF-02 | ... | ... |

## Non-Functional Requirements
- Performance: ...
- Security: ...
- Scalability: ...

## Data Model
\`\`\`
Entity diagrams or field descriptions
\`\`\`

## API Design (if applicable)
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | /... | ... | required |

## Out of Scope
- Item 1
- Item 2`;

const DESIGN_SYSTEM = `You are a senior software architect writing design.md (Architecture Decision Records).
Output ONLY valid markdown — no preamble, no explanation outside the document.

Structure:
# Design — {feature}

## Architecture Overview
Brief description of the technical approach.

## Project Structure
Declare the top-level directory layout the implementation MUST follow, so each concern lives
in its own tree and frontend/backend never mix.
- Single-domain project (only backend, OR only frontend): a single \`src/\` tree.
- Full-stack project (UI + API in the same repo): SEPARATE top-level trees, e.g. \`backend/\`
  (server code) and \`frontend/\` (UI). NEVER place UI (.tsx/.jsx) inside a backend tree, nor
  server code inside a frontend tree.
- If the feature only consumes an EXISTING backend, it is frontend-only — do NOT scaffold a backend.
List each top-level directory and what it holds. The ROADMAP's file paths MUST match this layout.

## ADRs
### ADR-001: {Decision Title}
- **Status:** Accepted
- **Context:** Why this decision was needed.
- **Decision:** What was decided.
- **Consequences:** Trade-offs and implications.

### ADR-002: ...

## Component Diagram
\`\`\`
ASCII diagram of components and their relationships
\`\`\`

## Technology Decisions
| Component | Technology | Rationale |
|-----------|------------|-----------|
| ... | ... | ... |`;

const ROADMAP_SYSTEM = `You are a senior software architect writing ROADMAP.md for incremental implementation.
Output ONLY valid markdown — no preamble, no explanation outside the document.
Each phase must be implementable in a single focused LLM session (~500 lines of code max).
Each phase has ONE primary domain, and is implemented by that single specialist. If work spans
domains (e.g. an API endpoint AND its UI), SPLIT it into separate phases — never mix frontend and
backend in one phase. Use the Project Structure from design.md for every file path.

Structure:
# ROADMAP — {feature}

## Phase 1: {Title}
**Domain:** backend | frontend | infra | data    (the single specialist that implements this phase)
**Goal:** What this phase achieves.
**Files to create:**
- \`backend/src/...\` or \`frontend/src/...\` — paths MUST match the Project Structure in design.md
- \`...\` — description

**Completion criteria:**
- [ ] Specific verifiable criterion 1
- [ ] Specific verifiable criterion 2

**Dependencies:** None / Phase 1

## Phase 2: ...`;

// ── Core generation ───────────────────────────────────────────────────────────

export async function generateDesign(
    config:      OrchestratorConfig,
    projectRoot: string,
    feature:     string,
    onProgress?: (msg: string) => void,
): Promise<DesignArtifacts> {
    const provCfg = config.providers[config.orchestrator.provider];
    if (!provCfg) throw new Error(`Provider "${config.orchestrator.provider}" no configurado`);

    const provider = new OpenAICompatibleProvider(provCfg);
    const specsDir = path.join(projectRoot, '.specs');
    fs.mkdirSync(specsDir, { recursive: true });

    const log = (msg: string) => onProgress?.(`  ${msg}`);

    // ── 1. specification.md ───────────────────────────────────────────────────
    log('Generando specification.md...');
    const spec = await callLLM(
        provider,
        SPEC_SYSTEM.replaceAll('{feature}', feature),
        `Feature to specify: ${feature}\nProject root: ${projectRoot}`,
    );
    const specPath = path.join(specsDir, 'specification.md');
    fs.writeFileSync(specPath, spec, 'utf-8');
    log(`✓ specification.md (${spec.split('\n').length} líneas)`);

    // ── 2. design.md ─────────────────────────────────────────────────────────
    log('Generando design.md...');
    const design = await callLLM(
        provider,
        DESIGN_SYSTEM.replaceAll('{feature}', feature),
        `Feature: ${feature}\n\nSpecification:\n${spec}`,
    );
    const designPath = path.join(specsDir, 'design.md');
    fs.writeFileSync(designPath, design, 'utf-8');
    log(`✓ design.md (${design.split('\n').length} líneas)`);

    // ── 3. ROADMAP.md ─────────────────────────────────────────────────────────
    log('Generando ROADMAP.md...');
    const roadmap = await callLLM(
        provider,
        ROADMAP_SYSTEM.replaceAll('{feature}', feature),
        `Feature: ${feature}\n\nSpecification:\n${spec}\n\nDesign decisions:\n${design}`,
    );
    const roadmapPath = path.join(specsDir, 'ROADMAP.md');
    fs.writeFileSync(roadmapPath, roadmap, 'utf-8');
    log(`✓ ROADMAP.md (${roadmap.split('\n').length} líneas)`);

    return { specPath, designPath, roadmapPath, spec, design, roadmap };
}
