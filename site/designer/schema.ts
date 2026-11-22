/**
 * The design of an agent, as data (SPEC-0040 F0). What a model proposes, validated; never free text and never code.
 *
 * Everything here is a closed vocabulary of the framework: what a tool does (`read`, `write`, `destructive`), who may
 * approve and for how long, whether the person who asked also approves, which credentials a tool needs, and what evidence
 * the audit leaves. A model that proposes something outside it is refused by the schema, not trusted.
 */
import { z } from 'zod';

/** snake_case, as the tools of the framework are named. */
const ToolName = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'a tool name is snake_case: lowercase letters, digits and underscores, starting with a letter');
/** kebab-case ids for agents, rules, steps and cases. */
const Id = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/, 'an id is kebab-case: lowercase letters, digits and hyphens, starting with a letter');
/** camelCase, as an argument of a tool. */
const FieldName = z.string().regex(/^[a-z][A-Za-z0-9]{0,40}$/, 'an argument name is camelCase');
const Text = (min: number, max = 400) => z.string().min(min).max(max);
const Scalar = z.union([z.number(), z.string().max(200), z.boolean()]);

export const FIELD_TYPES = ['string', 'number', 'boolean'] as const;
export const EFFECTS = ['read', 'write', 'destructive'] as const;
export const COMPARISONS = ['>', '>=', '<', '<=', '==', '!='] as const;
export const RULE_EFFECTS = ['allow', 'ask', 'deny'] as const;
export const APPROVER_KINDS = ['human', 'agent', 'service'] as const;

export const FieldSchema = z.strictObject({
    name: FieldName,
    type: z.enum(FIELD_TYPES),
    description: Text(3, 200),
    optional: z.boolean().optional(),
});

export const ToolSchema = z.strictObject({
    name: ToolName,
    description: Text(10),
    /**
     * `read` changes nothing. `write` changes things and can be undone. `destructive` cannot be undone (pay, delete, send).
     * One word instead of two flags: a tool cannot be both read-only and destructive.
     */
    effect: z.enum(EFFECTS),
    idempotent: z.boolean().optional(),
    input: z.array(FieldSchema).max(12),
    /** Credentials this tool needs, leased for one call by a broker (SPEC-0042 F4). */
    credentials: z.array(ToolName).max(5).optional(),
});

export const AgentSchema = z.strictObject({
    id: Id,
    name: Text(2, 60),
    role: Text(10),
    tools: z.array(ToolName).max(40),
    delegatesTo: z.array(Id).max(10).optional(),
});

export const ConditionSchema = z.strictObject({
    /** An argument of the rule's tool. */
    field: FieldName,
    op: z.enum(COMPARISONS),
    value: Scalar,
});

export const RuleSchema = z.strictObject({
    id: Id,
    tool: ToolName,
    /** Absent: the rule applies to every call of the tool. */
    when: ConditionSchema.optional(),
    effect: z.enum(RULE_EFFECTS),
    reason: Text(5, 200),
    /** Which kinds of approver an `ask` accepts. Absent: any. A destructive tool needs a person. */
    accepts: z.array(z.enum(APPROVER_KINDS)).min(1).optional(),
    /** Roles of whoever may approve an `ask`; the engine checks them against your directory (SPEC-0041). */
    approverRoles: z.array(z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/)).min(1).max(8).optional(),
    /** How long the request lives, in seconds (SPEC-0042 F3). Only stored approvals expire. */
    ttlSeconds: z.number().int().positive().max(60 * 60 * 24 * 365).optional(),
});

export const GovernanceSchema = z.strictObject({
    rules: z.array(RuleSchema).max(40),
    /** The person an agent acts for does not approve what it asked for (SPEC-0041 F2). */
    fourEyes: z.boolean().optional(),
    /** Calls carry the user they act for (`identity.userId`). Needed by `fourEyes`. */
    actsForUser: z.boolean().optional(),
    /** The application gives a directory of approvers and their roles. Needed by `approverRoles`. */
    approverDirectory: z.boolean().optional(),
    /** The application gives a credential broker. Needed by tools with `credentials`. */
    credentialBroker: z.boolean().optional(),
    /** An `ask` is stored as pending, so a person can answer later (and the request can expire). */
    durableApprovals: z.boolean().optional(),
    audit: z.strictObject({
        /** Sign the head of the chain with Ed25519, so a third party can check it (SPEC-0042 F1). */
        signedCheckpoints: z.boolean().optional(),
        /** Where the head is put out of the operator's reach (SPEC-0042 F2). `none` is allowed and is said to be weaker. */
        anchor: z.enum(['none', 'file']).optional(),
    }),
});

export const FlowStepSchema = z.strictObject({
    id: Id,
    kind: z.enum(['agent', 'tool', 'human']),
    /** The agent id or the tool name. Absent for a `human` step. */
    ref: z.string().max(60).optional(),
    description: Text(5, 200),
});

export const FlowSchema = z.strictObject({
    /** The run survives a restart. A step that waits for a person needs it. */
    durable: z.boolean(),
    steps: z.array(FlowStepSchema).min(1).max(30),
});

export const BudgetSchema = z.strictObject({
    perRunUsd: z.number().positive().max(10_000).optional(),
    perDayUsd: z.number().positive().max(100_000).optional(),
});

export const TestCaseSchema = z.strictObject({
    id: Id,
    /** What the user says. */
    input: Text(3, 300),
    /** The agent the case runs on. Absent: the first one. The tools a case asks for must be the ones this agent may use. */
    agent: Id.optional(),
    /** What a scripted model asks for: the test asserts what happens, not what a real model would say. */
    modelAsks: z.array(z.strictObject({ tool: ToolName, args: z.record(FieldName, Scalar) })).min(1).max(8),
    /** What the approver does when asked. Absent: nobody answers. */
    approver: z.enum(['approves', 'rejects', 'nobody']).optional(),
    expect: z.array(z.strictObject({ tool: ToolName, success: z.boolean() })).min(1).max(8),
});

export const RiskSchema = z.strictObject({
    text: Text(10),
    /** A person has to decide this before the agent is used. */
    needsPersonDecision: z.boolean(),
});

export const DesignSchema = z.strictObject({
    version: z.literal(1),
    title: Text(3, 120),
    goal: Text(10, 600),
    agents: z.array(AgentSchema).min(1).max(12),
    tools: z.array(ToolSchema).min(1).max(40),
    governance: GovernanceSchema,
    flow: FlowSchema.optional(),
    budget: BudgetSchema.optional(),
    testing: z.strictObject({ cases: z.array(TestCaseSchema).max(30) }),
    risks: z.array(RiskSchema).max(20),
});

export type DesignSpec = z.infer<typeof DesignSchema>;
export type ToolSpec = z.infer<typeof ToolSchema>;
export type AgentSpec = z.infer<typeof AgentSchema>;
export type RuleSpec = z.infer<typeof RuleSchema>;
export type TestCaseSpec = z.infer<typeof TestCaseSchema>;
