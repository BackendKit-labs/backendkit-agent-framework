import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import { MemoryAuditSink } from '../../governance/audit';
import { hashArgs } from '../../shared/utils/canonical-json';
import type { SandboxCaller, SandboxRunner, ToolApprovalDecision, ToolDefinition } from '../../index';
import type { AgentProfile } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const SECRET = 'S3CRET-VALUE-7731';

const agent: AgentProfile = { ...testAgent, allowedTools: ['read_file', 'write_file', 'boom', 'slow'], delegatesTo: ['helper'] };
const helper: AgentProfile = { ...testAgent, id: 'helper', name: 'Helper', allowedTools: [], delegatesTo: [] };

function tools(): ToolDefinition[] {
    return [
        { name: 'read_file', description: '', parameters: { type: 'object' }, readOnly: true, meta: { level: 0 }, execute: async () => 'content' },
        { name: 'write_file', description: '', parameters: { type: 'object' }, readOnly: false, execute: async () => 'written' },
        { name: 'boom', description: '', parameters: { type: 'object' }, execute: async () => { throw new Error('fails'); } },
        { name: 'slow', description: '', parameters: { type: 'object' }, timeoutMs: 20, execute: () => new Promise(() => undefined) },
        { name: 'unlisted', description: '', parameters: { type: 'object' }, execute: async () => 'x' },
    ];
}

function build(script: Turn[], extra: Partial<BaseEngineOptions> = {}) {
    const sink = new MemoryAuditSink();
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({ requireAgentIdentity: false,
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock',
        agents: [agent, helper], defaultAgent: agent.id, tools: tools(),
        transport, workingDir: process.cwd(), iterationMode: 'auto', toolTimeoutGraceMs: 10,
        audit: sink, sessionId: 'sess-1',
        ...extra,
    });
    return { engine, sink, events };
}

const calls = (...c: Array<[string, Record<string, unknown>]>): Turn => ({ tool_calls: c.map(([name, args], i) => ({ id: `c${i}`, name, args })) });

describe('AgentEngine — exactly one AuditEvent per tool call (SPEC-0014 F1)', () => {
    it('records allowed, failed, timed-out, missing and unauthorized calls, one event each', async () => {
        const { engine, sink } = build([
            calls(['read_file', { path: 'a' }], ['boom', {}], ['slow', {}], ['nope', {}], ['unlisted', {}]),
            { content: 'done' },
        ]);
        await engine.run('go');
        expect(sink.events.map(e => [e.tool, e.decision, e.outcome])).toEqual([
            ['read_file', 'allow', 'ok'],
            ['boom', 'allow', 'error'],
            ['slow', 'allow', 'timeout'],
            ['nope', 'not_found', undefined],
            ['unlisted', 'not_allowed', undefined],
        ]);
    });

    it('carries the principal, the tool meta and a hash of the arguments, never the arguments', async () => {
        const { engine, sink } = build([calls(['read_file', { path: SECRET, b: 1 }]), { content: 'done' }], {
            identity: { tenantId: 't1', userId: 'u1', roles: ['ops'] },
        });
        await engine.run('go');
        const [e] = sink.events;
        expect(e.principal).toEqual({ agentId: agent.id, sessionId: 'sess-1', chain: [agent.id], tenantId: 't1', userId: 'u1' });
        expect(e.meta).toEqual({ level: 0 });
        expect(e.argsHash).toBe(hashArgs({ b: 1, path: SECRET }));
        expect(JSON.stringify(sink.events)).not.toContain(SECRET);
        expect(() => new Date(e.at).toISOString()).not.toThrow();
        expect(e.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records a call the approver rejected as deny', async () => {
        const { engine, sink } = build([calls(['write_file', {}]), { content: 'ok' }], {
            onToolApproval: async (): Promise<ToolApprovalDecision> => 'reject',
            iterationMode: 'interactive',
        });
        await engine.run('go');
        expect(sink.events).toHaveLength(1);
        expect(sink.events[0]).toMatchObject({ tool: 'write_file', decision: 'deny', reason: 'rejected by the approver' });
        expect(sink.events[0].outcome).toBeUndefined();
    });

    it('records a call blocked by a guardrail, without the blocked content', async () => {
        const { engine, sink } = build([calls(['write_file', { text: SECRET }]), { content: 'ok' }], {
            guardrails: [{ name: 'no-secret', phases: ['tool_call'], check: (ctx) => ctx.content.includes(SECRET) ? { action: 'block', reason: 'secret in arguments' } : { action: 'allow' } }],
        });
        await engine.run('go');
        expect(sink.events).toHaveLength(1);
        expect(sink.events[0]).toMatchObject({ tool: 'write_file', decision: 'guardrail_blocked' });
        expect(JSON.stringify(sink.events)).not.toContain(SECRET);
    });

    it('folds sandbox decisions into the event of the call (refusal before running)', async () => {
        const runner: SandboxRunner = {
            run: async () => { throw new Error('unused'); },
            authorizeTool: (_c: SandboxCaller, tool: string) => tool === 'write_file'
                ? { ok: false, code: 'SANDBOX_DENIED', reason: 'read-only policy' }
                : { ok: true },
            onDecision: () => () => undefined,
        };
        const { engine, sink } = build([calls(['write_file', {}], ['read_file', {}]), { content: 'ok' }], { sandbox: runner });
        await engine.run('go');
        expect(sink.events).toHaveLength(2);
        expect(sink.events[0]).toMatchObject({
            tool: 'write_file', decision: 'sandbox_denied', reason: 'read-only policy',
            sandbox: [{ outcome: 'SANDBOX_DENIED', reason: 'read-only policy' }],
        });
        expect(sink.events[1]).toMatchObject({ tool: 'read_file', decision: 'allow', outcome: 'ok' });
        expect(sink.events[1].sandbox).toBeUndefined();
    });

    it('audits ask_agent delegations, and refuses self-delegation as not_allowed', async () => {
        const { engine, sink } = build([
            { tool_calls: [
                { id: 'd1', name: 'ask_agent', args: { agent_id: 'helper', question: 'q' } },
                { id: 'd2', name: 'ask_agent', args: { agent_id: agent.id, question: 'me' } },
            ] },
            { content: 'helper answer' },
            { content: 'done' },
        ]);
        await engine.run('go');
        const delegations = sink.events.filter(e => e.tool === 'ask_agent');
        expect(delegations.map(e => [e.decision, e.outcome, e.reason])).toEqual([
            ['not_allowed', undefined, 'self-delegation'],
            ['allow', 'ok', undefined],
        ]);
        expect(delegations[1].argsHash).toBe(hashArgs({ agent_id: 'helper', question: 'q' }));
    });

    it('a failing sink is reported on the transport and does not change the result', async () => {
        const memory = new MemoryAuditSink();
        const { engine, events } = build([calls(['read_file', {}]), { content: 'done' }], {
            audit: [{ write: () => { throw new Error('disk full'); } }, memory],
        });
        await engine.run('go');
        expect(memory.events).toHaveLength(1);
        expect(events.find(e => e.type === 'tool_result')).toMatchObject({ name: 'read_file', success: true });
        expect(events.some(e => e.type === 'system' && /\[audit\].*disk full/.test((e as { text: string }).text))).toBe(true);
    });

    it('without audit sinks nothing is recorded and nothing changes', async () => {
        const { engine, events } = build([calls(['read_file', {}]), { content: 'done' }], { audit: undefined });
        await engine.run('go');
        expect(events.find(e => e.type === 'tool_result')).toMatchObject({ name: 'read_file', success: true });
    });
});
