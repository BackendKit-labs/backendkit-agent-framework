import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type CoderEvent =
    // Ciclo de vida de runs SDD
    | 'run.start'
    | 'run.done'
    | 'run.failed'
    // Gates
    | 'gate.hit'
    | 'gate.approved'
    | 'gate.rejected'
    // Enterprise reflection
    | 'reflect.promote'
    | 'reflect.demote';

export interface CoderAuditEntry {
    ts:          string;             // ISO 8601
    event:       CoderEvent;
    project:     string;             // basename del dir que contiene el orchestrator.yaml
    runId?:      string;
    task?:       string;
    planSource?: 'static' | 'dynamic';
    stepId?:     string;
    agentId?:    string;
    status?:     string;
    durationMs?: number;
    error?:      string;
    extra?:      Record<string, unknown>;
}

// ── Logger ────────────────────────────────────────────────────────────────────

export class CoderAuditLogger {
    private ensured: Promise<void> | null = null;

    constructor(
        private readonly logPath: string,
        private readonly project: string,
    ) {}

    async log(entry: Omit<CoderAuditEntry, 'ts' | 'project'>): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        const full: CoderAuditEntry = { ts: new Date().toISOString(), project: this.project, ...entry };
        await fs.appendFile(this.logPath, JSON.stringify(full) + '\n', 'utf-8');
    }

    /** Fire-and-forget — no bloquea la ejecución. */
    write(entry: Omit<CoderAuditEntry, 'ts' | 'project'>): void {
        this.log(entry).catch(err =>
            process.stderr.write(`[coder-audit] error: ${(err as Error).message}\n`),
        );
    }

    get path(): string { return this.logPath; }
}

// ── Factory y cache ───────────────────────────────────────────────────────────

export function buildCoderAuditPath(project: string, custom?: string): string {
    return custom
        ? path.resolve(custom)
        : path.join(os.homedir(), '.backendkit', 'audit', `coder-${project}.ndjson`);
}

const auditCache = new Map<string, CoderAuditLogger>();

/**
 * Devuelve (o crea) el logger para un configPath dado.
 * El nombre del proyecto se deriva del directorio que contiene el orchestrator.yaml.
 */
export function getAuditLogger(configPath: string): CoderAuditLogger {
    const key     = path.resolve(configPath);
    const project = path.basename(path.dirname(key));
    let logger = auditCache.get(key);
    if (!logger) {
        logger = new CoderAuditLogger(buildCoderAuditPath(project), project);
        auditCache.set(key, logger);
    }
    return logger;
}
