import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';

export type OrchestratorAgentEvent =
    | 'run.start' | 'run.done' | 'run.failed'
    | 'gate.hit' | 'gate.approved' | 'gate.rejected'
    | 'reflect.promote' | 'reflect.demote';

export interface OrchestratorAgentAuditEntry {
    ts:          string;
    event:       OrchestratorAgentEvent;
    project:     string;
    runId?:      string;
    task?:       string;
    planSource?: 'static' | 'dynamic';
    stepId?:     string;
    agentId?:    string;
    status?:     string;
    durationMs?: number;
    error?:      string;
    extra?:      Record<string, unknown>;
}

class OrchestratorAgentAuditLogger {
    private ensured: Promise<void> | null = null;
    constructor(private readonly logPath: string, private readonly project: string) {}

    async log(entry: Omit<OrchestratorAgentAuditEntry, 'ts' | 'project'>): Promise<void> {
        if (!this.ensured) {
            this.ensured = fs.mkdir(path.dirname(this.logPath), { recursive: true }).then(() => undefined);
        }
        await this.ensured;
        const full = { ts: new Date().toISOString(), project: this.project, ...entry };
        await fs.appendFile(this.logPath, JSON.stringify(full) + '\n', 'utf-8');
    }

    write(entry: Omit<OrchestratorAgentAuditEntry, 'ts' | 'project'>): void {
        this.log(entry).catch(e => process.stderr.write(`[orch-audit] ${(e as Error).message}\n`));
    }
}

const cache = new Map<string, OrchestratorAgentAuditLogger>();

export function getAuditLogger(configPath: string): OrchestratorAgentAuditLogger {
    const key     = path.resolve(configPath);
    const project = path.basename(path.dirname(key));
    if (!cache.has(key)) {
        const logPath = process.env['ORCHESTRATOR_AGENT_AUDIT_LOG'] ??
            path.join(os.homedir(), '.backendkit', 'audit', `orchestrator-agent-${project}.ndjson`);
        cache.set(key, new OrchestratorAgentAuditLogger(logPath, project));
    }
    return cache.get(key)!;
}
