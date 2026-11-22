/**
 * Governance contracts of the engine (SPEC-0014 §3): who acts, what a policy decides about a tool call, who may
 * approve what, and what gets audited. They name no tool, agent or domain: verticals and products (the coding
 * pipeline, Steward, Hermes) implement them.
 */
import type { ToolDefinition } from '../types';

// ── Who acts ──────────────────────────────────────────────────────────────────

export interface Principal {
    /** The agent that executes. */
    agentId: string;
    sessionId: string;
    /** Delegation chain from whoever started the work to the agent that executes, e.g. [user?, orchestrator, specialist]. */
    chain: string[];
    tenantId?: string;
    /** On whose behalf the agent acts. */
    userId?: string;
    roles?: string[];
    scopes?: string[];
    /** Free-form: department, scope, cost centre... */
    attributes?: Record<string, unknown>;
}

/** The part of a principal the engine does not compute: who the engine acts for. */
export type Identity = Omit<Principal, 'agentId' | 'sessionId' | 'chain'>;

// ── Approval: who approves, and what ──────────────────────────────────────────

export type ApproverKind = 'human' | 'agent' | 'service';

export interface ApproverRef {
    kind: ApproverKind;
    /** User id, agent id or service name. */
    id: string;
    /** When the approver is an agent: its delegation chain. */
    chain?: string[];
}

// ── Policy ────────────────────────────────────────────────────────────────────

export interface ToolCall {
    /** The tool, with its declared facts (readOnly, destructive, idempotent, openWorld, meta). */
    tool: ToolDefinition;
    args: Record<string, unknown>;
    /**
     * Someone already approved exactly this call (resubmission, SPEC-0014 §6). Only whoever holds the approval
     * sets it when executing it; the engine never derives it from what the model sent.
     */
    approved?: { by: ApproverRef; approvalId: string; /** Who asked, as the stored request recorded it (`principal.userId`). */ requestedBy?: string; /** When the stored request expires (ISO). */ expiresAt?: string };
}

export type PolicyDecision =
    | {
        effect: 'allow';
        reason?: string;
        /**
         * How an allowed call runs. 'sandboxed' forces the sandbox runner; 'dry_run' runs with `ctx.dryRun = true`
         * (the tool simulates and writes nothing). Default 'run'.
         */
        mode?: 'run' | 'sandboxed' | 'dry_run';
    }
    | { effect: 'deny'; reason: string }
    | {
        effect: 'ask';
        reason: string;
        /** Whom to route the request to (role, level, department). Free text, read by whoever routes it. */
        approver?: string;
        /** Which kinds of approver are accepted. Default: any. Destructive tools require ['human']. */
        accepts?: ApproverKind[];
        /**
         * Roles of whoever may approve: the approver needs at least one. Unlike `approver` (free text, a hint for whoever
         * routes the request), this is CHECKED by the engine against the `approverDirectory` (SPEC-0041). With no directory
         * the call is denied: an approval that cannot be checked is not accepted.
         */
        approverRoles?: string[];
        /**
         * How long the request lives, in seconds from when it is made. After that an approval is not run (SPEC-0042 F3).
         * Several policies: the shortest wins. Without it, the engine's `approvalTtlSeconds`, and without that, it does not expire.
         */
        ttlSeconds?: number;
    };

export interface ToolPolicy {
    decide(principal: Principal, call: ToolCall): PolicyDecision | Promise<PolicyDecision>;
}

/** What can be put up for approval: a tool call, a workflow step, a learned rule, or anything a vertical defines. */
export type ApprovalSubject =
    | { kind: 'tool_call'; call: ToolCall }
    | { kind: 'workflow_step'; workflow: string; step: string; input: unknown }
    | { kind: 'rule_proposal'; rule: unknown; evidence: string }
    | { kind: string; payload: unknown; summary: string };

export interface ApprovalRequest {
    id: string;
    principal: Principal;
    subject: ApprovalSubject;
    reason: string;
    approver?: string;
    accepts?: ApproverKind[];
    /** Roles of whoever may approve, from the `ask` (at least one is needed). Checked against the `approverDirectory`. */
    approverRoles?: string[];
    /** ISO time. */
    createdAt: string;
    /** ISO time after which an approval of this request is not run, whether it is still pending or already approved. Absent: it does not expire. */
    expiresAt?: string;
}

export interface ApprovalOutcome {
    decision: 'approve' | 'reject';
    by: ApproverRef;
    reason?: string;
    /** ISO time. */
    at: string;
}

/** What the application knows about an approver: the one source of an approver's roles (SPEC-0041). */
export interface ApproverProfile {
    roles: string[];
    /** The tenant the approver belongs to. When both it and the request's tenant are set, they must be the same. */
    tenantId?: string;
}

/**
 * Tells the engine who an approver is. It is the application's: the framework does not authenticate anyone, and it
 * does not take roles from what the caller says in `by`. Return `undefined` for an id you do not know.
 */
export interface ApproverDirectory {
    describe(by: ApproverRef): Promise<ApproverProfile | undefined> | ApproverProfile | undefined;
}

/** What the engine recognized about an approver when it accepted the approval; it goes to the audit event. */
export interface ApproverAuthority {
    roles: string[];
    tenantId?: string;
    /** The role of the `ask` that this approver satisfied. */
    matched: string;
}

export interface Approver {
    /** Who this approver is; checked against the approval rules before its answer is accepted. */
    readonly ref?: ApproverRef;
    /** Answers now (a CLI prompt, a connected UI, a supervising agent). */
    request(req: ApprovalRequest): Promise<ApprovalOutcome>;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed';

export interface StoredApproval extends ApprovalRequest {
    status: ApprovalStatus;
    outcome?: ApprovalOutcome;
    /** ISO time when the approved action was executed (at most once). */
    executedAt?: string;
}

/** Durable approvals (SPEC-0014 §6, option A: resubmission). */
export interface ApprovalStore {
    put(req: ApprovalRequest): Promise<void>;
    get(id: string): Promise<StoredApproval | undefined>;
    /** Records the decision once; a second decision for the same id fails. */
    resolve(id: string, outcome: ApprovalOutcome): Promise<StoredApproval>;
    /** Marks an approved request executed, atomically and at most once; returns false if it already was. */
    markExecuted(id: string): Promise<boolean>;
    list(filter?: { status?: ApprovalStatus; agentId?: string }): Promise<StoredApproval[]>;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export type AuditDecision =
    | PolicyDecision['effect']
    | 'not_found'
    | 'not_allowed'
    | 'sandbox_denied'
    | 'guardrail_blocked';

export type AuditOutcome = 'ok' | 'error' | 'timeout' | 'aborted' | 'too_large';

/** What the sandbox decided while a call ran (it may run several commands or touch several paths). */
export interface AuditSandboxDecision {
    outcome: 'allowed' | 'SANDBOX_DENIED' | 'SANDBOX_UNAVAILABLE';
    mode?: string;
    network?: string;
    backend?: string;
    reason?: string;
}

/** One record per tool call, accepted or refused. Arguments travel only as a hash. */
export interface AuditEvent {
    /** ISO time when the call started. */
    at: string;
    /** The run (`engine.run`) the call belongs to: the same id as `RunResult.runId` and the `run_id` tag of its spans. Absent for a tool called outside a run. */
    runId?: string;
    principal: Pick<Principal, 'agentId' | 'sessionId' | 'chain' | 'tenantId' | 'userId'>;
    tool: string;
    /** SHA-256 of the canonical JSON of the arguments (`hashArgs`). */
    argsHash: string;
    decision: AuditDecision;
    reason?: string;
    /** Present when the call ran. */
    outcome?: AuditOutcome;
    /**
     * Present when the call failed with an error that has a string `code` (e.g. `ECONNRESET`, `ERP_PERIOD_CLOSED`) or
     * a name other than `Error` (e.g. `TypeError`). Never the message: it may carry data the arguments' hash keeps out.
     * It tells apart failures of the same tool that have different causes.
     */
    errorCode?: string;
    durationMs: number;
    /** Who approved the call, when it needed approval. */
    approval?: { id: string; by: ApproverRef; authority?: ApproverAuthority };
    sandbox?: AuditSandboxDecision[];
    /** The tool's declared `meta`. */
    meta?: Record<string, unknown>;
}

export interface AuditSink {
    write(event: AuditEvent): void | Promise<void>;
}
