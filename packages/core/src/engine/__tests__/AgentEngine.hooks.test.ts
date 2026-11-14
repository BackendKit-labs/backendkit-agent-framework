import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import type { EngineHooks } from '../../governance/hooks';
import type { AgentProfile, LLMMessage, LLMProvider, ToolDefinition } from '../../types';
import { createMockTransport, testAgent, type Turn } from '../../__tests__/helpers';

const orchestrator: AgentProfile = { ...testAgent, id: 'general', allowedTools: ['write'], delegatesTo: ['helper'] };
const helper: AgentProfile = { ...testAgent, id: 'helper', name: 'Helper', allowedTools: [], delegatesTo: [] };
const qaEngineer: AgentProfile = { ...testAgent, id: 'qa-engineer', name: 'QA', allowedTools: [], delegatesTo: [] };

/** Scripted provider that also records the system prompt of every call. */
function recordingProvider(script: Turn[]) {
    const systems: string[] = [];
    let i = 0;
    const provider: LLMProvider = {
        async chat(messages: LLMMessage[], _tools, callbacks) {
            systems.push(String(messages.find(m => m.role === 'system')?.content ?? ''));
            const turn = script[i++] ?? { content: '[script exhausted]' };
            if (turn.tool_calls?.length) {
                for (const tc of turn.tool_calls) callbacks.onToolCall?.(tc.name, JSON.stringify(tc.args), tc.id);
                callbacks.onDone({
                    role: 'assistant', content: null,
                    tool_calls: turn.tool_calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })),
                });
            } else {
                callbacks.onChunk?.(turn.content ?? '');
                callbacks.onDone({ role: 'assistant', content: turn.content ?? '' });
            }
        },
    };
    return { provider, systems };
}

function build(script: Turn[], hooks: EngineHooks[], extra: Partial<BaseEngineOptions> = {}) {
    const { provider, systems } = recordingProvider(script);
    const ran: string[] = [];
    const write: ToolDefinition = { name: 'write', description: '', parameters: { type: 'object' }, execute: async () => { ran.push('write'); return 'written'; } };
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: provider }, defaultProvider: 'mock',
        agents: [orchestrator, helper, qaEngineer], defaultAgent: 'general', tools: [write],
        transport, workingDir: process.cwd(), noQA: true, iterationMode: 'auto', hooks, ...extra,
    });
    return { engine, systems, ran, events };
}

describe('AgentEngine — lifecycle hooks (SPEC-0014 F3)', () => {
    it('runs the six points in order across a turn, sharing state', async () => {
        const trace: string[] = [];
        const hook: EngineHooks = {
            name: 'trace',
            beforeRun: (ctx) => { trace.push(`beforeRun:${ctx.input}`); ctx.state.set('k', 1); },
            systemPrompt: (ctx, p) => { trace.push(`systemPrompt:${p.id}:${String(ctx.state.get('k'))}`); return undefined; },
            beforeTool: (_ctx, call) => { trace.push(`beforeTool:${call.tool.name}:${JSON.stringify(call.args)}`); },
            afterTool: (_ctx, call, r) => { trace.push(`afterTool:${call.tool.name}:${r.success}:${r.text}`); },
            afterTurn: (_ctx, t) => { trace.push(`afterTurn:${t.profile.id}:${t.text}`); },
            afterRun: (_ctx, r) => { trace.push(`afterRun:${r.text}`); },
        };
        const { engine } = build([{ tool_calls: [{ id: 'c', name: 'write', args: { a: 1 } }] }, { content: 'all done' }], [hook]);
        await engine.run('go');
        expect(trace).toEqual([
            'beforeRun:go',
            'systemPrompt:general:1',
            'beforeTool:write:{"a":1}',
            'afterTool:write:true:written',
            'systemPrompt:general:1',
            'afterTurn:general:all done',
            'afterRun:all done',
        ]);
    });

    it('systemPrompt sections reach the main agent and delegates, in registration order', async () => {
        const { engine, systems } = build([
            { tool_calls: [{ id: 'd', name: 'ask_agent', args: { agent_id: 'helper', question: 'q' } }] },
            { content: 'helper says hi' },
            { content: 'done' },
        ], [
            { systemPrompt: (_c, p) => `## First section for ${p.id}` },
            { systemPrompt: () => '## Second section' },
        ]);
        await engine.run('go');
        const [main, delegate] = systems;
        expect(main.indexOf('## First section for general')).toBeGreaterThan(-1);
        expect(main.indexOf('## First section for general')).toBeLessThan(main.indexOf('## Second section'));
        expect(delegate).toContain('## First section for helper');
    });

    it('afterTurn can force another pass as another agent, with a message, up to the cap', async () => {
        let asked = 0;
        const { engine, systems, events } = build(
            [{ content: 'a1' }, { content: 'a2' }, { content: 'a3' }, { content: 'a4' }],
            [{ afterTurn: () => { asked++; return { action: 'continue', agentId: 'qa-engineer', message: 'review it' }; } }],
            { maxHookContinues: 2 },
        );
        await engine.run('go');
        expect(systems).toHaveLength(3);               // first pass + 2 forced passes
        expect(asked).toBe(3);
        expect(events.some(e => e.type === 'system' && /more than 2 extra passes/.test((e as { text: string }).text))).toBe(true);
    });

    it('a throwing hook fails the turn (fail-closed) and names the hook', async () => {
        const { engine, ran } = build([{ tool_calls: [{ id: 'c', name: 'write', args: {} }] }, { content: 'x' }], [
            { name: 'guard', beforeTool: () => { throw new Error('not today'); } },
        ]);
        await expect(engine.run('go')).rejects.toThrow('Hook guard failed in beforeTool: not today');
        expect(ran).toEqual([]);

        const early = build([{ content: 'x' }], [{ beforeRun: () => { throw new Error('boom'); } }]);
        await expect(early.engine.run('go')).rejects.toThrow('Hook #0 failed in beforeRun: boom');
        expect(early.systems).toEqual([]);
    });

    it('the turn signal is aborted by engine.abort()', async () => {
        let seen: AbortSignal | undefined;
        const { engine } = build([{ content: 'x' }], [{ afterTurn: (ctx) => { seen = ctx.signal; engine.abort(); } }]);
        await engine.run('go');
        expect(seen?.aborted).toBe(true);
    });
});

describe('AgentEngine — the coding pipeline expressed only with hooks (SPEC-0014 F3 acceptance)', () => {
    /**
     * What the built-in orchestrator + QA do today, without their engine options: classify the task before the
     * turn, brief the orchestrating agent, and once it answers with code send it to a QA engineer for one review.
     */
    function codingPipelineHooks(): EngineHooks {
        return {
            name: 'coding-pipeline',
            beforeRun: (ctx) => {
                const actionType = /fix|bug/i.test(ctx.input) ? 'bugfix' : 'implementation';
                ctx.state.set('task', { actionType, riskLevel: 'medium', requiredGates: ['qa'] });
            },
            systemPrompt: (ctx, profile) => {
                if (profile.id !== 'general') return undefined;
                const task = ctx.state.get('task') as { actionType: string; riskLevel: string };
                return `## Orchestrator Analysis — Current Task\n**Intent:** ${task.actionType} | **Risk:** ${task.riskLevel}`;
            },
            afterTurn: (ctx, turn) => {
                if (ctx.state.get('reviewed')) return;
                if (turn.profile.id === 'general' && /```/.test(turn.text)) {
                    return { action: 'continue', agentId: 'qa-engineer', message: 'Review the code above against the task.' };
                }
                if (turn.profile.id === 'qa-engineer') ctx.state.set('reviewed', /APPROVED/.test(turn.text) ? 'go' : 'no-go');
            },
        };
    }

    it('classifies, briefs the orchestrator, routes the answer to QA once, and records the verdict', async () => {
        const verdicts: unknown[] = [];
        const { engine, systems } = build(
            [{ content: 'Here is the fix:\n```ts\nfix();\n```' }, { content: 'APPROVED: looks right' }],
            [codingPipelineHooks(), { afterRun: (ctx) => { verdicts.push(ctx.state.get('reviewed')); } }],
        );
        await engine.run('fix the login bug');
        expect(systems).toHaveLength(2);
        expect(systems[0]).toContain('**Intent:** bugfix | **Risk:** medium');
        expect(systems[1]).not.toContain('Orchestrator Analysis');   // the QA pass is not briefed as orchestrator
        expect(verdicts).toEqual(['go']);
    });
});
