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
    constructor(private readonly auditLog: string | undefined) {
        if (auditLog) {
            try { mkdirSync(dirname(auditLog), { recursive: true }); } catch {}
        }
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
        await appendFile(this.auditLog, line + '\n').catch(() => undefined);
    }
}
