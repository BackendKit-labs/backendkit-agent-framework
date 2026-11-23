/**
 * The tools read the approved rules through a read-only view, and cannot approve anything.
 */
import { createLearning, type LearnedRulesView } from '..';
import { createBaseEngine } from '../../engine/createBaseEngine';
import { getService, learnedRules, LEARNED_RULES_SERVICE } from '../../tools/services';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const HUMAN = { kind: 'human', id: 'ana' } as const;
interface Guard { kind: 'guard'; block: string }
const isGuard = (r: unknown): r is Guard => !!r && typeof r === 'object' && (r as Guard).kind === 'guard' && typeof (r as Guard).block === 'string';

describe('rulesView', () => {
    it('lists the approved rules of one tenant, typed by a guard, and nothing else', async () => {
        const learning = createLearning();
        await learning.addRule({ rule: { kind: 'guard', block: 'a' } }, HUMAN);
        await learning.addRule({ rule: { kind: 'guard', block: 'b' }, tenantId: 't1' }, HUMAN);
        await learning.addRule({ rule: { tool: 'x', effect: 'ask' } }, HUMAN);

        const none = learning.rulesView();
        expect((await none.where(isGuard)).map(r => r.rule.block)).toEqual(['a']);
        expect(await none.list()).toHaveLength(2);
        expect((await learning.rulesView('t1').where(isGuard)).map(r => r.rule.block)).toEqual(['b']);
        expect(await learning.rulesView('t2').list()).toEqual([]);
    });

    it('is read-only: no way to approve, teach, add, retire or reach the store', async () => {
        const view = createLearning().rulesView();
        expect(Object.keys(view).sort()).toEqual(['list', 'where']);
        expect(Object.isFrozen(view)).toBe(true);
        for (const k of ['approve', 'reject', 'teach', 'addRule', 'retire', 'rules', 'record', 'forget']) expect(k in view).toBe(false);
    });

    it('hands out copies: changing what a tool reads does not change the rule', async () => {
        const learning = createLearning();
        await learning.addRule({ rule: { kind: 'guard', block: 'a' } }, HUMAN);
        const [r] = await learning.rulesView().where(isGuard);
        r.rule.block = 'changed';
        expect((await learning.rulesView().where(isGuard))[0].rule.block).toBe('a');
    });
});

describe('a tool reads the rules through the engine', () => {
    const agent: AgentProfile = { ...testAgent, id: 'ap', allowedTools: ['probe'], delegatesTo: [] };

    function engineWith(learning: ReturnType<typeof createLearning>, extra: Record<string, unknown> = {}) {
        const seen: { rules: string[]; view?: LearnedRulesView; learningObject?: unknown } = { rules: [] };
        const probe: ToolDefinition = {
            name: 'probe', description: '', parameters: { type: 'object' }, readOnly: true,
            execute: async (_a, ctx) => {
                seen.rules = (await learnedRules(ctx, isGuard)).map(r => r.rule.block);
                seen.view = getService<LearnedRulesView>(ctx, LEARNED_RULES_SERVICE);
                seen.learningObject = getService(ctx, 'learning');
                return 'ok';
            },
        };
        const { transport } = createMockTransport();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: createScriptedProvider([{ tool_calls: [{ id: '1', name: 'probe', args: {} }] }, { content: 'done' }]) }, defaultProvider: 'mock',
            agents: [agent], defaultAgent: agent.id, tools: [probe], transport, workingDir: process.cwd(), iterationMode: 'auto', learning, ...extra,
        });
        return { engine, seen };
    }

    it('sees the approved rules of its tenant and has no way to approve', async () => {
        const learning = createLearning();
        await learning.addRule({ rule: { kind: 'guard', block: 'mine' }, tenantId: 't1' }, HUMAN);
        await learning.addRule({ rule: { kind: 'guard', block: 'theirs' }, tenantId: 't2' }, HUMAN);
        const { engine, seen } = engineWith(learning, { identity: { tenantId: 't1' } });
        await engine.run('go');
        expect(seen.rules).toEqual(['mine']);
        expect(Object.keys(seen.view!).sort()).toEqual(['list', 'where']);
        expect(seen.learningObject).toBeUndefined();
    });

    it('keeps the services the caller passed, as an object or as a function', async () => {
        const learning = createLearning();
        await learning.addRule({ rule: { kind: 'guard', block: 'a' } }, HUMAN);
        for (const services of [{ mine: 1 }, () => ({ mine: 1 })]) {
            const got: unknown[] = [];
            const probe: ToolDefinition = {
                name: 'probe', description: '', parameters: { type: 'object' }, readOnly: true,
                execute: async (_a, ctx) => { got.push(getService(ctx, 'mine'), (await learnedRules(ctx, isGuard)).length); return 'ok'; },
            };
            const { transport } = createMockTransport();
            const engine = createBaseEngine({ requireAgentIdentity: false,
                providers: { mock: createScriptedProvider([{ tool_calls: [{ id: '1', name: 'probe', args: {} }] }, { content: 'done' }]) }, defaultProvider: 'mock',
                agents: [agent], defaultAgent: agent.id, tools: [probe], transport, workingDir: process.cwd(), iterationMode: 'auto', learning, services,
            });
            await engine.run('go');
            expect(got).toEqual([1, 1]);
        }
    });

    it('without learning there is nothing to read', async () => {
        const got: number[] = [];
        const probe: ToolDefinition = {
            name: 'probe', description: '', parameters: { type: 'object' }, readOnly: true,
            execute: async (_a, ctx) => { got.push((await learnedRules(ctx, isGuard)).length); return 'ok'; },
        };
        const { transport } = createMockTransport();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: createScriptedProvider([{ tool_calls: [{ id: '1', name: 'probe', args: {} }] }, { content: 'done' }]) }, defaultProvider: 'mock',
            agents: [agent], defaultAgent: agent.id, tools: [probe], transport, workingDir: process.cwd(), iterationMode: 'auto',
        });
        await engine.run('go');
        expect(got).toEqual([0]);
    });
});
