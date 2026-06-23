import * as fs   from 'node:fs';
import * as path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PhaseContext {
    number:   number;
    title:    string;
    criteria: string[];
}

// ── Budget constants (chars, not tokens — ~4 chars per token) ─────────────────
// Total ≈ 28,000 chars ≈ 7,000 tokens — well inside any 128k context window.
// Prioritization: spec > roadmap(current phase) > progress > relevant src files.

const BUDGET = {
    total:         28_000,
    spec:           6_000,   // full spec
    currentPhase:   2_000,   // just the current roadmap phase section
    progress:       2_500,   // .specs/progress.md (past phases summary)
    files:         15_000,   // source files — remainder after fixed sections
    perFile:        3_000,   // max per single file
};

const CODE_EXTENSIONS = ['.ts', '.js', '.py', '.java', '.go', '.rs', '.tsx', '.jsx', '.kt', '.cs', '.rb', '.php'];
const ALL_EXTENSIONS  = [...CODE_EXTENSIONS, '.json', '.yaml', '.yml', '.toml', '.env.example', '.mod', '.sum'];

// ── Low-level helpers ─────────────────────────────────────────────────────────

function readFile(filePath: string, maxChars: number): string | null {
    try {
        const c = fs.readFileSync(filePath, 'utf-8');
        if (!c.trim()) return null;
        return c.length > maxChars ? c.slice(0, maxChars) + '\n… (truncado)' : c;
    } catch { return null; }
}

function listFilesRecursive(
    dir:        string,
    extensions: string[],
    maxDepth    = 5,
    depth       = 0,
): string[] {
    if (depth > maxDepth) return [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const e of entries) {
            if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'vendor') continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) files.push(...listFilesRecursive(full, extensions, maxDepth, depth + 1));
            else if (extensions.some(x => e.name.endsWith(x))) files.push(full);
        }
        return files;
    } catch { return []; }
}

// ── 3.1: Phase-aware keyword scoring ─────────────────────────────────────────
//
// No indexing required — just score each file by how many phase keywords
// appear in its path. Fast, zero config, and surprisingly effective.

const STOP_WORDS = new Set([
    'the','a','an','and','or','with','for','of','to','in','is','are','be',
    'that','this','it','all','any','each','returns','should','must','when',
    'if','has','not','from','by','on','at','into','as','its','using','new',
]);

function extractKeywords(phase: PhaseContext): string[] {
    const text  = [phase.title, ...phase.criteria].join(' ');
    return [...new Set(
        text.toLowerCase()
            .split(/[\s,.:;()\[\]\/\\+\-_=<>!"']+/)
            .filter(w => w.length > 3 && !STOP_WORDS.has(w)),
    )];
}

function scoreFile(filePath: string, keywords: string[]): number {
    const lower = filePath.toLowerCase();
    return keywords.reduce((n, kw) => n + (lower.includes(kw) ? 1 : 0), 0);
}

// ── 3.2: Budget-aware file selection ─────────────────────────────────────────

function selectFiles(
    srcDir:   string,
    keywords: string[],
    budget:   number,
): string {
    const allFiles = listFilesRecursive(srcDir, CODE_EXTENSIONS);
    if (allFiles.length === 0) return '';

    // Sort by relevance; files with score=0 go last (still useful as context)
    const sorted = allFiles
        .map(f => ({ f, score: scoreFile(f, keywords) }))
        .sort((a, b) => b.score - a.score);

    const blocks:   string[] = [];
    const skipped:  string[] = [];
    let remaining = budget;

    for (const { f } of sorted) {
        const rel     = f.replace(srcDir + path.sep, '').replace(srcDir + '/', '');
        const content = readFile(f, BUDGET.perFile);
        if (!content) continue;
        const ext   = path.extname(f).slice(1) || 'text';
        const block = `### ${rel}\n\`\`\`${ext}\n${content}\n\`\`\``;

        if (remaining - block.length < 0) {
            skipped.push(rel);
            continue;
        }
        blocks.push(block);
        remaining -= block.length;
    }

    let result = blocks.join('\n\n');
    if (skipped.length > 0) {
        result += `\n\n_(${skipped.length} archivo(s) omitidos por presupuesto de contexto: ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ', …' : ''})_`;
    }
    return result;
}

// ── 3.3: Incremental progress summary ────────────────────────────────────────

const PROGRESS_FILE = '.specs/progress.md';

/** Append a compact summary for the completed phase to .specs/progress.md */
export function updateProgressSummary(
    projectRoot: string,
    phase:       number,
    phaseTitle:  string,
    verdict:     string,
): void {
    try {
        const progressPath = path.join(projectRoot, PROGRESS_FILE);
        fs.mkdirSync(path.dirname(progressPath), { recursive: true });

        // List files written to src/ (quick scan)
        const srcFiles = listFilesRecursive(path.join(projectRoot, 'src'), CODE_EXTENSIONS)
            .map(f => f.replace(path.join(projectRoot, 'src') + path.sep, '').replace(path.join(projectRoot, 'src') + '/', ''))
            .slice(0, 20);

        const entry = [
            `## Phase ${phase}: ${phaseTitle} (${new Date().toISOString().slice(0, 10)})`,
            `**Veredicto:** ${verdict}`,
            srcFiles.length > 0 ? `**Archivos en src/:** ${srcFiles.join(', ')}` : '',
            '',
        ].filter(l => l !== undefined).join('\n');

        // Append (or create)
        const existing = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf-8') : '# Progreso del proyecto\n\n';
        fs.writeFileSync(progressPath, existing + entry, 'utf-8');
    } catch { /* best-effort */ }
}

/** Extract only the current phase section from ROADMAP.md */
function extractCurrentPhaseSection(roadmapContent: string, phaseNumber: number): string {
    const lines   = roadmapContent.split('\n');
    const result: string[] = [];
    let   inside  = false;

    for (const line of lines) {
        const match = line.match(/^#{2,3}\s+(?:Phase|Fase)\s+(\d+)/i);
        if (match) {
            if (parseInt(match[1], 10) === phaseNumber) {
                inside = true;
                result.push(line);
            } else if (inside) {
                break; // next phase — stop
            }
        } else if (inside) {
            result.push(line);
        }
    }

    return result.join('\n').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the context string to inject into an agent's prompt.
 *
 * @param projectRoot  Root directory of the user's project.
 * @param domain       Agent domain: 'backend' | 'qa' | 'security' | 'infra'.
 * @param phase        Current phase info — enables relevance-based file selection (3.1).
 */
export function buildAgentContext(
    projectRoot: string,
    domain:      string,
    phase?:      PhaseContext,
): string {
    const specsDir  = path.join(projectRoot, '.specs');
    const srcDir    = path.join(projectRoot, 'src');
    const qaDir     = path.join(projectRoot, '.qa');

    // Shared documents (read once, reused across domains)
    const spec     = readFile(path.join(specsDir, 'specification.md'), BUDGET.spec);
    const fullRoad = (() => { try { return fs.readFileSync(path.join(specsDir, 'ROADMAP.md'), 'utf-8'); } catch { return null; } })();
    const roadmap  = (phase && fullRoad)
        ? extractCurrentPhaseSection(fullRoad, phase.number)   // only current phase
        : fullRoad?.slice(0, BUDGET.currentPhase) ?? null;

    // Progress summary (3.3) — replaces full src scan in mature projects
    const progress = readFile(path.join(projectRoot, PROGRESS_FILE), BUDGET.progress);

    // Phase keywords for file scoring (3.1)
    const keywords = phase ? extractKeywords(phase) : [];

    const sections: string[] = [];

    switch (domain) {

        case 'backend': {
            if (spec)     sections.push(`### specification.md\n${spec}`);
            if (roadmap)  sections.push(`### Fase actual (ROADMAP)\n${roadmap}`);
            if (progress) sections.push(`### Progreso previo (.specs/progress.md)\n${progress}`);

            // 3.1+3.2: phase-aware, budget-capped file selection
            const fileBudget = BUDGET.files - sections.reduce((n, s) => n + s.length, 0);
            const srcCode = selectFiles(srcDir, keywords, Math.max(fileBudget, 4000));
            if (srcCode) sections.push(`### Código existente\n${srcCode}`);
            break;
        }

        case 'qa': {
            if (spec) sections.push(`### specification.md\n${spec}`);
            const design = readFile(path.join(specsDir, 'design.md'), 4000);
            if (design) sections.push(`### design.md\n${design}`);

            // Previous QA reports (max 2, brief)
            const qaFiles = listFilesRecursive(qaDir, ['.md']).slice(0, 2);
            for (const f of qaFiles) {
                const c = readFile(f, 1500);
                if (c) sections.push(`### ${path.basename(f)}\n${c}`);
            }

            // Code to validate — relevance-sorted
            const fileBudget = BUDGET.files - sections.reduce((n, s) => n + s.length, 0);
            const srcCode = selectFiles(srcDir, keywords, Math.max(fileBudget, 4000));
            if (srcCode) sections.push(`### Código implementado\n${srcCode}`);
            break;
        }

        case 'security': {
            const fileBudget = BUDGET.files;
            const srcCode    = selectFiles(srcDir, [], fileBudget);  // security scans all
            if (srcCode) sections.push(`### Código a revisar\n${srcCode}`);

            const pkgJson = readFile(path.join(projectRoot, 'package.json'), 2000)
                         ?? readFile(path.join(projectRoot, 'go.mod'), 1000)
                         ?? readFile(path.join(projectRoot, 'requirements.txt'), 1000);
            if (pkgJson) sections.push(`### Dependencias\n${pkgJson}`);
            break;
        }

        case 'infra': {
            const pkgJson = readFile(path.join(projectRoot, 'package.json'), 1500)
                         ?? readFile(path.join(projectRoot, 'go.mod'), 1000);
            if (pkgJson) sections.push(`### Manifiesto del proyecto\n${pkgJson}`);

            // File listing to understand structure (no content needed for infra)
            const allFiles = listFilesRecursive(srcDir, ALL_EXTENSIONS).slice(0, 50);
            if (allFiles.length > 0) {
                const listing = allFiles.map(f => `- ${f.replace(srcDir + path.sep, '').replace(srcDir + '/', '')}`).join('\n');
                sections.push(`### Estructura del proyecto\n${listing}`);
            }

            if (spec) sections.push(`### specification.md (resumen)\n${spec.slice(0, 2000)}`);
            if (progress) sections.push(`### Progreso previo\n${progress}`);
            break;
        }

        default:
            if (spec) sections.push(`### specification.md\n${spec}`);
    }

    if (sections.length === 0) return '';

    const totalChars  = sections.reduce((n, s) => n + s.length, 0);
    const phaseLabel  = phase ? ` — Fase ${phase.number}: ${phase.title}` : '';
    const statsLine   = `_(contexto: ${(totalChars / 1000).toFixed(1)}k chars | ${sections.length} secciones)_`;

    return `\n---\n## Contexto del proyecto (${domain}${phaseLabel})\n${statsLine}\n\n${sections.join('\n\n')}\n---\n`;
}
