import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AuditEvent, Step } from './types';

type EventInit = Partial<Omit<AuditEvent, 'timestamp' | 'alert_id' | 'step' | 'agent'>>;

const SECRET_PATTERNS: RegExp[] = [
    /\bsk-[A-Za-z0-9_-]{8,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    /\b(password|passwd|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi,
];

/** Redact obvious credentials and truncate (SR-6, T-06). */
export function sanitize(text: string, maxChars: number): string {
    let out = text;
    for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
    return out.length > maxChars ? `${out.slice(0, maxChars)}…[truncated]` : out;
}

/** Append-only JSONL writer. Audit is mandatory: write errors propagate. */
export class AuditLog {
    readonly events: AuditEvent[] = [];

    constructor(private readonly filePath: string, private readonly alertId: string) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    /** Record one step with uniform schema (non-applicable fields = null). */
    record(step: Step, agent: string, init: EventInit = {}): AuditEvent {
        const event: AuditEvent = {
            timestamp: new Date().toISOString(),
            alert_id: this.alertId,
            step,
            agent,
            input_summary: null,
            analysis_summary: null,
            evidence: [],
            policy_check: null,
            selected_tool: null,
            tool_args: null,
            justification: null,
            confidence: null,
            risk_level: null,
            requires_approval: null,
            tool_result: null,
            final_decision: null,
            ...init,
        };
        fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf-8');
        this.events.push(event);
        return event;
    }
}
