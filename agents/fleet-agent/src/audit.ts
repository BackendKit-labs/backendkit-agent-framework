import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

export type FleetEvent = 'deploy.start' | 'deploy.done' | 'deploy.failed' | 'agent.stop';

export interface FleetAuditEntry {
    ts:          string;
    event:       FleetEvent;
    agentId?:    string;
    image?:      string;
    instances?:  number;
    status?:     string;
    durationMs?: number;
    error?:      string;
    extra?:      Record<string, unknown>;
}

export class FleetAuditLogger {
    private ensured: Promise<void> | null = null;
    constructor(private readonly logPath: string) {}

    async log(entry: Omit<FleetAuditEntry, 'ts'>): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        await fs.appendFile(this.logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf-8');
    }

    write(entry: Omit<FleetAuditEntry, 'ts'>): void {
        this.log(entry).catch(e => process.stderr.write(`[fleet-audit] ${(e as Error).message}\n`));
    }
}

export const auditLogger = new FleetAuditLogger(
    process.env['FLEET_AUDIT_LOG'] ??
    path.join(os.homedir(), '.backendkit', 'audit', 'fleet-access.ndjson'),
);
