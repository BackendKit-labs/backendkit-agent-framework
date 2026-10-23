import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type AuditAction = 'run' | 'cancel' | 'info' | 'list' | 'health' | 'reconcile' | 'control';
export type AuditOutcome = 'allowed' | 'denied' | 'approved' | 'not-approved' | 'failed' | 'lost' | 'recovered';

/** One decision or event: who did what to which agent, and what became of it. */
export interface AuditEvent {
    ts: string;
    action: AuditAction;
    outcome: AuditOutcome;
    principalId?: string;
    agentId?: string;
    capability?: string;
    runId?: string;
    reason?: string;
}

export type AuditListener = (event: AuditEvent) => void;

/** Appends one JSON line per event, in the order they happened, and tells the listeners. A failing write or listener never affects the call. */
export class AuditLog {
    private chain?: Promise<unknown>;
    private readonly trail: AuditEvent[] = [];

    constructor(private readonly file?: string, private readonly listener?: AuditListener, private readonly capacity = 2000) {}

    /** The latest events kept in memory (the file is the full record). */
    recent(): AuditEvent[] { return this.trail.map(e => ({ ...e })); }

    record(event: Omit<AuditEvent, 'ts'>): void {
        const full: AuditEvent = { ts: new Date().toISOString(), ...event };
        this.trail.push(full);
        if (this.trail.length > this.capacity) this.trail.splice(0, this.trail.length - this.capacity);
        try { this.listener?.(full); } catch { /* an observer must not affect the call */ }
        if (!this.file) return;
        const file = this.file;
        const line = JSON.stringify(full) + '\n';
        this.chain = (this.chain ?? mkdir(dirname(file), { recursive: true }).catch(() => undefined))
            .then(() => appendFile(file, line))
            .catch(() => undefined);
    }

    /** Waits for the lines written so far. */
    async flush(): Promise<void> { await this.chain; }
}
