import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, resolveDataDir, resolveProviderConfig } from '../config.js';
import { TaskPlanner } from '../planner.js';
import { loadFlow, matchFlow, flowToTaskPlan } from '../static-flow.js';
import type { AgentConfig } from '../config.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (name: string, content: string) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content, 'utf-8');
    return p;
};

const MIN_CONFIG = `
orchestrator:
  name: Test
providers:
  default:
    model: gpt-x
    api_key: \${ORCH_TEST_KEY}
agents:
  - id: a1
    name: Agent One
    description: does things
    capabilities: [code]
`;

describe('loadConfig', () => {
    afterEach(() => { delete process.env.ORCH_TEST_KEY; delete process.env.ORCHESTRATOR_DATA_DIR; });

    it('parses a minimal config, applies defaults and expands ${ENV}', () => {
        process.env.ORCH_TEST_KEY = 'secret';
        const cfg = loadConfig(write('o.yaml', MIN_CONFIG));
        expect(cfg.version).toBe(1);
        expect(cfg.agents[0].provider).toBe('default');
        expect(cfg.providers.default.api_key).toBe('secret');
    });

    it('expands a missing env var to an empty string', () => {
        const cfg = loadConfig(write('o.yaml', MIN_CONFIG));
        expect(cfg.providers.default.api_key).toBe('');
    });

    it('throws when the file does not exist', () => {
        expect(() => loadConfig(path.join(dir, 'nope.yaml'))).toThrow(/Config not found/);
    });

    it('rejects a config with no agents, naming the field', () => {
        const p = write('o.yaml', 'orchestrator: {}\nagents: []\n');
        expect(() => loadConfig(p)).toThrow(/agents: At least one agent/);
    });

    it('rejects an invalid transport type', () => {
        const bad = MIN_CONFIG + '    transport:\n      type: carrier-pigeon\n';
        expect(() => loadConfig(write('o.yaml', bad))).toThrow(/Invalid orchestrator config/);
    });

    it('resolveProviderConfig returns null for unknown providers', () => {
        const cfg = loadConfig(write('o.yaml', MIN_CONFIG));
        expect(resolveProviderConfig(cfg, 'default')).not.toBeNull();
        expect(resolveProviderConfig(cfg, 'missing')).toBeNull();
    });

    it('resolveDataDir priority: env > yaml data_dir > .orchestrator next to config', () => {
        const cfgPath = write('o.yaml', MIN_CONFIG + '');
        const cfg = loadConfig(cfgPath);
        expect(resolveDataDir(cfgPath, cfg)).toBe(path.join(dir, '.orchestrator'));

        cfg.orchestrator.data_dir = 'state';
        expect(resolveDataDir(cfgPath, cfg)).toBe(path.join(dir, 'state'));

        process.env.ORCHESTRATOR_DATA_DIR = '/from/env';
        expect(resolveDataDir(cfgPath, cfg)).toBe('/from/env');
    });
});

describe('static flows', () => {
    const FLOW = `
id: onboarding
name: Onboard {{payload.name}}
steps:
  - id: s1
    agent: hr
    task: Create account for {{payload.name}} ({{payload.missing}})
  - id: s2
    agent: it
    task: Provision laptop
    depends_on: [s1]
    gate: true
    gate_criteria: ["Approve for {{payload.name}}"]
`;

    it('loadFlow validates and defaults depends_on', () => {
        const flow = loadFlow(write('f.yaml', FLOW));
        expect(flow.steps[0].depends_on).toEqual([]);
        expect(flow.steps).toHaveLength(2);
    });

    it('loadFlow rejects missing file, empty steps and malformed steps', () => {
        expect(() => loadFlow(path.join(dir, 'x.yaml'))).toThrow(/not found/);
        expect(() => loadFlow(write('e.yaml', 'id: a\nname: b\nsteps: []\n'))).toThrow(/Invalid flow file e.yaml/);
        expect(() => loadFlow(write('m.yaml', 'id: a\nname: b\nsteps:\n  - id: s1\n'))).toThrow(/steps\.0/);
    });

    it('flowToTaskPlan interpolates known payload keys and leaves unknown ones intact', () => {
        const plan = flowToTaskPlan(loadFlow(write('f.yaml', FLOW)), { name: 'Ana' });
        expect(plan.summary).toBe('Onboard Ana');
        expect(plan.subtasks[0].task).toBe('Create account for Ana ({{payload.missing}})');
        expect(plan.subtasks[1]).toMatchObject({ agent_id: 'it', depends_on: ['s1'], gate: true });
        expect(plan.subtasks[1].gate_criteria).toEqual(['Approve for Ana']);
    });

    it('matchFlow picks the first matching trigger (case-insensitive) and skips entries without trigger', () => {
        write('f.yaml', FLOW);
        const entries = [
            { id: 'notrigger', file: 'f.yaml' },
            { id: 'billing', file: 'f.yaml', trigger: 'invoice' },
            { id: 'onb', file: 'f.yaml', trigger: 'ONBOARD(ING)?' },
        ];
        expect(matchFlow(entries, dir, 'please onboarding new hire')?.entry.id).toBe('onb');
        expect(matchFlow(entries, dir, 'send an Invoice')?.entry.id).toBe('billing');
        expect(matchFlow(entries, dir, 'something else')).toBeNull();
    });

    it('matchFlow throws on an invalid trigger regex instead of silently skipping', () => {
        write('f.yaml', FLOW);
        expect(() => matchFlow([{ id: 'bad', file: 'f.yaml', trigger: '(' }], dir, 'x')).toThrow();
    });
});

describe('TaskPlanner', () => {
    const agents: AgentConfig[] = [
        { id: 'dev', name: 'Dev', description: 'd', capabilities: ['code', 'test'], provider: 'default', domain: 'eng' },
        { id: 'qa', name: 'QA', description: 'q', capabilities: ['review'], provider: 'default' },
    ];
    const plan = {
        summary: 'do it',
        subtasks: [
            { id: 't1', agent_id: 'dev', task: 'build', depends_on: [] },
            { id: 't2', agent_id: 'qa', task: 'check', depends_on: ['t1'] },
        ],
    };

    it('parses a bare JSON plan', async () => {
        const p = new TaskPlanner(async () => JSON.stringify(plan));
        expect(await p.plan('x', agents)).toEqual(plan);
    });

    it('parses JSON inside a markdown fence and inside surrounding prose', async () => {
        const fenced = new TaskPlanner(async () => '```json\n' + JSON.stringify(plan) + '\n```');
        expect((await fenced.plan('x', agents)).subtasks).toHaveLength(2);
        const prose = new TaskPlanner(async () => 'Here is the plan: ' + JSON.stringify(plan) + ' hope it helps');
        expect((await prose.plan('x', agents)).summary).toBe('do it');
    });

    it('includes agents, domain, vault and policy context in the prompt', async () => {
        let seen = '';
        const p = new TaskPlanner(async (_s, user) => { seen = user; return JSON.stringify(plan); });
        await p.plan('ship it', agents, 'VAULT-CTX', 'POLICY-CTX');
        expect(seen).toContain('Task: ship it');
        expect(seen).toContain('id: dev');
        expect(seen).toContain('capabilities: [code, test]');
        expect(seen).toContain('domain: eng');
        expect(seen).toContain('VAULT-CTX');
        expect(seen).toContain('POLICY-CTX');
    });

    it.each([
        ['not json at all', 'sorry, I cannot'],
        ['missing subtasks', JSON.stringify({ summary: 's' })],
        ['malformed subtask', JSON.stringify({ summary: 's', subtasks: [{ id: 't1' }] })],
        ['unknown dependency', JSON.stringify({ summary: 's', subtasks: [{ id: 't1', agent_id: 'a', task: 't', depends_on: ['zz'] }] })],
    ])('rejects %s with a TaskPlanner error that echoes the raw output', async (_l, raw) => {
        const p = new TaskPlanner(async () => raw);
        await expect(p.plan('x', agents)).rejects.toThrow(/TaskPlanner: could not parse plan/);
    });

    const planOf = (subtasks: unknown[]) => new TaskPlanner(async () => JSON.stringify({ summary: 's', subtasks }));
    const stk = (id: string, agent_id: string, depends_on: string[] = []) => ({ id, agent_id, task: 't', depends_on });

    it('rejects dependency cycles at planning time, naming the path', async () => {
        await expect(planOf([stk('a', 'dev', ['b']), stk('b', 'dev', ['a'])]).plan('x', agents)).rejects.toThrow(/Dependency cycle: a → b → a/);
        await expect(planOf([stk('a', 'dev', ['a'])]).plan('x', agents)).rejects.toThrow(/Dependency cycle: a → a/);
    });

    it('rejects duplicate sub-task ids', async () => {
        await expect(planOf([stk('a', 'dev'), stk('a', 'qa')]).plan('x', agents)).rejects.toThrow(/Duplicate sub-task id: a/);
    });

    it('rejects an agent_id that is not configured, but keeps the "unresolved" marker', async () => {
        await expect(planOf([stk('a', 'ghost')]).plan('x', agents)).rejects.toThrow(/unknown agent_id: ghost/);
        await expect(planOf([stk('a', 'unresolved')]).plan('x', agents)).resolves.toBeDefined();
    });

    it('accepts a diamond (shared dependency is not a cycle)', async () => {
        const p = planOf([stk('a', 'dev'), stk('b', 'dev', ['a']), stk('c', 'qa', ['a']), stk('d', 'qa', ['b', 'c'])]);
        expect((await p.plan('x', agents)).subtasks).toHaveLength(4);
    });
});
