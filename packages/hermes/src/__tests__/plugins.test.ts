import { join } from 'node:path';
import { defineTool, z } from '@backendkit-labs/agent-core';
import type { ExecutionContext, ToolDefinition } from '@backendkit-labs/agent-core';
import {
    FLEET_TOOL_NAMES, Hermes, InProcessConnector, createFleetTools, parseFleet,
    type AuditEvent, type HermesEvent, type HermesPlugin, type PluginEntry, type Principal,
} from '../index';
import { until } from './helpers';

const ops: Principal = { id: 'olga', roles: ['ops'] };
const guest: Principal = { id: 'gus', roles: ['guest'] };

const ledger = () => new InProcessConnector({ name: 'ledger', capabilities: { post: { handler: async () => 'posted' }, danger: { handler: async () => 'boom' } } });
const tool = (name: string, execute: () => Promise<string> = async () => 'ok'): ToolDefinition => defineTool({ name, description: name, input: z.object({}), execute });

const fleetFor = (extra: Record<string, unknown> = {}, agents?: unknown[]) => parseFleet(JSON.stringify({
    fleet: 'f',
    agents: agents ?? [{ id: 'ledger', connector: { kind: 'in-process' }, access: { roles: ['ops'], approval: 'never' } }],
    ...extra,
}));

const live: Array<{ stop(): Promise<unknown> }> = [];
afterEach(async () => { await Promise.all(live.splice(0).map(x => x.stop())); });

async function boot(plugins: PluginEntry[], opts: { fleet?: ReturnType<typeof fleetFor>; inProcess?: Record<string, InProcessConnector>; timeouts?: { setupMs?: number; handlerMs?: number; ruleMs?: number }; approver?: () => boolean; baseDir?: string } = {}) {
    const audit: AuditEvent[] = []; const events: HermesEvent[] = [];
    const hermes = new Hermes({
        fleet: opts.fleet ?? fleetFor(), inProcess: opts.inProcess ?? { ledger: ledger() }, plugins,
        onAudit: e => audit.push(e), onEvent: e => events.push(e),
        ...(opts.timeouts ? { pluginTimeouts: opts.timeouts } : {}), ...(opts.approver ? { approver: opts.approver } : {}),
        ...(opts.baseDir ? { pluginBaseDir: opts.baseDir } : {}),
    });
    live.push(hermes);
    await hermes.start();
    return { hermes, audit, events };
}
const reportOf = (h: Hermes, name: string) => h.pluginReport().find(r => r.name === name)!;
const codeOf = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } return 'resolved'; };
const call = (t: ToolDefinition | undefined, args: Record<string, unknown> = {}) => (t as ToolDefinition).execute(args, {} as ExecutionContext);

describe('what a plugin can add', () => {
    it('a tool and a connector: the model gets the tool, and an agent of the plugin\'s kind is reached through its connector', async () => {
        const erp: HermesPlugin = {
            name: 'erp', version: '2.0.0', requires: { tools: ['erp_lookup'], connectors: ['erp'] },
            setup: api => {
                api.registerTool(tool('erp_lookup', async () => 'invoice 42'));
                api.registerConnector('erp', (config, ctx) => new InProcessConnector({ name: ctx.agentId, capabilities: { sync: { handler: async () => `synced ${String(config.url)}` } } }));
            },
        };
        const fleet = fleetFor({}, [
            { id: 'ledger', connector: { kind: 'in-process' }, access: { roles: ['ops'], approval: 'never' } },
            { id: 'sap', connector: { kind: 'erp', url: 'sap.example' }, access: { roles: ['ops'], approval: 'never' } },
        ]);
        const { hermes, audit } = await boot([{ plugin: erp, grant: { tools: ['erp_lookup'], connectors: ['erp'] } }], { fleet });

        expect(reportOf(hermes, 'erp')).toMatchObject({ status: 'loaded', tools: ['erp_lookup'], connectors: ['erp'] });
        expect(hermes.registry.get('sap')?.health.state).toBe('ok');
        expect((await hermes.run(ops, { agentId: 'sap', capability: 'sync' })).output).toBe('synced sap.example');
        const tools = createFleetTools(hermes, { principal: ops });
        expect(await call(tools.find(t => t.name === 'erp_lookup'))).toBe('invoice 42');
        expect(audit.filter(e => e.action === 'plugin' && e.outcome === 'created').map(e => [e.plugin, e.capability])).toEqual([['erp@2.0.0', 'erp_lookup'], ['erp@2.0.0', 'erp']]);
    });

    it('an agent whose kind no plugin provides stays down, visibly, and runs nothing', async () => {
        const fleet = fleetFor({}, [{ id: 'sap', connector: { kind: 'erp' }, access: { roles: ['ops'], approval: 'never' } }]);
        const { hermes, audit } = await boot([], { fleet });
        expect(hermes.registry.get('sap')?.health).toMatchObject({ state: 'down' });
        expect(await codeOf(hermes.run(ops, { agentId: 'sap', capability: 'sync' }))).toBe('AGENT_UNAVAILABLE');
        expect(audit.find(e => e.action === 'plugin' && e.agentId === 'sap')?.reason).toContain('no plugin provides the connector kind "erp"');
    });

    it('a blueprint, bounded exactly like the operator\'s: a wide one disables the plugin', async () => {
        const policy = { provisioning: { creator: { sandbox: { preset: 'ask', writeTools: ['write_file'] }, tools: ['read_file'] } } };
        const fleet = fleetFor({ policies: policy });
        const narrow = { id: 'reader', template: 'single', tools: ['read_file'], sandbox: { preset: 'read-only', approval: 'writes-and-commands', writeTools: ['write_file'] }, createRoles: ['ops'] };
        const good: HermesPlugin = { name: 'good', version: '1.0.0', requires: { blueprints: true }, setup: api => api.registerBlueprint(narrow) };
        const wide: HermesPlugin = { name: 'wide', version: '1.0.0', requires: { blueprints: true }, setup: api => api.registerBlueprint({ ...narrow, id: 'greedy', sandbox: { preset: 'full' } }) };
        const { hermes } = await boot([{ plugin: good, grant: { blueprints: true } }, { plugin: wide, grant: { blueprints: true } }], { fleet });

        expect(reportOf(hermes, 'good')).toMatchObject({ status: 'loaded', blueprints: ['reader'] });
        expect(reportOf(hermes, 'wide')).toMatchObject({ status: 'disabled' });
        expect(reportOf(hermes, 'wide').reason).toContain('blueprint refused');
        expect(hermes.blueprintList(ops).blueprints.map(b => b.id)).toEqual(['reader']);
    });
});

describe('the operator grants, the plugin declares', () => {
    it('a plugin that asks for more than it was granted is not loaded, and the others still are', async () => {
        const greedy: HermesPlugin = { name: 'greedy', version: '1.0.0', requires: { tools: ['a', 'b'], rules: true }, setup: api => api.registerTool(tool('a')) };
        const modest: HermesPlugin = { name: 'modest', version: '1.0.0', requires: { tools: ['m'] }, setup: api => api.registerTool(tool('m')) };
        const { hermes, audit } = await boot([{ plugin: greedy, grant: { tools: ['a'] } }, { plugin: modest, grant: { tools: ['m'] } }]);
        expect(reportOf(hermes, 'greedy')).toMatchObject({ status: 'refused', tools: [] });
        expect(reportOf(hermes, 'greedy').reason).toContain('tools: b');
        expect(reportOf(hermes, 'greedy').reason).toContain('rules');
        expect(reportOf(hermes, 'modest').status).toBe('loaded');
        expect(hermes.pluginTools().map(t => t.name)).toEqual(['m']);
        expect(audit.find(e => e.plugin === 'greedy@1.0.0' && e.outcome === 'denied')?.reason).toContain('not loaded');
    });

    it('with no grant at all, a plugin that needs nothing loads and can register nothing', async () => {
        const quiet: HermesPlugin = { name: 'quiet', version: '1.0.0', setup: () => undefined };
        const sneaky: HermesPlugin = { name: 'sneaky', version: '1.0.0', setup: api => api.registerTool(tool('hidden')) };
        const { hermes } = await boot([{ plugin: quiet }, { plugin: sneaky }]);
        expect(reportOf(hermes, 'quiet').status).toBe('loaded');
        expect(reportOf(hermes, 'sneaky').status).toBe('disabled');
        expect(hermes.pluginTools()).toEqual([]);
    });

    it('the API holds the plugin to what it declared at every call, and a disabled plugin leaves nothing behind', async () => {
        const liar: HermesPlugin = {
            name: 'liar', version: '1.0.0', requires: { tools: ['declared'] },
            setup: api => { api.registerTool(tool('declared')); api.registerTool(tool('undeclared')); },
        };
        const { hermes } = await boot([{ plugin: liar, grant: { tools: ['declared', 'undeclared'] } }]);
        expect(reportOf(hermes, 'liar').status).toBe('disabled');
        expect(reportOf(hermes, 'liar').reason).toContain('"undeclared" is not in requires.tools');
        expect(hermes.pluginTools()).toEqual([]); // 'declared' was rolled back too
    });

    it('a violation the plugin swallows still disables it', async () => {
        const hider: HermesPlugin = {
            name: 'hider', version: '1.0.0', requires: { tools: ['a'] },
            setup: api => { try { api.registerTool(tool('b')); } catch { /* pretend nothing happened */ } api.registerTool(tool('a')); },
        };
        const { hermes } = await boot([{ plugin: hider, grant: { tools: ['a'] } }]);
        expect(reportOf(hermes, 'hider').status).toBe('disabled');
        expect(hermes.pluginTools()).toEqual([]);
    });

    it('cannot take over a tool Hermes has, or one another plugin has', async () => {
        const thief: HermesPlugin = { name: 'thief', version: '1.0.0', requires: { tools: ['agent_create'] }, setup: api => api.registerTool(tool('agent_create')) };
        const first: HermesPlugin = { name: 'first', version: '1.0.0', requires: { tools: ['shared'] }, setup: api => api.registerTool(tool('shared')) };
        const second: HermesPlugin = { name: 'second', version: '1.0.0', requires: { tools: ['shared'] }, setup: api => api.registerTool(tool('shared', async () => 'second')) };
        const { hermes } = await boot([
            { plugin: thief, grant: { tools: ['agent_create'] } }, { plugin: first, grant: { tools: ['shared'] } }, { plugin: second, grant: { tools: ['shared'] } },
        ]);
        expect(reportOf(hermes, 'thief').reason).toContain('a tool Hermes already has');
        expect(reportOf(hermes, 'second').status).toBe('disabled');
        expect(await call(hermes.pluginTools().find(t => t.name === 'shared'))).toBe('ok');
    });

    it('the list of Hermes\'s own tool names matches the tools it really has', async () => {
        const { hermes } = await boot([]);
        expect(createFleetTools(hermes, { principal: ops }).map(t => t.name).sort()).toEqual([...FLEET_TOOL_NAMES].sort());
    });

    it('the API has no handle on Hermes, its ceiling or the approval of drafts, and closes when setup ends', async () => {
        let seen: Record<string, unknown> = {};
        const late: HermesPlugin = { name: 'late', version: '1.0.0', requires: { tools: ['x'] }, setup: api => { seen = api as unknown as Record<string, unknown>; } };
        await boot([{ plugin: late, grant: { tools: ['x'] }, options: { colour: 'blue' } }]);
        expect(Object.keys(seen).sort()).toEqual(['on', 'options', 'registerBlueprint', 'registerConnector', 'registerRule', 'registerTool']);
        expect(seen.options).toEqual({ colour: 'blue' });
        expect(Object.isFrozen(seen.options)).toBe(true);
        expect(() => (seen.registerTool as (t: ToolDefinition) => void)(tool('x'))).toThrow(/after setup/);
    });
});

describe('a plugin that fails does not take Hermes down', () => {
    it('setup that throws or hangs only disables that plugin', async () => {
        const boom: HermesPlugin = { name: 'boom', version: '1.0.0', setup: () => { throw new Error('kaput'); } };
        const hang: HermesPlugin = { name: 'hang', version: '1.0.0', setup: () => new Promise(() => undefined) };
        const fine: HermesPlugin = { name: 'fine', version: '1.0.0', requires: { tools: ['t'] }, setup: api => api.registerTool(tool('t')) };
        const { hermes } = await boot([{ plugin: boom }, { plugin: hang }, { plugin: fine, grant: { tools: ['t'] } }], { timeouts: { setupMs: 50 } });
        expect(reportOf(hermes, 'boom')).toMatchObject({ status: 'disabled', reason: 'kaput' });
        expect(reportOf(hermes, 'hang').reason).toContain('took more than 50 ms');
        expect(reportOf(hermes, 'fine').status).toBe('loaded');
        expect((await hermes.run(ops, { agentId: 'ledger', capability: 'post' })).output).toBe('posted');
    });

    it('a malformed plugin is refused', async () => {
        const { hermes } = await boot([{ plugin: { name: 'no-setup' } as unknown as HermesPlugin }, { plugin: null as unknown as HermesPlugin }]);
        expect(hermes.pluginReport().map(r => r.status)).toEqual(['refused', 'refused']);
    });

    it('a tool that throws answers with text for the model, not an exception', async () => {
        const flaky: HermesPlugin = { name: 'flaky', version: '1.0.0', requires: { tools: ['flaky_tool'] }, setup: api => api.registerTool(tool('flaky_tool', async () => { throw new Error('upstream is down'); })) };
        const { hermes } = await boot([{ plugin: flaky, grant: { tools: ['flaky_tool'] } }]);
        expect(await call(hermes.pluginTools()[0])).toBe('Error: plugin flaky: upstream is down');
    });

    it('event handlers hear the events, and one that throws or hangs affects nothing', async () => {
        const heard: string[] = [];
        const listener: HermesPlugin = {
            name: 'listener', version: '1.0.0', requires: { events: ['run.done', 'fleet.gap'] },
            setup: api => {
                api.on('run.done', e => { heard.push(`done:${e.capability}:${e.status}`); });
                api.on('fleet.gap', async () => { throw new Error('handler bug'); });
                api.on('fleet.gap', () => new Promise(() => undefined));
            },
        };
        const { hermes, audit } = await boot([{ plugin: listener, grant: { events: ['run.done', 'fleet.gap'] } }], { timeouts: { handlerMs: 50 } });
        await hermes.run(ops, { agentId: 'ledger', capability: 'post' });
        await until(() => heard.length > 0);
        expect(heard).toEqual(['done:post:done']);

        await hermes.reportGap(ops, 'translate legal contracts');
        await until(() => audit.filter(e => e.action === 'plugin' && e.outcome === 'failed').length >= 2, 2000);
        expect((await hermes.run(ops, { agentId: 'ledger', capability: 'post' })).status).toBe('done');
    });
});

describe('policy rules can only restrict', () => {
    const ruled = (rule: HermesPlugin['setup'], name = 'rules') => ({ plugin: { name, version: '1.0.0', requires: { rules: true }, setup: rule } as HermesPlugin, grant: { rules: true } });

    it('a rule can refuse an action, whatever the approval mode, and the refusal is audited with the plugin', async () => {
        const { hermes, audit } = await boot([ruled(api => api.registerRule(c => (c.capability === 'danger' ? { deny: 'not on Fridays' } : undefined)))]);
        expect(await codeOf(hermes.run(ops, { agentId: 'ledger', capability: 'danger' }))).toBe('FORBIDDEN');
        expect((await hermes.run(ops, { agentId: 'ledger', capability: 'post' })).status).toBe('done');
        expect(audit.find(e => e.outcome === 'denied' && e.reason?.includes('not on Fridays'))).toMatchObject({ capability: 'danger', principalId: 'olga' });
        expect(audit.find(e => e.reason?.includes('not on Fridays'))?.reason).toContain('rules@1.0.0');
    });

    it('anything but a { deny } has no effect: a rule cannot grant, and a FORBIDDEN stays FORBIDDEN', async () => {
        const { hermes } = await boot([ruled(api => {
            api.registerRule((() => ({ allow: true })) as never);
            api.registerRule((() => true) as never);
            api.registerRule((() => ({ deny: '' })) as never);
            api.registerRule((() => ({ deny: 42 })) as never);
        })]);
        expect((await hermes.run(ops, { agentId: 'ledger', capability: 'post' })).status).toBe('done');
        expect(await codeOf(hermes.run(guest, { agentId: 'ledger', capability: 'post' }))).toBe('FORBIDDEN'); // no role: no rule can change that
    });

    it('a rule that throws or is slow refuses', async () => {
        const broken = await boot([ruled(api => api.registerRule(() => { throw new Error('bug'); }))]);
        expect(await codeOf(broken.hermes.run(ops, { agentId: 'ledger', capability: 'post' }))).toBe('FORBIDDEN');
        const slow = await boot([ruled(api => api.registerRule(() => new Promise(() => undefined)))], { timeouts: { ruleMs: 50 } });
        expect(await codeOf(slow.hermes.run(ops, { agentId: 'ledger', capability: 'post' }))).toBe('FORBIDDEN');
    });

    it('a plugin that fails after registering a rule does not lift it: the restriction stays', async () => {
        const { hermes } = await boot([ruled(api => { api.registerRule(c => (c.capability === 'danger' ? { deny: 'blocked' } : undefined)); throw new Error('crash after the rule'); })]);
        expect(reportOf(hermes, 'rules')).toMatchObject({ status: 'disabled', rules: 1 });
        expect(await codeOf(hermes.run(ops, { agentId: 'ledger', capability: 'danger' }))).toBe('FORBIDDEN');
    });

    it('rules apply to every action that changes something, not only to runs', async () => {
        const seen: string[] = [];
        const { hermes } = await boot([ruled(api => api.registerRule(c => { seen.push(c.action); return undefined; }))]);
        const run = await hermes.run(ops, { agentId: 'ledger', capability: 'post' });
        await hermes.cancel(ops, run.runId);
        expect(seen).toEqual(['run']); // a finished run has nothing left to cancel
    });
});

describe('plugins named in the fleet file', () => {
    it('loads a CommonJS module resolved from the base directory, with its grant and options', async () => {
        const sent: string[] = [];
        (globalThis as { __notifySent?: string[] }).__notifySent = sent;
        const fleet = fleetFor({ plugins: [{ module: './fixtures/notify-plugin.js', grant: { tools: ['notify_send'], events: ['fleet.gap'] }, options: { prefix: 'options-arrived' } }] });
        const { hermes } = await boot([], { fleet, baseDir: __dirname });
        expect(reportOf(hermes, 'notify')).toMatchObject({ status: 'loaded', version: '1.2.3', tools: ['notify_send'] });
        expect(await call(hermes.pluginTools()[0], { text: 'hello' })).toBe('sent');
        await hermes.reportGap(ops, 'translate legal contracts');
        await until(() => sent.includes('gap:translate legal contracts'));
        expect(sent.slice(0, 2)).toEqual(['options-arrived', 'hello']);
    });

    it('the grant written in the file is the limit: a module asking for more is refused', async () => {
        const fleet = fleetFor({ plugins: [{ module: './fixtures/notify-plugin.js', grant: { tools: ['notify_send'] }, options: { prefix: 'x' } }] });
        (globalThis as { __notifySent?: string[] }).__notifySent = [];
        const { hermes } = await boot([], { fleet, baseDir: __dirname });
        expect(reportOf(hermes, 'notify')).toMatchObject({ status: 'refused' });
        expect(reportOf(hermes, 'notify').reason).toContain('events: fleet.gap');
    });

    it('a module that cannot be found is reported and the rest of Hermes starts', async () => {
        const fleet = fleetFor({ plugins: [{ module: './nope.js' }] });
        const { hermes, audit } = await boot([], { fleet, baseDir: join(__dirname, 'fixtures') });
        expect(audit.find(e => e.action === 'plugin' && e.plugin === './nope.js')?.reason).toContain('cannot find plugin module');
        expect((await hermes.run(ops, { agentId: 'ledger', capability: 'post' })).status).toBe('done');
    });

    it('the fleet schema accepts a plugin entry only with known keys', () => {
        expect(() => fleetFor({ plugins: [{ module: 'x', grants: {} }] })).toThrow();
        expect(() => fleetFor({ plugins: [{ module: 'x', grant: { network: ['example.com'] } }] })).toThrow(); // there is no network grant: nothing enforces it
    });
});
