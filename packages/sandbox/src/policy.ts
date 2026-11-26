import type { SandboxCaller, SandboxMode, SandboxNetwork } from '@backendkit-labs/agent-core';
import type { EnvPolicy } from './env';
import { PERMISSION_PRESETS, isPermissionPreset, matchPreset, type ApprovalLevel, type PermissionPreset } from './presets';

const MODES: SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access'];
const NETWORKS: SandboxNetwork[] = ['none', 'allow'];
const APPROVALS: ApprovalLevel[] = ['none', 'commands', 'writes-and-commands'];

/** A more specific setting for one agent and/or one tool. The first rule that matches wins. */
export interface SandboxRule {
    agentId?: string;
    tool?: string;
    mode?: SandboxMode;
    network?: SandboxNetwork;
}

/**
 * The whole policy as plain JSON, so it can live in a file (`fleet.yaml`), travel in a control request
 * and be shown back (`snapshot()`).
 */
export interface SandboxPolicyConfig {
    /** Starting point for `mode` and `approval`. Default `ask`. */
    preset?: PermissionPreset;
    /** Overrides the preset's mode. */
    mode?: SandboxMode;
    /** Overrides the preset's approval level. */
    approval?: ApprovalLevel;
    /** Default: `none` for `read-only` and `workspace-write`, `allow` for `danger-full-access`. */
    network?: SandboxNetwork;
    /** Extra directories (besides the call's workspace) a confined command may use as its working directory. */
    roots?: string[];
    rules?: SandboxRule[];
    env?: EnvPolicy;
    /**
     * Tools refused while the mode is `read-only`, whatever they declare. A reinforcement: the sandbox already refuses every tool that
     * does not declare `readOnly: true` (see `SandboxToolFacts`), so this only matters for a tool that claims to read and does not.
     */
    writeTools?: string[];
    /**
     * Tools that write only the agent's own state (its memory, its notes), never the workspace or the outside world. They keep working
     * in `read-only` and never ask for approval. An explicit list: a tool is trusted this way only because the integrator named it.
     */
    ownStateTools?: string[];
    /** Tools that run commands (what the approval level calls "commands"). Default `['run_command']`. */
    commandTools?: string[];
}

export interface ResolvedPolicy {
    mode: SandboxMode;
    network: SandboxNetwork;
    approval: ApprovalLevel;
    roots: string[];
    env: EnvPolicy;
    /** Preset that matches the effective mode and approval, or `custom`. */
    preset: PermissionPreset | 'custom';
}

export class SandboxPolicyError extends Error {
    constructor(path: string, message: string) {
        super(`Invalid sandbox policy at ${path}: ${message}`);
        this.name = 'SandboxPolicyError';
    }
}

const defaultNetwork = (mode: SandboxMode): SandboxNetwork => (mode === 'danger-full-access' ? 'allow' : 'none');

function oneOf<T extends string>(path: string, value: unknown, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new SandboxPolicyError(path, `expected one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}`);
    }
    return value as T;
}

function stringList(path: string, value: unknown): string[] {
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new SandboxPolicyError(path, 'expected an array of strings');
    return [...value];
}

/** Checks an untrusted object (a YAML file, a control request) and returns it as a typed config. */
export function parsePolicyConfig(input: unknown): SandboxPolicyConfig {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new SandboxPolicyError('$', 'expected an object');
    const c = input as Record<string, unknown>;
    const out: SandboxPolicyConfig = {};
    if (c.preset !== undefined) {
        if (!isPermissionPreset(c.preset)) throw new SandboxPolicyError('preset', `unknown preset ${JSON.stringify(c.preset)}`);
        out.preset = c.preset;
    }
    if (c.mode !== undefined) out.mode = oneOf('mode', c.mode, MODES);
    if (c.approval !== undefined) out.approval = oneOf('approval', c.approval, APPROVALS);
    if (c.network !== undefined) out.network = oneOf('network', c.network, NETWORKS);
    if (c.roots !== undefined) out.roots = stringList('roots', c.roots);
    if (c.writeTools !== undefined) out.writeTools = stringList('writeTools', c.writeTools);
    if (c.commandTools !== undefined) out.commandTools = stringList('commandTools', c.commandTools);
    if (c.ownStateTools !== undefined) out.ownStateTools = stringList('ownStateTools', c.ownStateTools);
    if (c.env !== undefined) {
        const e = c.env as Record<string, unknown>;
        if (typeof e !== 'object' || e === null) throw new SandboxPolicyError('env', 'expected an object');
        out.env = {
            ...(e.allow !== undefined ? { allow: stringList('env.allow', e.allow) } : {}),
            ...(e.deny !== undefined ? { deny: stringList('env.deny', e.deny) } : {}),
        };
    }
    if (c.rules !== undefined) {
        if (!Array.isArray(c.rules)) throw new SandboxPolicyError('rules', 'expected an array');
        out.rules = c.rules.map((r, i) => {
            const rule = r as Record<string, unknown>;
            if (typeof rule !== 'object' || rule === null) throw new SandboxPolicyError(`rules[${i}]`, 'expected an object');
            if (rule.agentId !== undefined && typeof rule.agentId !== 'string') throw new SandboxPolicyError(`rules[${i}].agentId`, 'expected a string');
            if (rule.tool !== undefined && typeof rule.tool !== 'string') throw new SandboxPolicyError(`rules[${i}].tool`, 'expected a string');
            return {
                ...(rule.agentId !== undefined ? { agentId: rule.agentId as string } : {}),
                ...(rule.tool !== undefined ? { tool: rule.tool as string } : {}),
                ...(rule.mode !== undefined ? { mode: oneOf(`rules[${i}].mode`, rule.mode, MODES) } : {}),
                ...(rule.network !== undefined ? { network: oneOf(`rules[${i}].network`, rule.network, NETWORKS) } : {}),
            };
        });
    }
    return out;
}

/**
 * The single place that decides how a call is confined. It is plain data behind two methods: `set` swaps the
 * whole configuration (taking effect on the NEXT call, never in the middle of one) and `snapshot` shows it.
 */
export interface SandboxPolicy {
    resolve(caller: SandboxCaller, tool: string): ResolvedPolicy;
    /** Replaces the configuration after validating it. A throwing call leaves the current policy untouched. */
    set(config: SandboxPolicyConfig): void;
    /** A copy of the current configuration. */
    snapshot(): SandboxPolicyConfig;
    /** Tools refused while `read-only` whatever they declare. */
    writeTools(): readonly string[];
    /** Tools that write only the agent's own state: allowed in `read-only`, never asked about. */
    ownStateTools(): readonly string[];
    /** Tools that count as running a command for the approval level. */
    commandTools(): readonly string[];
    /** Increments on every successful `set`, so a control plane can tell whether its copy is current. */
    readonly version: number;
}

export function createSandboxPolicy(initial: SandboxPolicyConfig = {}): SandboxPolicy {
    let config = parsePolicyConfig(initial);
    let version = 1;

    return {
        resolve(caller, tool) {
            const preset = PERMISSION_PRESETS[config.preset ?? 'ask'];
            let mode = config.mode ?? preset.mode;
            let ruleNetwork: SandboxNetwork | undefined;
            const rule = (config.rules ?? []).find(r =>
                (r.agentId === undefined || r.agentId === caller.agentId) && (r.tool === undefined || r.tool === tool));
            if (rule) {
                if (rule.mode) mode = rule.mode;
                ruleNetwork = rule.network;
            }
            const approval = config.approval ?? preset.approval;
            return {
                mode,
                network: ruleNetwork ?? config.network ?? defaultNetwork(mode),
                approval,
                roots: [...(config.roots ?? [])],
                env: { allow: [...(config.env?.allow ?? [])], deny: [...(config.env?.deny ?? [])] },
                preset: matchPreset(mode, approval),
            };
        },
        set(next) {
            config = parsePolicyConfig(next);
            version++;
        },
        snapshot: () => JSON.parse(JSON.stringify(config)) as SandboxPolicyConfig,
        writeTools: () => config.writeTools ?? [],
        ownStateTools: () => config.ownStateTools ?? [],
        commandTools: () => config.commandTools ?? ['run_command'],
        get version() { return version; },
    };
}
