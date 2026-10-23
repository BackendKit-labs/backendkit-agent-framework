import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import type { AgentConnector } from '../connectors/types';
import { blueprintSchema } from '../fleet/provisioning';
import { agentSchema, FleetConfigError, validateFleet, type ApprovalMode, type FleetConfig } from '../fleet/schema';
import type { PluginGrant } from '../plugins/types';

/**
 * A preset is a starting point for a kind of company or team, as content: agents, blueprints, plugins to load, and the code of
 * its in-process agents (which is where its flows live). Hermes knows no domain; a preset is how a domain arrives, from the
 * operator, from a third party (`hermes-preset-*`), or from the neutral examples in this repo.
 *
 * What a preset brings is deliberately only content. Limits and grants stay with the operator, who writes them in their own
 * file: a preset cannot set `policies`, what Hermes may hand out, who approves drafts, or a grant for its own plugins, and
 * the merged result is validated again against the operator's limits.
 */
export const presetSchema = z.object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    version: z.string().min(1),
    description: z.string().optional(),
    /** In-process agents (their connector comes from `connectors`) or agents of a kind one of its plugins provides. Never `protocol`: a preset cannot point Hermes at an address or a key. */
    agents: z.array(agentSchema).optional(),
    blueprints: z.array(blueprintSchema).optional(),
    /** Plugins it needs loaded. They carry no grant: the operator grants (or not) in their own file. */
    plugins: z.array(z.object({ module: z.string().min(1), options: z.record(z.unknown()).optional() }).strict()).optional(),
}).strict();

export interface HermesPreset extends z.input<typeof presetSchema> {
    /** The code of the preset's in-process agents, by agent id. */
    connectors?: Record<string, () => AgentConnector>;
}

/** What the operator decides about a preset they use. */
export interface PresetUse {
    /** Grants for the preset's plugins, by module. A plugin with no grant here can only load if it asks for nothing. */
    grants?: Record<string, PluginGrant>;
    /**
     * Presets name roles in their own words (`reviewer`); the operator's principals hold the company's roles. Each preset role
     * becomes the roles listed here (a role not mentioned stays as it is).
     */
    roleMap?: Record<string, string[]>;
}

export class PresetError extends Error {
    constructor(readonly preset: string, message: string) {
        super(`Preset "${preset}": ${message}`);
        this.name = 'PresetError';
    }
}

export interface AppliedPreset {
    fleet: FleetConfig;
    /** The in-process agents the preset brought, ready for `Hermes`' `inProcess` option. */
    inProcess: Record<string, AgentConnector>;
    /** What was changed on the way in, in words (e.g. an approval made as strict as the operator's default). */
    notes: string[];
}

const STRICTNESS: Record<ApprovalMode, number> = { never: 0, ask: 1, always: 1 };

/**
 * Adds a preset to the operator's fleet. Throws `PresetError` if the preset asks for something a preset may not, or if the
 * merged fleet is not valid (for instance a blueprint wider than what the operator lets Hermes hand out).
 */
export function applyPreset(fleet: FleetConfig, input: HermesPreset, use: PresetUse = {}): AppliedPreset {
    const { connectors, ...content } = input as HermesPreset & Record<string, unknown>;
    const name = typeof content.name === 'string' ? content.name : '?';
    const parsed = presetSchema.safeParse(content);
    if (!parsed.success) {
        throw new PresetError(name, `not a valid preset: ${parsed.error.issues.map(i => `${i.path.join('.') || '$'}: ${i.message}`).join('; ')}`);
    }
    const preset = parsed.data;
    const notes: string[] = [];
    const map = (roles: string[] | undefined): string[] | undefined => roles?.flatMap(r => use.roleMap?.[r] ?? [r]);
    const floor: ApprovalMode = fleet.policies?.approval?.default ?? 'ask';
    const clamp = (id: string, mode: ApprovalMode | undefined): ApprovalMode | undefined => {
        if (!mode || STRICTNESS[mode] >= STRICTNESS[floor]) return mode;
        notes.push(`${id}: approval "${mode}" raised to "${floor}" (the operator's default)`);
        return floor;
    };

    const taken = new Set(fleet.agents.map(a => a.id));
    const inProcess: Record<string, AgentConnector> = {};
    const agents = (preset.agents ?? []).map(a => {
        if (taken.has(a.id)) throw new PresetError(preset.name, `agent id "${a.id}" is already in the fleet`);
        taken.add(a.id);
        const kind = a.connector.kind;
        if (kind === 'protocol') throw new PresetError(preset.name, `agent "${a.id}" uses a protocol connector: a preset cannot point Hermes at an address or a key`);
        if (kind === 'in-process') {
            const make = connectors?.[a.id];
            if (typeof make !== 'function') throw new PresetError(preset.name, `agent "${a.id}" is in-process but the preset has no connector for it`);
            inProcess[a.id] = make();
        }
        const access = a.access ? {
            ...a.access,
            ...(a.access.roles ? { roles: map(a.access.roles) } : {}),
            ...(a.access.controlRoles ? { controlRoles: map(a.access.controlRoles) } : {}),
            ...(a.access.approval ? { approval: clamp(a.id, a.access.approval) } : {}),
            ...(a.access.capabilities ? {
                capabilities: Object.fromEntries(Object.entries(a.access.capabilities).map(([cap, c]) => [cap, {
                    ...c, ...(c.roles ? { roles: map(c.roles) } : {}), ...(c.approval ? { approval: clamp(`${a.id}.${cap}`, c.approval) } : {}),
                }])),
            } : {}),
        } : undefined;
        return { ...a, tags: [...(a.tags ?? []), `preset:${preset.name}`], ...(access ? { access } : {}) };
    });

    const blueprints = (preset.blueprints ?? []).map(b => ({
        ...b,
        ...(b.createRoles ? { createRoles: map(b.createRoles) } : {}),
        ...(b.access ? { access: { ...b.access, ...(b.access.roles ? { roles: map(b.access.roles) } : {}), ...(b.access.controlRoles ? { controlRoles: map(b.access.controlRoles) } : {}) } } : {}),
        ...(b.approval ? { approval: clamp(`blueprint ${b.id}`, b.approval) } : {}),
    }));

    const plugins = (preset.plugins ?? []).map(p => ({ module: p.module, ...(use.grants?.[p.module] ? { grant: use.grants[p.module] } : {}), ...(p.options ? { options: p.options } : {}) }));

    try {
        const merged = validateFleet({
            ...fleet,
            agents: [...fleet.agents, ...agents],
            ...(fleet.blueprints || blueprints.length ? { blueprints: [...(fleet.blueprints ?? []), ...blueprints] } : {}),
            ...(fleet.plugins || plugins.length ? { plugins: [...(fleet.plugins ?? []), ...plugins] } : {}),
        });
        return { fleet: merged, inProcess, notes };
    } catch (err) {
        if (err instanceof FleetConfigError) throw new PresetError(preset.name, `the fleet with this preset is not valid:\n${err.issues.map(i => `  ${i.path}: ${i.message}`).join('\n')}`);
        throw err;
    }
}

/** Loads a preset from a path or package name (CommonJS), resolved from `baseDir` like a plugin. It exports the preset, `default`, or a function of the entry's options. */
export function loadPresetModule(spec: string, baseDir: string, options: Record<string, unknown> = {}): HermesPreset {
    let path: string;
    try {
        path = spec.startsWith('.') || isAbsolute(spec) ? require.resolve(resolve(baseDir, spec)) : require.resolve(spec, { paths: [baseDir] });
    } catch (err) {
        throw new Error(`cannot find preset module "${spec}" from ${baseDir}: ${(err as Error).message.split('\n')[0]}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path) as { default?: unknown };
    const exported = mod?.default ?? mod;
    return (typeof exported === 'function' ? (exported as (o: Record<string, unknown>) => HermesPreset)(options) : exported) as HermesPreset;
}
