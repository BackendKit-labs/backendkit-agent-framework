import type { AgentContext, AuditEntry, AuditQuery, ControlAction, ErrorCode, RunSummary } from '../types';

/**
 * What a service plugs into `AgentServer` to be controllable from outside (by a supervisor such as Hermes).
 * The protocol package only defines the surface; the host decides what each action does. Enabling it also
 * needs `controlApiKey` on the server: control never rides on the key that only allows running capabilities.
 */
export interface ControlHandler {
    /** Actions this handler implements. The server adds `drain` and `resume` (stop and resume accepting runs) itself. */
    readonly actions: readonly ControlAction[];
    control(action: ControlAction, params: Record<string, unknown>, context: AgentContext): Promise<unknown>;
    /** Active and recent runs. Default: the server's own task list. */
    runs?(): Promise<RunSummary[]>;
    /** The agent's audit trail. Without it `GET /v1/agent/audit` answers `CONTROL_UNSUPPORTED`. */
    audit?(query: AuditQuery): Promise<AuditEntry[]>;
}

/** Throw it from a handler to answer with a specific protocol code instead of a generic failure. */
export class ControlError extends Error {
    constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
        super(message);
        this.name = 'ControlError';
    }
}

/** HTTP status for a code a control handler can raise. */
export function statusForCode(code: ErrorCode): number {
    switch (code) {
        case 'INVALID_INPUT': return 400;
        case 'UNAUTHORIZED': return 401;
        case 'FORBIDDEN':
        case 'POLICY_WIDER_THAN_PARENT':
        case 'APPROVAL_REQUIRED': return 403;
        case 'CAPABILITY_NOT_FOUND':
        case 'TASK_NOT_FOUND': return 404;
        case 'CONTROL_UNSUPPORTED': return 501;
        case 'AGENT_UNAVAILABLE': return 503;
        case 'TIMEOUT': return 504;
        default: return 500;
    }
}
