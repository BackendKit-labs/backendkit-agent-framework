import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

export interface HealthAuditEntry {
    ts:          string;
    tool:        string;
    status:      'ok' | 'error';
    durationMs:  number;
    error?:      string;
    extra?:      Record<string, unknown>;
}

export class HealthAuditLogger {
    private ensured: Promise<void> | null = null;
    constructor(private readonly logPath: string) {}

    async log(entry: Omit<HealthAuditEntry, 'ts'>): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        await fs.appendFile(this.logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf-8');
    }

    write(entry: Omit<HealthAuditEntry, 'ts'>): void {
        this.log(entry).catch(e => process.stderr.write(`[health-audit] ${(e as Error).message}\n`));
    }
}

export const auditLogger = new HealthAuditLogger(
    process.env['HEALTH_AUDIT_LOG'] ??
    path.join(os.homedir(), '.backendkit', 'audit', 'health-access.ndjson'),
);
