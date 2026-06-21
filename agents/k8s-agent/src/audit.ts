import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

export interface K8sAuditEntry {
    ts:          string;
    tool:        string;
    status:      'ok' | 'error';
    durationMs:  number;
    error?:      string;
}

class K8sAuditLogger {
    private ensured: Promise<void> | null = null;
    constructor(private readonly logPath: string) {}

    async log(entry: Omit<K8sAuditEntry, 'ts'>): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        await fs.appendFile(this.logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf-8');
    }

    write(entry: Omit<K8sAuditEntry, 'ts'>): void {
        this.log(entry).catch(e => process.stderr.write(`[k8s-audit] ${(e as Error).message}\n`));
    }
}

export const auditLogger = new K8sAuditLogger(
    process.env['K8S_AUDIT_LOG'] ??
    path.join(os.homedir(), '.backendkit', 'audit', 'k8s-access.ndjson'),
);
