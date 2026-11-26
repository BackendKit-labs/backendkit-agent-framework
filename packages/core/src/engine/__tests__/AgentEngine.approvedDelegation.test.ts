import { createBaseEngine } from '../createBaseEngine';
import { MemoryAuditSink } from '../../governance/audit';
import { MemoryApprovalStore } from '../../governance/approval-store';
import type { Approver, ToolPolicy } from '../../governance/types';
import type { AgentProfile } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const human = { kind: 'human' as const, id: 'ana' };
const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: [], delegatesTo: ['helper'] };
const helper: AgentProfile = { ...testAgent, id: 'helper', name: 'helper', allowedTools: [], delegatesTo: [], provider: 'helper' };

/** Every delegation asks first, until `mode.deny` turns it into a refusal. */
function build(opts: { approver?: Approver } = {}) {
    const mode = { deny: false };
    const policy: ToolPolicy = {
        decide: (_p, call) => call.tool.name !== 'ask_agent' ? { effect: 'allow' }
            : mode.deny ? { effect: 'deny', reason: 'no more delegation' }
            : { effect: 'ask', reason: 'delegation needs a person' },
    };
    const ran: string[] = [];
    const store = new MemoryApprovalStore();
    const audit = new MemoryAuditSink();
    const { transport } = createMockTransport();
    const engine = createBaseEngine({ requireAgentIdentity: false,
        providers: {
            mock: createScriptedProvider([
                { tool_calls: [{ id: 'c1', name: 'ask_agent', args: { agent_id: 'helper', question: 'check the invoice' } }] },
                { content: 'done' },
            ]),
            helper: { chat: async (_m, _t, cb) => { ran.push('helper'); cb.onChunk?.('invoice ok'); cb.onDone({ role: 'assistant', content: 'invoice ok' }); } },
        },
        defaultProvider: 'mock', agents: [main, helper], defaultAgent: 'main', tools: [],
        transport, workingDir: process.cwd(), iterationMode: 'auto', audit, policy, approvals: store, ...opts,
    });
    return { engine, ran, store, audit, mode };
}

describe('AgentEngine — a delegation that waited for approval', () => {
    it('runs once approved, returns the answer of the delegate, and is audited with the approval', async () => {
        const { engine, ran, store, audit } = build();
        await engine.run('go');
        expect(ran).toEqual([]);
        const [pending] = await store.list({ status: 'pending' });
        expect(pending.subject).toMatchObject({ kind: 'tool_call', call: { tool: { name: 'ask_agent' } } });

        await store.resolve(pending.id, { decision: 'approve', by: human, at: new Date().toISOString() });
        expect(await engine.runApproved(pending.id)).toBe('invoice ok');
        expect(ran).toEqual(['helper']);
        expect(audit.events.at(-1)).toMatchObject({ tool: 'ask_agent', decision: 'allow', outcome: 'ok', approval: { id: pending.id, by: human } });
        expect((await store.get(pending.id))!.status).toBe('executed');
        await expect(engine.runApproved(pending.id)).rejects.toThrow(/already executed/);
    });

    it('is checked again when run: a policy that now denies it stops it', async () => {
        const { engine, ran, store, audit, mode } = build();
        await engine.run('go');
        const [pending] = await store.list({ status: 'pending' });
        await store.resolve(pending.id, { decision: 'approve', by: human, at: new Date().toISOString() });
        mode.deny = true;
        expect(await engine.runApproved(pending.id)).toMatch(/denied by policy: no more delegation/);
        expect(ran).toEqual([]);
        expect(audit.events.at(-1)).toMatchObject({ tool: 'ask_agent', decision: 'deny' });
    });

    it('a delegation approved live is audited with who approved it', async () => {
        const approver: Approver = { request: async () => ({ decision: 'approve', by: human, at: new Date().toISOString() }) };
        const { engine, ran, audit } = build({ approver });
        await engine.run('go');
        expect(ran).toEqual(['helper']);
        expect(audit.events.find(e => e.tool === 'ask_agent')).toMatchObject({ decision: 'allow', outcome: 'ok', approval: { by: human } });
    });
});
