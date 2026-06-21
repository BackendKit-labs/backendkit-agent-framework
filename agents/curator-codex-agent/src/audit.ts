import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

export interface CuratorAuditEntry {
    ts:          string;
    tool:        string;
    status:      'ok' | 'error';
    durationMs:  number;
    error?:      string;
}

class CuratorAuditLogger {
    private ensured: Promise<void> | null = null;
    constructor(private readonly logPath: string) {}

    async log(entry: Omit<CuratorAuditEntry, 'ts'>): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        await fs.appendFile(this.logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf-8');
    }

    write(entry: Omit<CuratorAuditEntry, 'ts'>): void {
        this.log(entry).catch(e => process.stderr.write(`[curator-audit] ${(e as Error).message}\n`));
    }
}

export const auditLogger = new CuratorAuditLogger(
    process.env['CURATOR_AUDIT_LOG'] ??
    path.join(os.homedir(), '.backendkit', 'audit', 'curator-access.ndjson'),
);
