import { parseDocument } from 'yaml';
import { z } from 'zod';
import { blueprintSchema, checkBlueprint, provisioningSchema } from './provisioning';

/** Credentials are never written in the file: they are references resolved when used, so a rotated key applies without a restart. */
const secretRef = z.object({ env: z.string().min(1) }, { invalid_type_error: 'use { env: NAME }: credentials are references, never written in the file' }).strict();

const approval = z.enum(['never', 'ask', 'always']);

const roles = z.array(z.string().min(1)).min(1);

const capabilityAccess = z.object({ roles: roles.optional(), approval: approval.optional() }).strict();

const protocolConnector = z.object({
    kind: z.literal('protocol'),
    url: z.string().url(),
    apiKey: secretRef.optional(),
    /** Key of the agent's control channel. Distinct from `apiKey`: whoever may run capabilities may not thereby change the agent's policy. */
    controlApiKey: secretRef.optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    pollIntervalMs: z.number().int().positive().optional(),
}).strict();

/** An agent that runs in the same process as Hermes; the code registers its connector under the agent's id. */
const inProcessConnector = z.object({ kind: z.literal('in-process') }).strict();

/** A connector of a kind a plugin provides: Hermes checks the kind, the plugin's factory reads the rest. */
type CustomConnector = { kind: string; [key: string]: unknown };
type ProtocolConnectorConfig = z.infer<typeof protocolConnector>;
type InProcessConnectorConfig = z.infer<typeof inProcessConnector>;
export type ConnectorConfig = ProtocolConnectorConfig | InProcessConnectorConfig | CustomConnector;

const connectorConfig = z.custom<ConnectorConfig>(v => typeof v === 'object' && v !== null && !Array.isArray(v), 'a connector is an object with a kind')
    .superRefine((value, ctx) => {
        const kind = (value as { kind?: unknown } | null)?.kind;
        const builtin = kind === 'protocol' ? protocolConnector : kind === 'in-process' ? inProcessConnector : undefined;
        if (builtin) {
            const parsed = builtin.safeParse(value);
            if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
        } else if (typeof kind !== 'string' || !/^[a-z][a-z0-9-]*$/.test(kind)) {
            ctx.addIssue({ code: 'custom', path: ['kind'], message: 'a connector kind is lowercase letters, digits and "-" (protocol, in-process, or one a plugin provides)' });
        }
    });

const pluginEntry = z.object({
    /** A module path (relative to the fleet file) or a package name. CommonJS. */
    module: z.string().min(1),
    /** What the operator grants it. The plugin gets only what it asked for AND is granted here. */
    grant: z.object({
        tools: z.array(z.string()).optional(),
        connectors: z.array(z.string()).optional(),
        events: z.array(z.string()).optional(),
        blueprints: z.boolean().optional(),
        rules: z.boolean().optional(),
    }).strict().optional(),
    options: z.record(z.unknown()).optional(),
}).strict();

export const agentSchema = z.object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'letters, digits, "-" and "_"; must not start with a symbol'),
    description: z.string().optional(),
    connector: connectorConfig,
    tags: z.array(z.string()).optional(),
    /** Read and kept for what comes next (concurrency and budget are not enforced yet); `deadlineMs` bounds a wait. */
    limits: z.object({
        maxConcurrent: z.number().int().positive().optional(),
        budgetUsdPerDay: z.number().positive().optional(),
        deadlineMs: z.number().int().positive().optional(),
    }).strict().optional(),
    health: z.object({
        /** Seconds between checks (fractions allowed). Default 30. */
        intervalSec: z.number().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
    }).strict().optional(),
    access: z.object({
        /** Who may use the agent. Absent: any identified principal. */
        roles: roles.optional(),
        /** Who may change the agent's execution (policy, jobs). Absent: nobody, only reading. */
        controlRoles: roles.optional(),
        approval: approval.optional(),
        capabilities: z.record(capabilityAccess).optional(),
    }).strict().optional(),
}).strict();

export const fleetSchema = z.object({
    fleet: z.string().min(1),
    agents: z.array(agentSchema).min(1, 'a fleet needs at least one agent'),
    /** Presets to add: content for a kind of company (agents, blueprints, plugins). Applied by `createHermes`. */
    presets: z.array(z.object({
        module: z.string().min(1),
        /** Grants for the preset's own plugins, by module. A preset never grants itself anything. */
        grants: z.record(z.object({
            tools: z.array(z.string()).optional(), connectors: z.array(z.string()).optional(), events: z.array(z.string()).optional(),
            blueprints: z.boolean().optional(), rules: z.boolean().optional(),
        }).strict()).optional(),
        /** The preset's role names → the roles of this company. */
        roleMap: z.record(z.array(z.string().min(1))).optional(),
        options: z.record(z.unknown()).optional(),
    }).strict()).optional(),
    /** Code that extends Hermes. Each runs with exactly the grant written here. */
    plugins: z.array(pluginEntry).optional(),
    /** What Hermes may create. Only the operator writes these (or approves a drafted one). */
    blueprints: z.array(blueprintSchema).optional(),
    policies: z.object({
        approval: z.object({ default: approval.optional() }).strict().optional(),
        provisioning: provisioningSchema.optional(),
        /** Accepted and kept; not enforced yet. */
        budget: z.object({ perRunUsd: z.number().positive().optional(), perDayUsd: z.number().positive().optional() }).strict().optional(),
    }).strict().optional(),
}).strict().superRefine((fleet, ctx) => {
    const seen = new Set<string>();
    fleet.agents.forEach((a, i) => {
        if (seen.has(a.id)) ctx.addIssue({ code: 'custom', path: ['agents', i, 'id'], message: `duplicate agent id "${a.id}"` });
        seen.add(a.id);
    });
    const blueprintIds = new Set<string>();
    (fleet.blueprints ?? []).forEach((b, i) => {
        if (blueprintIds.has(b.id)) ctx.addIssue({ code: 'custom', path: ['blueprints', i, 'id'], message: `duplicate blueprint id "${b.id}"` });
        blueprintIds.add(b.id);
        // A blueprint wider than what Hermes may hand out is refused here, when the file is read, not only when it is used.
        for (const problem of checkBlueprint(b, fleet.policies?.provisioning)) {
            ctx.addIssue({ code: 'custom', path: ['blueprints', i, ...(problem.path ? problem.path.split('.') : [])], message: problem.message });
        }
    });
});

export type FleetConfig = z.infer<typeof fleetSchema>;
export type AgentConfig = FleetConfig['agents'][number];
export type ApprovalMode = z.infer<typeof approval>;

export interface FleetIssue {
    /** Where, e.g. `agents.1.connector.url`; `$` for the whole file. */
    path: string;
    message: string;
}

export class FleetConfigError extends Error {
    constructor(readonly issues: FleetIssue[]) {
        super(`Invalid fleet:\n${issues.map(i => `  ${i.path}: ${i.message}`).join('\n')}`);
        this.name = 'FleetConfigError';
    }
}

/** Checks an object already parsed from YAML or JSON. */
export function validateFleet(input: unknown): FleetConfig {
    const parsed = fleetSchema.safeParse(input);
    if (parsed.success) return parsed.data;
    throw new FleetConfigError(parsed.error.issues.map(i => ({ path: i.path.length ? i.path.join('.') : '$', message: i.message })));
}

/** Parses the text of a `fleet.yaml` and checks it. Syntax errors carry their line. */
export function parseFleet(text: string): FleetConfig {
    const doc = parseDocument(text);
    if (doc.errors.length) {
        throw new FleetConfigError(doc.errors.map(e => ({ path: e.linePos?.[0] ? `line ${e.linePos[0].line}` : '$', message: e.message.split('\n')[0] })));
    }
    return validateFleet(doc.toJS());
}
