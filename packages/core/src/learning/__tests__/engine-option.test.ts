/**
 * `createBaseEngine({ requireAgentIdentity: false, learning })` wires the sink, the hook and, on the policy path, the policy of the learning module.
 */
import { createBaseEngine, type BaseEngineOptions } from '../../engine/createBaseEngine';
import { MemoryAuditSink } from '../../governance/audit';
import { createLearning } from '..';
import type { ApprovalRequest, Approver } from '../../governance/types';
import type { AgentProfile, LLMProvider, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const HUMAN = { kind: 'human', id: 'ana' } as const;
const agent: AgentProfile = { ...testAgent, id: 'ap', allowedTools: ['flaky', 'lookup'], delegatesTo: [] };

let fails = true;
const tools: ToolDefinition[] = [
    { name: 'flaky', description: '', parameters: { type: 'object' }, readOnly: true, execute: async () => { if (fails) throw new Error('down'); return 'ok'; } },
    { name: 'lookup', description: '', parameters: { type: 'object' }, readOnly: true, execute: async () => 'found' },
];

const call = (name: string, id = 'c'): Turn => ({ tool_calls: [{ id, name, args: {} }] });

function build(script: Turn[], extra: Partial<BaseEngineOptions>) {
    const systems: string[] = [];
    const scripted = createScriptedProvider(script);
    const provider = {
        async chat(messages, t, cb, ...rest) {
            const sys = messages.find(m => m.role === 'system');
            if (sys?.content) systems.push(sys.content as string);
            return scripted.chat(messages, t, cb, ...rest);
        },
    } as LLMProvider;
    const { transport } = createMockTransport();
    const engine = createBaseEngine({ requireAgentIdentity: false,
        providers: { mock: provider }, defaultProvider: 'mock', agents: [agent], defaultAgent: agent.id, tools,
        transport, workingDir: process.cwd(), iterationMode: 'auto', ...extra,
    });
    return { engine, systems };
}

beforeEach(() => { fails = true; });

describe('createBaseEngine({ requireAgentIdentity: false, learning })', () => {
    it('keeps the other audit sinks and hooks, and learns within the tenant of the engine', async () => {
        const learning = createLearning();
        const sink = new MemoryAuditSink();
        const { engine, systems } = build(
            [call('flaky', '1'), call('flaky', '2'), call('flaky', '3'), { content: 'done' }, { content: 'again' }],
            { learning, audit: sink, identity: { tenantId: 't1' }, hooks: [{ name: 'mine', systemPrompt: () => 'MY SECTION' }] },
        );
        await engine.run('go');
        await engine.run('go again');

        expect(sink.events).toHaveLength(3);
        expect((await learning.experiences()).every(e => e.tenantId === 't1')).toBe(true);
        const last = systems[systems.length - 1];
        expect(last).toContain('MY SECTION');
        expect(last).toContain('## Lessons');
        expect(await learning.lessonsFor('ap', 't2')).toBeUndefined();
    });

    it('alone, it does not move the engine to the policy path', async () => {
        const learning = createLearning();
        await learning.rules.add({ id: 'r', rule: { tool: 'lookup', effect: 'deny', reason: 'learned' }, approvedBy: HUMAN, approvedAt: 'now', source: 's' });
        const sink = new MemoryAuditSink();
        const { engine } = build([call('lookup'), { content: 'done' }], { learning, audit: sink });
        await engine.run('go');
        expect(sink.events.map(e => [e.tool, e.decision])).toEqual([['lookup', 'allow']]);
    });

    it('on the policy path, an approved rule is enforced next to the default policy', async () => {
        const learning = createLearning();
        await learning.rules.add({ id: 'r', rule: { tool: 'lookup', effect: 'ask', reason: 'learned' }, approvedBy: HUMAN, approvedAt: 'now', source: 's' });
        const asked: ApprovalRequest[] = [];
        const approver: Approver = {
            ref: HUMAN,
            async request(req) { asked.push(req); return { decision: 'reject', by: HUMAN, at: new Date().toISOString() }; },
        };
        const sink = new MemoryAuditSink();
        fails = false;
        const { engine } = build([call('lookup', '1'), call('flaky', '2'), { content: 'done' }], { learning, approver, audit: sink });
        await engine.run('go');
        // lookup is read-only (the default policy would allow it) but the learned rule asks; flaky has no rule.
        expect(asked.map(r => r.reason)).toEqual(['learned']);
        expect(sink.events.map(e => [e.tool, e.decision])).toEqual([['lookup', 'deny'], ['flaky', 'allow']]);
    });

    it('with a configured policy, the learned rules combine with it', async () => {
        const learning = createLearning();
        await learning.rules.add({ id: 'r', rule: { tool: 'lookup', effect: 'deny', reason: 'learned' }, approvedBy: HUMAN, approvedAt: 'now', source: 's' });
        const sink = new MemoryAuditSink();
        fails = false;
        const { engine } = build([call('lookup', '1'), call('flaky', '2'), { content: 'done' }], {
            learning, audit: sink, policy: { decide: () => ({ effect: 'allow' }) },
        });
        await engine.run('go');
        expect(sink.events.map(e => [e.tool, e.decision])).toEqual([['lookup', 'deny'], ['flaky', 'allow']]);
    });
});
