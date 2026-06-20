import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import { bkPaths } from '@backendkit-labs/infra';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface AuditEntry {
    ts:          string;                       // ISO 8601
    userId:      string;
    role:        string;
    department?: string;
    tool:        string;                       // nombre corto (sin prefijo mcp__)
    decision:    'allowed' | 'denied';
    layer?:      'rbac' | 'abac' | 'vault';   // qué capa tomó la decisión
    reason?:     string;                       // razón de la denegación
    durationMs:  number;
    extra?:      Record<string, unknown>;      // vaultPath, filteredCount, etc.
}

// ── Logger ────────────────────────────────────────────────────────────────────

export class AuditLogger {
    private ensured: Promise<void> | null = null;

    constructor(private readonly logPath: string) {}

    /** Escribe la entrada en el archivo NDJSON (async, awaitable). */
    async log(entry: AuditEntry): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        await fs.appendFile(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    }

    /**
     * Fire-and-forget — no bloquea la ejecución de la tool.
     * Los errores de escritura se reportan en stderr sin interrumpir el flujo.
     */
    write(entry: AuditEntry): void {
        this.log(entry).catch(err =>
            process.stderr.write(`[audit] error al escribir: ${(err as Error).message}\n`),
        );
    }

    /** Lee todas las entradas del log. Útil para dashboards y forensics. */
    async readAll(): Promise<AuditEntry[]> {
        let raw: string;
        try {
            raw = await fs.readFile(this.logPath, 'utf-8');
        } catch {
            return [];
        }
        return raw
            .split('\n')
            .filter(l => l.trim())
            .map(l => JSON.parse(l) as AuditEntry);
    }

    get path(): string { return this.logPath; }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Construye el path del log de auditoría. */
export function buildAuditPath(customPath?: string): string {
    return customPath
        ? path.resolve(customPath)
        : path.join(bkPaths.home(), 'audit', 'director-access.ndjson');
}
