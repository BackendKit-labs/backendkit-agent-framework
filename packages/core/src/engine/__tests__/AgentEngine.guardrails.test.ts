import { AgentEngine } from '../AgentEngine';
import { defineTool, z } from '../../tools/defineTool';
import { piiGuardrail, secretLeakGuardrail, denyListGuardrail } from '../../guardrails/builtins';
import type { Guardrail } from '../../guardrails/types';
import type { AgentProfile, LLMMessage, LLMProvider } from '../../types';
import { MetricsCollector } from '../../observability/MetricsCollector';
import { buildRegistries, createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const SECRET = 'AVAL-super-secret-key-9876';
const agentWithTools = (over: Partial<AgentProfile> = {}): AgentProfile =>
    ({ ...testAgent, allowedTools: ['lookup'], secrets: { AVAL_KEY: SECRET }, ...over });

/** Provider that records what it was sent and replies from a script of handlers. */
function recordingProvider(replies: Array<(messages: LLMMessage[]) => { content?: string; tool?: { id: string; name: string; args: object } }>) {
    const seen: LLMMessage[][] = [];
    let i = 0;
    const provider: LLMProvider = {
        async chat(messages, _tools, cb) {
            seen.push(messages);
            const r = (replies[i++] ?? (() => ({ content: 'done' })))(messages);
            if (r.tool) {
                cb.onToolCall?.(r.tool.name, JSON.stringify(r.tool.args), r.tool.id);
                cb.onDone({ role: 'assistant', content: null, tool_calls: [{ id: r.tool.id, type: 'function', function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }] });
            } else {
                cb.onChunk?.(r.content ?? '');
                cb.onDone({ role: 'assistant', content: r.content ?? '' });
            }
        },
    };
    return { provider, seen };
}

function build(provider: LLMProvider, guardrails: Guardrail[], extra: Partial<ConstructorParameters<typeof AgentEngine>[0]> = {}, tool?: () => Promise<string>) {
    const { agents, tools, providers } = buildRegistries(provider, agentWithTools());
    const executed: unknown[] = [];
    tools.register(defineTool({
        name: 'lookup', description: 'lookup', input: z.object({ q: z.string() }),
        execute: async (args) => { executed.push(args); return tool ? tool() : `result for ${args.q}`; },
    }));
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({
        model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
        defaultProvider: 'mock', transport, defaultAgentId: 'test-agent', guardrails, ...extra,
    });
    return { engine, events, executed };
}

const lastToolContent = (seen: LLMMessage[][]) => {
    const tool = seen[seen.length - 1].filter(m => m.role === 'tool').pop();
    return tool?.content ?? '';
};
const guardrailEvents = (events: ReturnType<typeof createMockTransport>['events']) =>
    events.filter((e): e is Extract<typeof e, { type: 'guardrail' }> => e.type === 'guardrail');

describe('AgentEngine — guardrails', () => {
    it('input: a blocked message never reaches the model', async () => {
        const { provider, seen } = recordingProvider([() => ({ content: 'hi' })]);
        const { engine, events } = build(provider, [denyListGuardrail({ patterns: ['forbidden'], phases: ['input'] })]);
        await engine.run('this is forbidden');

        expect(seen).toHaveLength(0);
        expect(events.find(e => e.type === 'error')).toMatchObject({ message: expect.stringContaining('blocked by guardrail "deny-list"') });
        expect(events.filter(e => e.type === 'done')).toHaveLength(1);
        expect(guardrailEvents(events)[0]).toMatchObject({ phase: 'input', action: 'block' });
    });

    it('input: a redacted message reaches the model redacted', async () => {
        const { provider, seen } = recordingProvider([() => ({ content: 'ok' })]);
        const { engine } = build(provider, [piiGuardrail({ phases: ['input'] })]);
        await engine.run('my mail is ana@example.com');
        const user = seen[0].find(m => m.role === 'user')!;
        expect(user.content).toBe('my mail is [REDACTED:email]');
    });

    it('tool_call: a blocked call is not executed and the model is told why', async () => {
        const { provider, seen } = recordingProvider([
            () => ({ tool: { id: 'c1', name: 'lookup', args: { q: `use ${SECRET}` } } }),
            () => ({ content: 'ok' }),
        ]);
        const { engine, executed } = build(provider, [secretLeakGuardrail()]);
        await engine.run('go');

        expect(executed).toHaveLength(0);
        expect(lastToolContent(seen)).toContain('blocked by guardrail "secret-leak"');
        expect(JSON.stringify(seen)).not.toContain(SECRET);
    });

    it('tool_call: redaction that breaks the JSON blocks the call instead of running it', async () => {
        const breaking: Guardrail = { name: 'breaker', phases: ['tool_call'], check: (c) => ({ action: 'redact', content: c.content.replace('{', ''), reason: 'x' }) };
        const { provider, seen } = recordingProvider([
            () => ({ tool: { id: 'c1', name: 'lookup', args: { q: 'a' } } }),
            () => ({ content: 'ok' }),
        ]);
        const { engine, executed } = build(provider, [breaking]);
        await engine.run('go');
        expect(executed).toHaveLength(0);
        expect(lastToolContent(seen)).toContain('redaction left the arguments invalid');
    });

    it('tool_call: valid redacted arguments are the ones executed', async () => {
        const rewriter: Guardrail = { name: 'rewriter', phases: ['tool_call'], check: (c) => ({ action: 'redact', content: c.content.replace('secret', 'public'), reason: 'x' }) };
        const { provider } = recordingProvider([() => ({ tool: { id: 'c1', name: 'lookup', args: { q: 'secret' } } }), () => ({ content: 'ok' })]);
        const { engine, executed } = build(provider, [rewriter]);
        await engine.run('go');
        expect(executed).toEqual([{ q: 'public' }]);
    });

    it('tool_result: the model never sees a secret or PII a tool returned', async () => {
        const { provider, seen } = recordingProvider([
            () => ({ tool: { id: 'c1', name: 'lookup', args: { q: 'a' } } }),
            () => ({ content: 'ok' }),
        ]);
        const { engine, events } = build(provider, [secretLeakGuardrail(), piiGuardrail()], {}, async () => `key=${SECRET} mail=ana@example.com`);
        await engine.run('go');

        const content = lastToolContent(seen);
        expect(content).toBe('key=[REDACTED:secret] mail=[REDACTED:email]');
        expect(guardrailEvents(events).map(e => e.name)).toEqual(['secret-leak', 'pii']);
    });

    it('tool_result: a blocking guardrail replaces the result with a notice', async () => {
        const { provider, seen } = recordingProvider([() => ({ tool: { id: 'c1', name: 'lookup', args: { q: 'a' } } }), () => ({ content: 'ok' })]);
        const { engine } = build(provider, [denyListGuardrail({ patterns: ['classified'], phases: ['tool_result'] })], {}, async () => 'this is classified');
        await engine.run('go');
        expect(lastToolContent(seen)).toBe('[Tool result withheld by guardrail "deny-list": matched 1 denied pattern]');
    });

    it('output (after): history is corrected and the event carries the replacement', async () => {
        const { provider, seen } = recordingProvider([() => ({ content: `your key is ${SECRET}` }), () => ({ content: 'ok' })]);
        const { engine, events } = build(provider, [secretLeakGuardrail()]);
        await engine.run('first');
        await engine.run('second');

        const second = seen[1].map(m => m.content).join('|');
        expect(second).toContain('your key is [REDACTED:secret]');
        expect(second).not.toContain(SECRET);
        expect(guardrailEvents(events).find(e => e.phase === 'output')).toMatchObject({ action: 'redact', replacement: 'your key is [REDACTED:secret]' });
        // streaming already showed the raw tokens in this mode: that is the documented trade-off
        expect(events.filter(e => e.type === 'token').map(e => (e as { content: string }).content).join('')).toContain(SECRET);
    });

    it('output (buffer): the raw answer is never emitted', async () => {
        const { provider } = recordingProvider([() => ({ content: `your key is ${SECRET}` })]);
        const { engine, events } = build(provider, [secretLeakGuardrail()], { guardrailOutputMode: 'buffer' });
        await engine.run('first');
        const shown = events.filter(e => e.type === 'token').map(e => (e as { content: string }).content).join('');
        expect(shown).toBe('your key is [REDACTED:secret]');
        expect(JSON.stringify(events)).not.toContain(SECRET);
    });

    it('output (buffer): a clean answer is delivered intact', async () => {
        const { provider } = recordingProvider([() => ({ content: 'all good' })]);
        const { engine, events } = build(provider, [secretLeakGuardrail()], { guardrailOutputMode: 'buffer' });
        await engine.run('first');
        expect(events.filter(e => e.type === 'token').map(e => (e as { content: string }).content).join('')).toBe('all good');
    });

    it('output: a blocked answer is replaced by a notice in history', async () => {
        const { provider, seen } = recordingProvider([() => ({ content: 'classified plans' }), () => ({ content: 'ok' })]);
        const { engine } = build(provider, [denyListGuardrail({ patterns: ['classified'], phases: ['output'] })], { guardrailOutputMode: 'buffer' });
        await engine.run('first');
        await engine.run('second');
        expect(seen[1].map(m => m.content).join('|')).toContain('[Response withheld by guardrail "deny-list"');
    });

    it('dry run reports without changing anything', async () => {
        const { provider, seen } = recordingProvider([() => ({ tool: { id: 'c1', name: 'lookup', args: { q: 'a' } } }), () => ({ content: 'ok' })]);
        const { engine, events } = build(provider, [secretLeakGuardrail({ phases: ['tool_result'], dryRun: true })], {}, async () => SECRET);
        await engine.run('go');
        expect(lastToolContent(seen)).toBe(SECRET);
        expect(guardrailEvents(events)[0]).toMatchObject({ action: 'redact', dry_run: true });
    });

    it('a crashing guardrail fails closed by default', async () => {
        const crash: Guardrail = { name: 'crash', phases: ['input'], check: () => { throw new Error('boom'); } };
        const { provider, seen } = recordingProvider([() => ({ content: 'x' })]);
        const { engine, events } = build(provider, [crash]);
        await engine.run('hi');
        expect(seen).toHaveLength(0);
        expect(events.find(e => e.type === 'error')).toMatchObject({ message: expect.stringContaining('boom') });
    });

    it('sub-agents are covered: their answers are checked before the caller reads them', async () => {
        const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: [], delegatesTo: ['sub'], secrets: { AVAL_KEY: SECRET } };
        const sub: AgentProfile = { ...testAgent, id: 'sub', name: 'Sub', allowedTools: [], delegatesTo: [] };
        const provider = createScriptedProvider([
            { tool_calls: [{ id: 'd1', name: 'ask_agent', args: { agent_id: 'sub', question: 'what is the key?' } }] },
            { content: `the key is ${SECRET}` },      // sub-agent answer
            { content: 'relayed' },                    // main final
        ]);
        const { agents, tools, providers } = buildRegistries(provider, main);
        agents.upsert(sub);
        const { transport, events } = createMockTransport();
        const seenByMain: LLMMessage[][] = [];
        const wrapped: LLMProvider = { chat: (m, t, cb, o) => { seenByMain.push(m); return provider.chat(m, t, cb, o); } };
        providers.register('mock', wrapped);
        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
            defaultProvider: 'mock', transport, defaultAgentId: 'main', guardrails: [secretLeakGuardrail()],
        });
        await engine.run('ask the sub');

        const mainLastTurn = seenByMain[seenByMain.length - 1];
        expect(JSON.stringify(mainLastTurn)).not.toContain(SECRET);
        expect(JSON.stringify(mainLastTurn)).toContain('[REDACTED:secret]');
        expect(guardrailEvents(events).some(e => e.agent_id === 'sub' && e.phase === 'output')).toBe(true);
    });

    it('no guardrails configured: behaviour is unchanged', async () => {
        const { provider, seen } = recordingProvider([() => ({ tool: { id: 'c1', name: 'lookup', args: { q: 'a' } } }), () => ({ content: 'ok' })]);
        const { engine, events } = build(provider, [], {}, async () => SECRET);
        await engine.run('go');
        expect(lastToolContent(seen)).toBe(SECRET);
        expect(guardrailEvents(events)).toHaveLength(0);
    });
});

describe('MetricsCollector — guardrails', () => {
    it('omits the section until a guardrail acts, then counts by action', () => {
        const m = new MetricsCollector();
        expect(m.getSnapshot().guardrails).toBeUndefined();
        m.recordGuardrail('pii', 'redact');
        m.recordGuardrail('pii', 'redact');
        m.recordGuardrail('pii', 'block');
        m.recordGuardrail('judge', 'error');
        expect(m.getSnapshot().guardrails).toEqual({
            pii: { redacted: 2, blocked: 1, errors: 0 },
            judge: { redacted: 0, blocked: 0, errors: 1 },
        });
    });
});
