import * as fs   from 'node:fs';
import * as path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoadmapPhase {
    number:   number;     // 1-indexed phase number
    title:    string;     // "Core Authentication"
    body:     string;     // full markdown body of the phase (goal, files, criteria)
    criteria: string[];   // extracted completion criteria (checkbox items)
}

// ── Parser ────────────────────────────────────────────────────────────────────

// Matches: "## Phase 1: Title", "## Phase 1 — Title", "## Fase 1: Title", "### Phase 1"
const PHASE_HEADER = /^#{2,3}\s+(?:Phase|Fase)\s+(\d+)\s*[:\-—.]?\s*(.*)$/i;
// Matches checkbox criteria: "- [ ] criterion" or "- [x] criterion"
const CRITERION    = /^\s*[-*]\s+\[[ xX]?\]\s+(.+)$/;

/**
 * Parses a ROADMAP.md content string into ordered phases.
 * Each phase spans from its "## Phase N" header to the next header (or EOF).
 */
export function parseRoadmap(content: string): RoadmapPhase[] {
    const lines  = content.split('\n');
    const phases: RoadmapPhase[] = [];

    let current: { number: number; title: string; bodyLines: string[] } | null = null;

    for (const line of lines) {
        const header = PHASE_HEADER.exec(line);
        if (header) {
            // flush previous phase
            if (current) phases.push(finalize(current));
            current = {
                number: parseInt(header[1], 10),
                title:  header[2].trim() || `Phase ${header[1]}`,
                bodyLines: [],
            };
        } else if (current) {
            current.bodyLines.push(line);
        }
    }
    if (current) phases.push(finalize(current));

    // Sort by phase number and re-number sequentially (1..N) to be safe
    phases.sort((a, b) => a.number - b.number);
    return phases.map((p, i) => ({ ...p, number: i + 1 }));
}

function finalize(c: { number: number; title: string; bodyLines: string[] }): RoadmapPhase {
    const body     = c.bodyLines.join('\n').trim();
    const criteria: string[] = [];
    for (const line of c.bodyLines) {
        const m = CRITERION.exec(line);
        if (m) criteria.push(m[1].trim());
    }
    return { number: c.number, title: c.title, body, criteria };
}

/**
 * Loads and parses ROADMAP.md from a project's .specs directory.
 * Returns empty array if the file doesn't exist or has no phases.
 */
export function loadRoadmapPhases(projectRoot: string): RoadmapPhase[] {
    const candidates = [
        path.join(projectRoot, '.specs', 'ROADMAP.md'),
        path.join(projectRoot, '.specs', 'roadmap.md'),
        path.join(projectRoot, 'ROADMAP.md'),
        path.join(projectRoot, 'roadmap.md'),
    ];
    for (const file of candidates) {
        try {
            const content = fs.readFileSync(file, 'utf-8');
            const phases  = parseRoadmap(content);
            if (phases.length > 0) return phases;
        } catch { /* try next */ }
    }
    return [];
}
