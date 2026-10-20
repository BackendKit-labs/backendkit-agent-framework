import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type CodexEvent =
    // Curación de paths
    | 'curate.file.done'
    | 'curate.file.skipped'
    | 'curate.file.failed'
    | 'curate.dir.start'
    | 'curate.dir.done'
    | 'curate.dir.failed'
    // Curación de links
    | 'curate.git.start'
    | 'curate.git.done'
    | 'curate.git.failed'
    | 'curate.http.done'
    | 'curate.http.failed'
    // Lectura
    | 'vault.search'
    | 'note.read'
    | 'note.read.failed'
    // Operaciones de vault
    | 'vault.clone.done'
    | 'vault.reindex'
    | 'vault.reset'
    | 'vault.prune_orphans'
    // Infraestructura
    | 'embedder.init';

export interface CodexAuditEntry {
    ts:          string;              // ISO 8601
    event:       CodexEvent;
    project:     string;              // nombre del proyecto (git root basename)
    path?:       string;              // curate_path target o read_note path
    url?:        string;              // curate_link source
    query?:      string;              // search_vault query
    status?:     string;              // done | skipped | processing | failed | reset
    durationMs?: number;
    error?:      string;
    extra?:      Record<string, unknown>;
}

// ── Logger ────────────────────────────────────────────────────────────────────

export class CodexAuditLogger {
    private ensured: Promise<void> | null = null;

    constructor(
        private readonly logPath: string,
        private readonly project: string,
    ) {}

    async log(entry: Omit<CodexAuditEntry, 'ts' | 'project'>): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        const full: CodexAuditEntry = { ts: new Date().toISOString(), project: this.project, ...entry };
        await fs.appendFile(this.logPath, JSON.stringify(full) + '\n', 'utf-8');
    }

    /** Fire-and-forget — no bloquea la ejecución de la tool. */
    write(entry: Omit<CodexAuditEntry, 'ts' | 'project'>): void {
        this.log(entry).catch(err =>
            process.stderr.write(`[codex-audit] error: ${(err as Error).message}\n`),
        );
    }

    /** Lee todas las entradas del log. */
    async readAll(): Promise<CodexAuditEntry[]> {
        try {
            const raw = await fs.readFile(this.logPath, 'utf-8');
            const entries: CodexAuditEntry[] = [];
            for (const line of raw.split('\n')) {
                if (!line.trim()) continue;
                // A crash mid-write leaves a truncated line: skip it, keep the rest of the log.
                try { entries.push(JSON.parse(line) as CodexAuditEntry); } catch { /* skip */ }
            }
            return entries;
        } catch { return []; }
    }

    get path(): string { return this.logPath; }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function buildCodexAuditPath(project: string, custom?: string): string {
    return custom
        ? path.resolve(custom)
        : path.join(os.homedir(), '.backendkit', 'audit', `codex-${project}.ndjson`);
}
