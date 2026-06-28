import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

export interface GatewayAuditEntry {
    ts:          string;
    method:      string;
    route:       string;
    statusCode:  number;
    status:      'ok' | 'error';
    durationMs:  number;
    extra?:      Record<string, unknown>;
}

class GatewayAuditLogger {
    private ensured: Promise<void> | null = null;
    constructor(private readonly logPath: string) {}

    async log(entry: Omit<GatewayAuditEntry, 'ts'>): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        await fs.appendFile(this.logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf-8');
    }

    write(entry: Omit<GatewayAuditEntry, 'ts'>): void {
        this.log(entry).catch(e => process.stderr.write(`[gateway-audit] ${(e as Error).message}\n`));
    }
}

export const auditLogger = new GatewayAuditLogger(
    process.env['GATEWAY_AUDIT_LOG'] ??
    path.join(os.homedir(), '.backendkit', 'audit', 'gateway-access.ndjson'),
);

/** Rutas ruidosas que no vale la pena auditar (polling frecuente). */
export const SKIP_ROUTES = new Set(['/api/runs', '/api/runs/stream', '/api/health', '/api/agents']);
