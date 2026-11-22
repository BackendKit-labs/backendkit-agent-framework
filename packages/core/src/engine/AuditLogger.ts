import { mkdirSync } from 'fs';
import { appendFile } from 'fs/promises';
import { dirname } from 'path';

export interface AuditRecord {
    agentId: string;
    tool: string;
    inputPreview: string;
    success: boolean;
    durationMs: number;
    sessionId?: string;
}

export class AuditLogger {
    private warned = false;

    constructor(private readonly auditLog: string | undefined) {
        if (auditLog) {
            try { mkdirSync(dirname(auditLog), { recursive: true }); } catch (err) { this.report(err); }
        }
    }

    /** Said once: a log that cannot be written must not fail silently, and must not flood either. */
    private report(err: unknown): void {
        if (this.warned) return;
        this.warned = true;
        console.warn(`[AuditLogger] cannot write ${this.auditLog}: ${err instanceof Error ? err.message : String(err)}. Audit records are being lost.`);
    }

    async log(record: AuditRecord): Promise<void> {
        if (!this.auditLog) return;
        const line = JSON.stringify({
            ts:          new Date().toISOString(),
            session:     record.sessionId ?? 'default',
            agent:       record.agentId,
            tool:        record.tool,
            input:       record.inputPreview.slice(0, 200),
            success:     record.success,
            durationMs:  record.durationMs,
        });
        await appendFile(this.auditLog, line + '\n').catch((err: unknown) => this.report(err));
    }
}
