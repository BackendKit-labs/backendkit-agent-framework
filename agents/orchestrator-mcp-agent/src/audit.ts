import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type OrchestratorEvent =
    // Ciclo de vida de flows
    | 'flow.start'
    | 'flow.done'
    | 'flow.failed'
    | 'flow.cancelled'
    // Gates
    | 'gate.hit'
    | 'gate.approved'
    | 'gate.rejected'
    // Retry
    | 'step.retry'
    // CRUD de configuración
    | 'agent.saved'
    | 'agent.deleted'
    | 'flow.saved'
    | 'flow.deleted';

export interface OrchestratorAuditEntry {
    ts:          string;               // ISO 8601
    event:       OrchestratorEvent;
    runId?:      string;
    flowId?:     string;
    stepId?:     string;               // step involucrado (gate hit, step retry)
    agentId?:    string;               // agente involucrado
    status?:     string;               // estado final del run
    durationMs?: number;               // duración del evento
    error?:      string;               // mensaje de error (flow.failed, gate.rejected)
    extra?:      Record<string, unknown>;  // steps summary, feedback, etc.
}

// ── Logger ────────────────────────────────────────────────────────────────────

export class OrchestratorAuditLogger {
    private ensured: Promise<void> | null = null;

    constructor(private readonly logPath: string) {}

    /** Escribe la entrada en el archivo NDJSON (async, awaitable). */
    async log(entry: OrchestratorAuditEntry): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        await fs.appendFile(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    }

    /** Fire-and-forget — no bloquea la ejecución. */
    write(entry: OrchestratorAuditEntry): void {
        this.log(entry).catch(err =>
            process.stderr.write(`[audit] error: ${(err as Error).message}\n`),
        );
    }

    /** Lee todas las entradas del log. */
    async readAll(): Promise<OrchestratorAuditEntry[]> {
        try {
            const raw = await fs.readFile(this.logPath, 'utf-8');
            return raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as OrchestratorAuditEntry);
        } catch { return []; }
    }

    get path(): string { return this.logPath; }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function buildOrchestratorAuditPath(custom?: string): string {
    return custom
        ? path.resolve(custom)
        : path.join(os.homedir(), '.backendkit', 'audit', 'orchestrator-access.ndjson');
}
