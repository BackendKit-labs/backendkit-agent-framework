import type { ApprovalStore, ApproverKind, ApproverRef, AuditSink, StoredApproval, ToolPolicy } from '../governance/types';
import type { EngineHooks } from '../governance/hooks';
import type { MemoryStoreBackend } from '../agent-memory/types';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

/** One thing that happened to an agent, good or bad. Domain and kind are free text: a vertical names its own. */
export interface Experience {
    id: string;
    /** ISO time. */
    at: string;
    agentId: string;
    /**
     * The tenant it happened in. Experiences, lessons, proposals and rules never cross tenants: what one tenant's
     * agents learn is invisible to another's. No tenant is its own separate space.
     */
    tenantId?: string;
    /** Area of the experience: 'tool', 'policy', 'commit'... */
    domain: string;
    /** What it is about: a tool name, a workflow step. Patterns group by domain + kind + subject. */
    subject?: string;
    /** What was being attempted. */
    situation: string;
    /** What was done (a tool and a hash of its arguments, a step). */
    action: string;
    outcome: 'success' | 'failure';
    /** Type of failure, open: 'tool_error', 'tool_timeout', 'policy_denied'... */
    kind: string;
    severity: Severity;
    detail?: string;
    /** What is specific to the vertical (files, commit...). */
    meta?: Record<string, unknown>;
}

/** What `record` takes: the id and the time are filled in, and an experience is a failure of medium severity by default. */
export type ExperienceInput =
    Omit<Experience, 'id' | 'at' | 'outcome' | 'severity'> & Partial<Pick<Experience, 'at' | 'outcome' | 'severity'>>;

/** The same kind of failure seen at least `threshold` times. */
export interface LearnedPattern {
    /** `domain:kind:subject`. */
    key: string;
    /** The tenant the pattern belongs to; a pattern never mixes tenants. */
    tenantId?: string;
    domain: string;
    kind: string;
    subject?: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    /** The highest severity of the group. */
    severity: Severity;
    experienceIds: string[];
    agentIds: string[];
    /** The latest experience's situation and detail. */
    situation: string;
    detail?: string;
}

/** A rule a person approved. `rule` is opaque to core: its meaning is the consumer's. */
export interface ApprovedRule {
    id: string;
    rule: unknown;
    /** The tenant it was learned in. `learning.policy` applies it only to calls of that tenant. */
    tenantId?: string;
    approvedBy: ApproverRef;
    /** ISO time. */
    approvedAt: string;
    /** Why it was proposed: the repetitions it came from. */
    source: string;
    reason?: string;
}

export interface RuleStore {
    add(rule: ApprovedRule): Promise<void>;
    list(): Promise<ApprovedRule[]>;
    /** Removes a rule; false when it did not exist. */
    remove(id: string): Promise<boolean>;
}

/** The rule `learning.policy` enforces: calls to `tool` ask (or are denied). */
export interface ToolRule {
    tool: string;
    effect: 'ask' | 'deny';
    reason: string;
}

export interface LearningOptions {
    /** Where the experiences are kept. Default: in memory, so an engine without configuration touches no file. */
    store?: MemoryStoreBackend;
    /** Where the proposed rules wait for a decision. Default: in memory. */
    approvals?: ApprovalStore;
    /** Where the approved rules live. Default: in memory. */
    rules?: RuleStore;
    /** Repetitions that make a pattern: it becomes a lesson and a proposed rule. Default 3. */
    threshold?: number;
    /**
     * Repetitions that make a pattern, per kind of experience (it gets the latest of the group). Overrides `threshold`:
     * for example, a critical failure may need one, and a minor one three.
     */
    thresholdFor?: (experience: Experience) => number;
    /** Most experiences kept; the oldest are dropped. Default 1000. */
    maxExperiences?: number;
    lessons?: { maxChars?: number; maxLessons?: number };
    /**
     * What rule a pattern proposes. Return `undefined` for none (the pattern stays a lesson). Default: for a tool
     * that fails, `{ tool, effect: 'ask' }`.
     */
    ruleFor?: (pattern: LearnedPattern) => unknown | undefined;
    /** Who may approve a proposed rule. Default `['human']`: a learned rule never applies itself. */
    approverKinds?: ApproverKind[];
}

export interface Learning {
    /**
     * Derives experiences from the audit events of tool calls. Pass it as `audit` to the engine, or pass the whole
     * object as the `learning` option of `createBaseEngine`, which wires sink, hooks and policy.
     */
    readonly sink: AuditSink;
    /** Adds the lessons of the agent to its system prompt. Pass it in `hooks`. */
    readonly hooks: EngineHooks;
    /** Enforces the approved tool rules. Pass it as `policy` (or combine it with yours). */
    readonly policy: ToolPolicy;
    readonly rules: RuleStore;
    /** Records an experience of a vertical: a QA verdict, user feedback... */
    record(input: ExperienceInput): Promise<Experience>;
    /** Without `tenantId` in the filter, every tenant's are returned (an operator's view). */
    experiences(filter?: { agentId?: string; domain?: string; tenantId?: string }): Promise<Experience[]>;
    patterns(filter?: { agentId?: string; tenantId?: string }): Promise<LearnedPattern[]>;
    /**
     * The lessons text of an agent within a tenant (or within no tenant), or `undefined` when it has learned
     * nothing yet. The text of a lesson does not change once written, so the system prompt stays cacheable.
     */
    lessonsFor(agentId: string, tenantId?: string): Promise<string | undefined>;
    /** Proposed rules still waiting for a decision (or those with `status`). Without `tenantId`, every tenant's. */
    proposals(filter?: { status?: StoredApproval['status']; tenantId?: string }): Promise<StoredApproval[]>;
    approve(id: string, by: ApproverRef, reason?: string): Promise<ApprovedRule>;
    reject(id: string, by: ApproverRef, reason?: string): Promise<void>;
    /** Withdraws an approved rule. */
    retire(ruleId: string): Promise<boolean>;
}
