import type { ToolDefinition } from '@backendkit-labs/agent-core';
import type { AuditLog } from '../audit';
import { HermesError, type HermesEvent } from '../errors';
import type { Blueprint } from '../fleet/provisioning';
import type {
    ConnectorFactory, HermesPlugin, HermesPluginApi, PluginGrant, PluginReport, PluginRequires, PolicyRule, RuleContext,
} from './types';

export interface PluginEntry {
    plugin: HermesPlugin;
    /** What the operator grants. Absent: nothing, so a plugin that requires anything is refused. */
    grant?: PluginGrant;
    options?: Record<string, unknown>;
}

export interface PluginHostDeps {
    audit: AuditLog;
    /** Tool names Hermes already has: a plugin cannot take them over. */
    reservedTools: ReadonlySet<string>;
    /** Parses a blueprint and checks it against what Hermes may hand out and the ids in use. Throws when it is not acceptable. */
    parseBlueprint(input: unknown, taken: ReadonlySet<string>): Blueprint;
    /** Makes a checked blueprint available to `agent_create`. */
    addBlueprint(blueprint: Blueprint, source: string): void;
    setupTimeoutMs?: number;
    handlerTimeoutMs?: number;
    ruleTimeoutMs?: number;
}

/** Thrown inside the plugin API when a plugin steps outside what it declared and was granted. The plugin is disabled. */
class PluginViolation extends Error {}

const withTimeout = <T>(work: Promise<T>, ms: number, what: string): Promise<T> => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took more than ${ms} ms`)), ms);
    timer.unref?.();
    work.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});

const label = (p: { name: string; version: string }) => `${p.name}@${p.version}`;

/**
 * Loads plugins and keeps what they add. The operator grants, the plugin declares, and the API holds both to it at every call.
 * A plugin that fails never takes Hermes down; and a failure never lifts a restriction: the rules a plugin registered stay in
 * force even when the plugin is disabled afterwards.
 */
export class PluginHost {
    private readonly toolMap = new Map<string, { plugin: string; tool: ToolDefinition }>();
    private readonly connectorMap = new Map<string, { plugin: string; factory: ConnectorFactory }>();
    private readonly rules: Array<{ plugin: string; rule: PolicyRule }> = [];
    private readonly handlers = new Map<string, Array<{ plugin: string; fn: (e: never) => void | Promise<void> }>>();
    private readonly names = new Set<string>();
    private readonly reports: PluginReport[] = [];

    constructor(private readonly deps: PluginHostDeps) {}

    report(): PluginReport[] { return this.reports.map(r => ({ ...r })); }

    /** The tools plugins added, wrapped so a failure comes back as text for the model, not as an exception. */
    toolDefinitions(): ToolDefinition[] { return [...this.toolMap.values()].map(t => t.tool); }

    connectorFactory(kind: string): ConnectorFactory | undefined { return this.connectorMap.get(kind)?.factory; }

    async load(entries: PluginEntry[]): Promise<void> {
        for (const entry of entries) await this.loadOne(entry);
    }

    private audit(plugin: { name?: unknown; version?: unknown }, outcome: 'allowed' | 'denied' | 'failed' | 'created', reason: string, capability?: string): void {
        this.deps.audit.record({
            action: 'plugin', outcome, reason, ...(capability ? { capability } : {}),
            plugin: `${String(plugin.name)}@${String(plugin.version)}`,
        });
    }

    private async loadOne(entry: PluginEntry): Promise<void> {
        const p = entry.plugin as Partial<HermesPlugin> | undefined;
        const report: PluginReport = { name: String(p?.name ?? '?'), ...(typeof p?.version === 'string' ? { version: p.version } : {}), status: 'refused', tools: [], connectors: [], blueprints: [], rules: 0 };
        this.reports.push(report);
        const refuse = (reason: string) => { report.reason = reason; this.audit(p ?? {}, 'denied', `not loaded: ${reason}`); };

        if (!p || typeof p.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._@/-]{0,79}$/.test(p.name) || typeof p.version !== 'string' || typeof p.setup !== 'function') {
            return refuse('not a Hermes plugin: it needs a name, a version and a setup function');
        }
        if (this.names.has(p.name)) return refuse(`a plugin named "${p.name}" is already loaded`);

        const grant = entry.grant ?? {};
        const asked = excess(p.requires ?? {}, grant);
        if (asked.length) return refuse(`asks for what the operator did not grant: ${asked.join('; ')}`);
        this.names.add(p.name);

        const plugin = p as HermesPlugin;
        const who = label(plugin);
        const requires = plugin.requires ?? {};
        const staged = { tools: [] as ToolDefinition[], connectors: [] as Array<[string, ConnectorFactory]>, blueprints: [] as Blueprint[], handlers: [] as Array<[string, (e: never) => void | Promise<void>]> };
        let open = true;
        let violation: string | undefined;
        const violate = (message: string): never => { violation ??= message; throw new PluginViolation(message); };
        const need = (ok: boolean, message: string) => { if (!open) violate('the plugin tried to register something after setup finished'); if (!ok) violate(message); };

        const api: HermesPluginApi = {
            options: Object.freeze({ ...(entry.options ?? {}) }),
            registerTool: tool => {
                const name = (tool as { name?: unknown })?.name;
                need(typeof name === 'string' && (requires.tools ?? []).includes(name), `tool "${String(name)}" is not in requires.tools`);
                need(!this.deps.reservedTools.has(name as string), `tool "${String(name)}" is a tool Hermes already has`);
                need(!this.toolMap.has(name as string) && !staged.tools.some(t => t.name === name), `tool "${String(name)}" already exists`);
                staged.tools.push(wrapTool(tool, plugin.name));
            },
            registerConnector: (kind, factory) => {
                need((requires.connectors ?? []).includes(kind), `connector kind "${kind}" is not in requires.connectors`);
                need(!this.connectorMap.has(kind) && !staged.connectors.some(([k]) => k === kind), `connector kind "${kind}" already has a provider`);
                need(typeof factory === 'function', `the connector factory for "${kind}" is not a function`);
                staged.connectors.push([kind, factory]);
            },
            registerBlueprint: input => {
                need(requires.blueprints === true, 'the plugin did not declare requires.blueprints');
                // parsed and checked now, so a refused blueprint is a violation; made available only if setup succeeds
                try { staged.blueprints.push(this.deps.parseBlueprint(input, new Set(staged.blueprints.map(b => b.id)))); }
                catch (err) { violate(`blueprint refused: ${(err as Error).message}`); }
            },
            registerRule: rule => {
                need(requires.rules === true, 'the plugin did not declare requires.rules');
                need(typeof rule === 'function', 'a rule must be a function');
                // Rules are in force from the moment they are registered and stay so if the plugin later fails.
                this.rules.push({ plugin: who, rule });
                report.rules++;
            },
            on: (event, handler) => {
                need((requires.events ?? []).includes(event), `event "${event}" is not in requires.events`);
                const item: [string, (e: never) => void | Promise<void>] = [event, handler as (e: never) => void | Promise<void>];
                staged.handlers.push(item);
                return () => { const list = this.handlers.get(event); if (list) this.handlers.set(event, list.filter(h => h.fn !== item[1])); };
            },
        };

        try {
            await withTimeout(Promise.resolve().then(() => plugin.setup(api)), this.deps.setupTimeoutMs ?? 5000, `setup of ${who}`);
            if (violation) throw new PluginViolation(violation); // a violation the plugin swallowed still counts
        } catch (err) {
            open = false;
            report.status = 'disabled';
            report.reason = (err as Error).message;
            report.version = plugin.version;
            this.audit(plugin, err instanceof PluginViolation ? 'denied' : 'failed', `disabled: ${report.reason}${report.rules ? ` (its ${report.rules} rule(s) stay in force)` : ''}`);
            return;
        }
        open = false;

        // Commit. Collisions were checked on registration; checked again here because another plugin may have taken the name since.
        for (const tool of staged.tools) {
            if (this.toolMap.has(tool.name)) continue;
            this.toolMap.set(tool.name, { plugin: who, tool });
            report.tools.push(tool.name);
            this.audit(plugin, 'created', 'tool', tool.name);
        }
        for (const [kind, factory] of staged.connectors) {
            this.connectorMap.set(kind, { plugin: who, factory });
            report.connectors.push(kind);
            this.audit(plugin, 'created', 'connector', kind);
        }
        for (const bp of staged.blueprints) {
            try { this.deps.addBlueprint(bp, who); report.blueprints.push(bp.id); this.audit(plugin, 'created', 'blueprint', bp.id); }
            catch (err) { this.audit(plugin, 'denied', `blueprint ${bp.id} not added: ${(err as Error).message}`, bp.id); }
        }
        for (const [event, fn] of staged.handlers) {
            this.handlers.set(event, [...(this.handlers.get(event) ?? []), { plugin: who, fn }]);
            this.audit(plugin, 'created', 'event handler', event);
        }
        if (report.rules) this.audit(plugin, 'created', `${report.rules} policy rule(s)`);
        report.status = 'loaded';
        this.audit(plugin, 'allowed', 'loaded');
    }

    /** Tells the listeners. Each handler has a deadline; none can affect Hermes or hold it up. */
    emit(event: HermesEvent): void {
        for (const h of this.handlers.get(event.type) ?? []) {
            void withTimeout(Promise.resolve().then(() => h.fn(event as never)), this.deps.handlerTimeoutMs ?? 2000, `${h.plugin} handler for ${event.type}`)
                .catch(err => this.deps.audit.record({ action: 'plugin', outcome: 'failed', plugin: h.plugin, capability: event.type, reason: `handler: ${(err as Error).message}` }));
        }
    }

    /**
     * Asks every rule, in the order they were registered. The first `{ deny }` refuses; a rule that fails or is slow refuses
     * too; anything else a rule returns changes nothing. This is the one place plugin rules are applied.
     */
    async checkRules(context: RuleContext): Promise<string | undefined> {
        for (const { plugin, rule } of this.rules) {
            try {
                const verdict = await withTimeout(Promise.resolve().then(() => rule(context)), this.deps.ruleTimeoutMs ?? 1000, `a rule of ${plugin}`);
                const deny = (verdict as { deny?: unknown } | undefined)?.deny;
                if (typeof deny === 'string' && deny) return `plugin ${plugin}: ${deny}`;
            } catch (err) {
                return `a rule of plugin ${plugin} failed and a failing rule refuses: ${(err as Error).message}`;
            }
        }
        return undefined;
    }

    /** Raises FORBIDDEN when a rule refuses; records who was refused and why. */
    async enforce(context: RuleContext): Promise<void> {
        const denial = await this.checkRules(context);
        if (!denial) return;
        this.deps.audit.record({ action: context.action === 'cancel' ? 'cancel' : context.action === 'run' ? 'run' : 'control', outcome: 'denied', principalId: context.principal.id, agentId: context.agentId, capability: context.capability, reason: denial });
        throw new HermesError('FORBIDDEN', `refused by policy: ${denial}`);
    }
}

/** What a plugin asks for beyond what it was granted, in words. */
function excess(requires: PluginRequires, grant: PluginGrant): string[] {
    const out: string[] = [];
    const lists: Array<['tools' | 'connectors' | 'events']> = [['tools'], ['connectors'], ['events']];
    for (const [key] of lists) {
        const missing = ((requires[key] ?? []) as string[]).filter(x => !((grant[key] ?? []) as string[]).includes(x));
        if (missing.length) out.push(`${key}: ${missing.join(', ')}`);
    }
    if (requires.blueprints && grant.blueprints !== true) out.push('blueprints');
    if (requires.rules && grant.rules !== true) out.push('rules');
    return out;
}

function wrapTool(tool: ToolDefinition, plugin: string): ToolDefinition {
    return {
        ...tool,
        execute: async (args, ctx) => {
            try { return await tool.execute(args, ctx); }
            catch (err) { return `Error: plugin ${plugin}: ${(err as Error).message}`; }
        },
    };
}
