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
    /** What it is about: a tool name, a workflow step. Patterns group by domain + kind + subject + fingerprint. */
    subject?: string;
    /**
     * What tells apart failures of the same kind and subject that have different causes: for a tool, the code or class
     * of its error (`ECONNRESET`, `ERP_PERIOD_CLOSED`). Without it, they are one pattern.
     */
    fingerprint?: string;
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
    fingerprint?: string;
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

/** A lesson a person wrote: no threshold, no inference. */
export interface TaughtLesson {
    id: string;
    text: string;
    /** Only this agent gets it. Without it, every agent of the tenant does. */
    agentId?: string;
    tenantId?: string;
    /** Only an agent that has at least one of these tools in the turn gets it. */
    tools?: string[];
    /** Who taught it. */
    by: ApproverRef;
    /** ISO time. */
    at: string;
}

export interface LessonStore {
    add(lesson: TaughtLesson): Promise<void>;
    list(): Promise<TaughtLesson[]>;
    /** Removes a lesson; false when it did not exist. */
    remove(id: string): Promise<boolean>;
}

/** What `teach` takes. */
export interface TeachInput {
    /** What the agent should know, in a sentence or two. Sanitized and capped when it joins the prompt. */
    text: string;
    agentId?: string;
    tenantId?: string;
    tools?: string[];
}

/** What `addRule` takes: a rule a person writes, without waiting for a pattern. */
export interface AddRuleInput {
    /** A `ToolRule` (checked), or any rule of a vertical (opaque). */
    rule: unknown;
    tenantId?: string;
    reason?: string;
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
     * How far back a failure counts, in days. An older one is ignored by patterns, lessons and proposals (it stays in the
     * store until the cap drops it). Default 30.
     */
    window?: { days: number };
    /**
     * A pattern of a tool that has many correct calls also needs to be a big enough share of its calls: three failures among
     * a thousand calls is noise. Default `{ minFailureRate: 0.05, minCalls: 20 }`; `false` counts failures only. With fewer
     * than `minCalls` calls in the window, or for subjects whose successes are not counted, only the count decides.
     */
    rate?: { minFailureRate: number; minCalls: number } | false;
    /** Where the daily counters of correct calls live. Default: in memory. */
    counters?: MemoryStoreBackend;
    /** The clock. Default: the system's. */
    now?: () => Date;
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
    /** Where the lessons people teach live. Default: in memory. */
    lessonStore?: LessonStore;
    /**
     * Who may approve a proposed rule, teach a lesson or add a rule. Default `['human']`: nothing an agent learns, and
     * nothing it is taught on its own, applies without a person.
     */
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
    lessonsFor(agentId: string, tenantId?: string, availableTools?: string[]): Promise<string | undefined>;
    /**
     * Teaches an agent something specific, without waiting for it to fail three times: a lesson in its prompt from now
     * on. Only whoever `approverKinds` allows may teach (default: a person). Sanitized and capped when it joins the
     * prompt, never expires, and stays inside its tenant. Rejects an empty text or one over 500 characters.
     */
    teach(input: TeachInput, by: ApproverRef): Promise<TaughtLesson>;
    /** The lessons people taught. Without `tenantId`, every tenant's. */
    taught(filter?: { agentId?: string; tenantId?: string }): Promise<TaughtLesson[]>;
    /** Withdraws a taught lesson. */
    forget(lessonId: string): Promise<boolean>;
    /**
     * Adds a rule without waiting for a pattern to propose it: validated (a `ToolRule` must name its tool and an effect),
     * attributed to a person and stored with the rules that came from proposals.
     */
    addRule(input: AddRuleInput, by: ApproverRef): Promise<ApprovedRule>;
    /** Proposed rules still waiting for a decision (or those with `status`). Without `tenantId`, every tenant's. */
    proposals(filter?: { status?: StoredApproval['status']; tenantId?: string }): Promise<StoredApproval[]>;
    approve(id: string, by: ApproverRef, reason?: string): Promise<ApprovedRule>;
    reject(id: string, by: ApproverRef, reason?: string): Promise<void>;
    /** Withdraws an approved rule. */
    retire(ruleId: string): Promise<boolean>;
    /** Writes the counters of correct calls now (they are written every few seconds, and at most once the engine stops). */
    flush(): Promise<void>;
}
