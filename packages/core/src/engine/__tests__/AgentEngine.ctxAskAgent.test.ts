import { createBaseEngine } from '../createBaseEngine';
import { MemoryAuditSink } from '../../governance/audit';
import type { Approver, ToolPolicy } from '../../governance/types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, createTextProvider, testAgent, type Turn } from '../../__tests__/helpers';

const call = (name: string, args: Record<string, unknown> = {}): Turn => ({ tool_calls: [{ id: 'c', name, args }] });

/** The default agent runs `delegate`, a tool that calls `ctx.askAgent(target)`; `allowed` and `other` answer "from <id>". */
function build(main: AgentProfile, target: string, extra: { policy?: ToolPolicy[] } = {}) {
    const ran: string[] = [];
    const answers: string[] = [];
    const audit = new MemoryAuditSink();
    const tools: ToolDefinition[] = [{
        name: 'delegate', description: '', parameters: { type: 'object' }, readOnly: true,
        execute: async (_a, ctx) => { const a = await ctx.askAgent(target, 'q'); answers.push(a); return a; },
    }];
    const specialist = (id: string): AgentProfile => ({ ...testAgent, id, name: id, allowedTools: [], delegatesTo: [], provider: id });
    const answer = (id: string) => {
        const text = createTextProvider(`from ${id}`);
        return { chat: (m: never, t: never, cb: never, o: never) => { ran.push(id); return text.chat(m, t, cb, o); } };
    };
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({ requireAgentIdentity: false,
        providers: { mock: createScriptedProvider([call('delegate'), { content: 'done' }]), allowed: answer('allowed'), other: answer('other') },
        defaultProvider: 'mock', agents: [main, specialist('allowed'), specialist('other')], defaultAgent: main.id, tools,
        transport, workingDir: process.cwd(), iterationMode: 'auto', audit, ...extra,
    });
    return { engine, ran, answers, audit, events };
}

const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['delegate'], delegatesTo: ['allowed'] };

describe('AgentEngine — ctx.askAgent goes through the same check as ask_agent', () => {
    it('refuses an agent outside delegatesTo, never runs it, and audits it', async () => {
        const { engine, ran, events, audit } = build(main, 'other');
        await engine.run('go');
        expect(ran).toEqual([]);
        const result = events.find(e => e.type === 'tool_result' && e.name === 'delegate') as { success: boolean; preview: string };
        expect(result.success).toBe(false);
        expect(result.preview).toContain('may not delegate to "other"');
        expect(audit.events.find(e => e.tool === 'ask_agent')).toMatchObject({ decision: 'not_allowed' });
    });

    it('lets an agent in the list through and audits it as allowed', async () => {
        const { engine, ran, answers, audit } = build(main, 'allowed');
        await engine.run('go');
        expect(ran).toEqual(['allowed']);
        expect(answers).toEqual(['from allowed']);
        expect(audit.events.find(e => e.tool === 'ask_agent')).toMatchObject({ decision: 'allow', outcome: 'ok' });
    });

    it('refuses a delegation to itself', async () => {
        const { engine, ran, audit } = build(main, 'main');
        await engine.run('go');
        expect(ran).toEqual([]);
        expect(audit.events.find(e => e.tool === 'ask_agent')).toMatchObject({ decision: 'not_allowed', reason: 'self-delegation' });
    });

    it('lets the policies deny it', async () => {
        const noDelegation: ToolPolicy = { decide: (_p, c) => c.tool.name === 'ask_agent' ? { effect: 'deny', reason: 'no delegation here' } : { effect: 'allow' } };
        const { engine, ran, audit } = build(main, 'allowed', { policy: [noDelegation] });
        await engine.run('go');
        expect(ran).toEqual([]);
        expect(audit.events.find(e => e.tool === 'ask_agent')).toMatchObject({ decision: 'deny', reason: 'no delegation here' });
    });
});

describe('AgentEngine — abort while a call waits for its approver', () => {
    it('does not run the call when the approval arrives after the abort', async () => {
        const ran: string[] = [];
        let approve!: () => void;
        let approverAsked!: () => void;
        const asked = new Promise<void>((resolveAsked) => { approverAsked = resolveAsked; });
        const approver: Approver = {
            request: () => new Promise((resolve) => {
                approve = () => resolve({ decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() });
                approverAsked();
            }),
        };
        const audit = new MemoryAuditSink();
        const { transport } = createMockTransport();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: createScriptedProvider([call('write'), { content: 'done' }]) }, defaultProvider: 'mock',
            agents: [{ ...testAgent, id: 'main', allowedTools: ['write'], delegatesTo: [] }], defaultAgent: 'main',
            tools: [{ name: 'write', description: '', parameters: { type: 'object' }, destructive: true, execute: async () => { ran.push('write'); return 'written'; } }],
            transport, workingDir: process.cwd(), iterationMode: 'auto', audit, approver,
        });

        const run = engine.run('go');
        await asked;
        engine.abort();
        approve();
        await run;

        expect(ran).toEqual([]);
        expect(audit.events.find(e => e.tool === 'write')).toMatchObject({ decision: 'allow', outcome: 'aborted', approval: { by: { id: 'ana' } } });
    });
});
