import { checkNarrower, describeViolations, parsePolicyConfig } from '@backendkit-labs/agent-sandbox';
import type { SandboxPolicyConfig } from '@backendkit-labs/agent-sandbox';
import { z } from 'zod';

/**
 * Blueprints: what Hermes may create, written by the operator. Everything an instance will be allowed to do is here, and
 * nothing else decides it: `agent_create` takes a blueprint id and nothing more.
 */

const approval = z.enum(['never', 'ask', 'always']);
const roles = z.array(z.string().min(1)).min(1);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'letters, digits, "-" and "_"; must not start with a symbol');

export const blueprintSchema = z.object({
    id,
    description: z.string().optional(),
    /** Which kind of agent the host's provisioner builds (e.g. a create-bk-agent template name). Hermes does not interpret it. */
    template: z.string().min(1),
    tools: z.array(z.string().min(1)),
    /** The execution policy of the instance: a sandbox policy config. Must be as strict as the creator's. */
    sandbox: z.record(z.string(), z.unknown()),
    limits: z.object({
        budgetUsdPerDay: z.number().positive().optional(),
        /** The instance is retired after this long. Fractions allowed. */
        ttlMinutes: z.number().positive().optional(),
    }).strict().optional(),
    /** What creating an instance needs. Default `ask`: a human approves each creation. */
    approval: approval.optional(),
    /** What the instance can do, in words: Hermes matches a gap against these (and against the fleet's capabilities). */
    covers: z.array(z.string().min(1)).optional(),
    /** Who may create (and retire) instances of this blueprint. Absent: nobody. */
    createRoles: roles.optional(),
    /** Who may use and control the instances once they exist. */
    access: z.object({ roles: roles.optional(), controlRoles: roles.optional(), approval: approval.optional() }).strict().optional(),
}).strict();

export type Blueprint = z.infer<typeof blueprintSchema>;

/** What Hermes itself may hand out. A blueprint can never exceed it. It lives only in the operator's file. */
export const creatorSchema = z.object({
    sandbox: z.record(z.string(), z.unknown()),
    /** Tools Hermes may give to an instance. A blueprint's `tools` must be inside this list. */
    tools: z.array(z.string()),
    budgetUsdPerDay: z.number().positive().optional(),
}).strict();

export type CreatorPolicy = z.infer<typeof creatorSchema>;

export const provisioningSchema = z.object({
    creator: creatorSchema,
    /** Live instances at once. Default 3. */
    maxLive: z.number().int().positive().optional(),
    gap: z.object({ mode: z.enum(['notify', 'create', 'propose']).optional() }).strict().optional(),
    /** Who may approve or reject a drafted blueprint. Absent: nobody, so drafts stay unusable. */
    operatorRoles: roles.optional(),
    /** Pending drafts at once. Default 20. */
    maxDrafts: z.number().int().positive().optional(),
}).strict();

export type ProvisioningPolicy = z.infer<typeof provisioningSchema>;

export interface BlueprintProblem { path: string; message: string }

/**
 * Is this blueprint within what Hermes may hand out? Returns the problems found (empty = fine). Run when the file is
 * loaded and again when an instance is created or a draft approved: the answer must hold at the moment of use.
 */
export function checkBlueprint(blueprint: Blueprint, policy: ProvisioningPolicy | undefined): BlueprintProblem[] {
    const problems: BlueprintProblem[] = [];
    if (!policy) return [{ path: '', message: 'blueprints need policies.provisioning.creator: what Hermes may hand out' }];

    let creator: SandboxPolicyConfig | undefined;
    try { creator = parsePolicyConfig(policy.creator.sandbox); }
    catch (err) { problems.push({ path: 'policies.provisioning.creator.sandbox', message: (err as Error).message }); }

    let child: SandboxPolicyConfig | undefined;
    try { child = parsePolicyConfig(blueprint.sandbox); }
    catch (err) { problems.push({ path: 'sandbox', message: (err as Error).message }); }

    if (creator && child) {
        const verdict = checkNarrower(creator, child);
        if (!verdict.ok) problems.push({ path: 'sandbox', message: `wider than the creator: ${describeViolations(verdict.violations)}` });
    }

    const outside = blueprint.tools.filter(t => !policy.creator.tools.includes(t));
    if (outside.length) problems.push({ path: 'tools', message: `not in the creator's tools: ${outside.join(', ')}` });

    const ceiling = policy.creator.budgetUsdPerDay;
    const asked = blueprint.limits?.budgetUsdPerDay;
    if (ceiling !== undefined && (asked === undefined || asked > ceiling)) {
        problems.push({ path: 'limits.budgetUsdPerDay', message: asked === undefined ? `must be set, at most ${ceiling} (the creator's budget)` : `${asked} is more than the creator's ${ceiling}` });
    }
    return problems;
}

export const problemText = (problems: BlueprintProblem[]): string => problems.map(p => (p.path ? `${p.path}: ` : '') + p.message).join('; ');
