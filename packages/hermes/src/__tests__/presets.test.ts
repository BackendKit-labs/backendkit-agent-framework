import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createBaseEngine } from '@backendkit-labs/agent-core';
import type { AgentProfile } from '@backendkit-labs/agent-core';
import { mockTransport, scriptedProvider } from '@backendkit-labs/agent-testkit';
import {
    Hermes, InProcessConnector, PresetError, applyPreset, createHermes, defaultStages, parseFleet, pipelinePreset,
    type HermesPreset, type Principal,
} from '../index';
import { until } from './helpers';
import { accountingPreset, supportPreset } from './fixtures/presets/domains';

const OPERATOR = `
fleet: acme
agents:
  - { id: ops-bot, connector: { kind: in-process }, access: { roles: [staff], approval: never } }
policies:
  approval: { default: never }
  provisioning:
    creator: { sandbox: { preset: ask, writeTools: [write_file] }, tools: [read_file], budgetUsdPerDay: 5 }
    operatorRoles: [admin]
`;
const opsBot = () => new InProcessConnector({ name: 'ops-bot', capabilities: { ping: { handler: async () => 'pong' } } });

const live: Array<{ stop(): Promise<unknown> }> = [];
afterEach(async () => { await Promise.all(live.splice(0).map(x => x.stop())); });

const codeOf = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } return 'resolved'; };

describe('the same mechanism loads presets of different domains, with no change to the core', () => {
    const cases: Array<{ domain: string; make: () => HermesPreset; roleMap: Record<string, string[]>; principal: Principal; need: string; agent: string; flow: string; input: Record<string, unknown>; finds: string; expect: string; blueprint: string }> = [
        {
            domain: 'accounting', make: accountingPreset, roleMap: { accountant: ['finance'] }, principal: { id: 'fay', roles: ['finance'] } as Principal,
            need: 'reconcile bank statement', agent: 'books', flow: 'close-month', input: { month: '2026-09', entries: 12 },
            finds: 'reconciler', expect: 'closed 2026-09: 12 entries, 2 unmatched', blueprint: 'audit-assistant',
        },
        {
            domain: 'support', make: supportPreset, roleMap: { agent: ['support-team'] }, principal: { id: 'sue', roles: ['support-team'] } as Principal,
            need: 'classify customer ticket urgency', agent: 'desk', flow: 'resolve-ticket', input: { ticket: 'T-9', subject: 'urgent outage' },
            finds: 'triage', expect: 'ticket T-9 escalated', blueprint: 'escalation-agent',
        },
    ];

    describe.each(cases)('$domain', c => {
        it('a scripted model finds an agent and runs the flow through the tools Hermes gives it', async () => {
            const { hermes, tools, guardrails } = createHermes({ fleet: OPERATOR, inProcess: { 'ops-bot': opsBot() }, presets: [{ preset: c.make(), roleMap: c.roleMap }] });
            live.push(hermes);
            await hermes.start();

            const profile: AgentProfile = {
                id: 'hermes', name: 'Hermes', icon: 'H', description: 'supervisor', systemPrompt: 'You supervise a fleet.',
                allowedTools: ['fleet_find', 'flow_run'], delegatesTo: [], model: 'tiny',
            };
            const provider = scriptedProvider([
                { tool_calls: [{ id: 'c1', name: 'fleet_find', args: { need: c.need } }, { id: 'c2', name: 'flow_run', args: { agent: c.agent, flow: c.flow, input: c.input } }] },
                { content: 'Started.' },
            ]);
            const { transport, eventsOf } = mockTransport();
            const engine = createBaseEngine({
                providers: { mock: provider }, defaultProvider: 'mock', agents: [profile], transport, iterationMode: 'auto',
                tools: tools({ principal: c.principal }), guardrails: guardrails(),
            });
            await engine.run('do the work');

            expect(eventsOf('tool_result').map(e => [e.name, e.success])).toEqual([['fleet_find', true], ['flow_run', true]]);
            expect(JSON.stringify(provider.calls[1])).toContain(c.finds);
            const run = hermes.store.list({ agentId: c.agent })[0];
            await until(() => hermes.status(c.principal, run.runId).status === 'done', 5000);
            expect(hermes.result(c.principal, run.runId).output).toBe(c.expect);
        });

        it('its role names become the company\'s, and a principal without them sees none of its agents', () => {
            const { hermes } = createHermes({ fleet: OPERATOR, inProcess: { 'ops-bot': opsBot() }, presets: [{ preset: c.make(), roleMap: c.roleMap }] });
            live.push(hermes);
            expect(hermes.registry.list().filter(a => a.config.tags?.some(t => t.startsWith('preset:'))).map(a => hermes.list(c.principal).some(v => v.id === a.id))).toEqual([true, true, true]);
            expect(hermes.list({ id: 'gus', roles: ['guest'] })).toEqual([]);
            expect(hermes.blueprintList({ ...c.principal, roles: [...c.principal.roles, 'admin'] }).blueprints.map(b => b.id)).toEqual([c.blueprint]);
        });
    });
});

describe('a preset brings content; the operator keeps the limits', () => {
    const base = () => parseFleet(OPERATOR);
    const preset = (extra: Record<string, unknown> = {}): HermesPreset => ({ name: 'p', version: '1', ...extra } as HermesPreset);
    const message = (fn: () => unknown): string => { try { fn(); } catch (e) { return (e as Error).message; } return 'no error'; };

    it('cannot set policies, what Hermes may hand out, who approves drafts, or approval defaults', () => {
        for (const extra of [
            { policies: { approval: { default: 'never' } } },
            { policies: { provisioning: { creator: { sandbox: { preset: 'full' }, tools: ['run_command'] } } } },
            { operatorRoles: ['everyone'] },
            { fleet: 'takeover' },
        ]) {
            expect(applyPreset.bind(null, base(), preset(extra))).toThrow(PresetError);
        }
    });

    it('cannot grant its own plugins anything, nor point Hermes at an address and a key', () => {
        expect(message(() => applyPreset(base(), preset({ plugins: [{ module: 'x', grant: { rules: true } }] })))).toContain('not a valid preset');
        const remote = preset({ agents: [{ id: 'remote', connector: { kind: 'protocol', url: 'http://elsewhere', apiKey: { env: 'KEY' } } }] });
        expect(message(() => applyPreset(base(), remote))).toContain('cannot point Hermes at an address or a key');
    });

    it('the operator grants a preset\'s plugins in their own file, and only that grant applies', () => {
        const withPlugin = preset({ plugins: [{ module: './p.js' }] });
        const none = applyPreset(base(), withPlugin);
        expect(none.fleet.plugins?.[0]).toEqual({ module: './p.js' });
        const granted = applyPreset(base(), withPlugin, { grants: { './p.js': { tools: ['t'] } } });
        expect(granted.fleet.plugins?.[0].grant).toEqual({ tools: ['t'] });
    });

    it('a blueprint wider than the operator allows is refused with the preset\'s name', () => {
        const wide = preset({ blueprints: [{ id: 'greedy', template: 'single', tools: ['read_file'], sandbox: { preset: 'full' }, limits: { budgetUsdPerDay: 1 } }] });
        const error = message(() => applyPreset(base(), wide));
        expect(error).toContain('Preset "p"');
        expect(error).toContain('blueprints.0.sandbox');
        const loose = preset({ blueprints: [{ id: 'tools', template: 'single', tools: ['run_command'], sandbox: { preset: 'read-only', approval: 'writes-and-commands', writeTools: ['write_file'] }, limits: { budgetUsdPerDay: 1 } }] });
        expect(message(() => applyPreset(base(), loose))).toContain('blueprints.0.tools');
    });

    it('an approval looser than the operator\'s default is raised to it, and the change is reported', () => {
        const strict = parseFleet(OPERATOR.replace('default: never', 'default: ask'));
        const applied = applyPreset(strict, preset({ agents: [{ id: 'a', connector: { kind: 'in-process' }, access: { roles: ['r'], approval: 'never', capabilities: { x: { approval: 'never' } } } }], connectors: { a: () => opsBot() } }));
        const added = applied.fleet.agents.find(a => a.id === 'a')!;
        expect(added.access?.approval).toBe('ask');
        expect(added.access?.capabilities?.x.approval).toBe('ask');
        expect(applied.notes).toEqual(['a: approval "never" raised to "ask" (the operator\'s default)', 'a.x: approval "never" raised to "ask" (the operator\'s default)']);
    });

    it('refuses an id that is already in the fleet, and an in-process agent with no code behind it', () => {
        const dup = preset({ agents: [{ id: 'ops-bot', connector: { kind: 'in-process' } }], connectors: { 'ops-bot': () => opsBot() } });
        expect(message(() => applyPreset(base(), dup))).toContain('already in the fleet');
        const empty = preset({ agents: [{ id: 'orphan', connector: { kind: 'in-process' } }] });
        expect(message(() => applyPreset(base(), empty))).toContain('no connector for it');
    });

    it('a Hermes built directly cannot carry unapplied presets: only createHermes merges and checks them', () => {
        const withPresets = parseFleet(`${OPERATOR}presets:\n  - { module: ./x.js }\n`);
        expect(() => new Hermes({ fleet: withPresets, inProcess: { 'ops-bot': opsBot() } })).toThrow(/createHermes/);
    });
});

describe('presets named in the fleet file', () => {
    it('loads a CommonJS module resolved from the base directory, with its options and the operator\'s role map', async () => {
        const yaml = `${OPERATOR}presets:\n  - module: ./fixtures/preset-module.js\n    options: { word: hello }\n    roleMap: { reader: [staff] }\n`;
        const { hermes } = createHermes({ fleet: yaml, inProcess: { 'ops-bot': opsBot() }, pluginBaseDir: __dirname });
        live.push(hermes);
        await hermes.start();
        const staff: Principal = { id: 'sam', roles: ['staff'] };
        expect((await hermes.run(staff, { agentId: 'echo', capability: 'say', input: { n: 1 } })).output).toBe('hello:{"n":1}');
        expect(hermes.list(staff).map(a => a.id)).toEqual(['ops-bot', 'echo']);
    });
});

describe('the neutral pipeline preset', () => {
    const boot = async (stages = defaultStages()) => {
        const { hermes } = createHermes({ fleet: OPERATOR, inProcess: { 'ops-bot': opsBot() }, presets: [{ preset: pipelinePreset(stages), roleMap: { 'pipeline-user': ['staff'] } }] });
        live.push(hermes);
        await hermes.start();
        return hermes;
    };
    const staff: Principal = { id: 'sam', roles: ['staff'] };

    it('runs ingest → process → review → deliver as one flow, step by step', async () => {
        const hermes = await boot();
        const { runId } = await hermes.flowRun(staff, { agentId: 'pipeline', flow: 'run-pipeline', input: { items: [' a ', '', 'b'] } });
        await until(() => hermes.status(staff, runId).status === 'done', 5000);
        expect(JSON.parse(hermes.result(staff, runId).output!)).toMatchObject({ items: ['A', 'B'], approved: true, delivered: 2 });
        expect((await hermes.flowStatus(staff, runId)).flow.steps.map(s => [s.name, s.status])).toEqual([['ingest', 'done'], ['process', 'done'], ['review', 'done'], ['deliver', 'done']]);
    });

    it('a rejected review fails the flow before delivery', async () => {
        const hermes = await boot();
        const { runId } = await hermes.flowRun(staff, { agentId: 'pipeline', flow: 'run-pipeline', input: { items: ['x'.repeat(300)] } });
        await until(() => hermes.status(staff, runId).status === 'failed', 5000);
        expect(hermes.result(staff, runId).error).toContain('review rejected the batch');
        expect((await hermes.flowStatus(staff, runId)).flow.steps.map(s => s.status)).toEqual(['done', 'done', 'failed', 'skipped']);
    });

    it('each stage is an agent of its own, and the stages are replaceable', async () => {
        const hermes = await boot({ ...defaultStages(), process: input => ({ items: (input.items as string[]).map(s => `<${s}>`) }) });
        const out = await hermes.run(staff, { agentId: 'process', capability: 'process', input: { items: ['a'] } });
        expect(JSON.parse(out.output!)).toEqual({ items: ['<a>'] });
    });

    it('is pause-able like any flow', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>(r => { release = r; });
        const hermes = await boot({ ...defaultStages(), process: async input => { await gate; return input; } });
        const { runId } = await hermes.flowRun(staff, { agentId: 'pipeline', flow: 'run-pipeline', input: { items: ['a'] } });
        await until(async () => (await hermes.flowStatus(staff, runId)).flow.currentStep === 'process');
        expect((await hermes.flowPause(staff, runId)).flow.status).toBe('paused');
        release();
        await new Promise(r => setTimeout(r, 80));
        expect((await hermes.flowStatus(staff, runId)).flow.currentStep).toBe('process');
        await hermes.flowResume(staff, runId);
        await until(() => hermes.status(staff, runId).status === 'done', 5000);
        expect(await codeOf(hermes.flowRun({ id: 'gus', roles: ['guest'] }, { agentId: 'pipeline', flow: 'run-pipeline' }))).toBe('FORBIDDEN');
    });
});

describe('Hermes itself knows no domain', () => {
    // Domain words belong to presets and plugins, which are content ("reconcile" is not one: it is what Hermes does with its own run store). If one is needed in the core, an extension point is missing.
    const WORDS = /\b(accounting|accountant|ledger|invoice|payroll|billing|tax|ticket|helpdesk|customer|devops|deployment|payment|erp|crm|bookkeeping)\b/i;
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? (name === '__tests__' ? [] : walk(path)) : path.endsWith('.ts') ? [path] : [];
    });

    it('no source file outside the tests names a domain', () => {
        const hits = walk(join(__dirname, '..')).flatMap(file => readFileSync(file, 'utf8').split('\n').map((line, i) => ({ file, line: i + 1, text: line })).filter(l => WORDS.test(l.text)));
        expect(hits.map(h => `${h.file.split('src')[1]}:${h.line}: ${h.text.trim()}`)).toEqual([]);
    });
});
