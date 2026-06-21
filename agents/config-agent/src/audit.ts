import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

export interface ConfigAuditEntry {
    ts:          string;
    tool:        string;
    agentId?:    string;
    status:      'ok' | 'error';
    durationMs:  number;
    error?:      string;
}

export class ConfigAuditLogger {
    private ensured: Promise<void> | null = null;
    constructor(private readonly logPath: string) {}

    async log(entry: Omit<ConfigAuditEntry, 'ts'>): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        await fs.appendFile(this.logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf-8');
    }

    write(entry: Omit<ConfigAuditEntry, 'ts'>): void {
        this.log(entry).catch(e => process.stderr.write(`[config-audit] ${(e as Error).message}\n`));
    }
}

export const auditLogger = new ConfigAuditLogger(
    process.env['CONFIG_AUDIT_LOG'] ??
    path.join(os.homedir(), '.backendkit', 'audit', 'config-access.ndjson'),
);
