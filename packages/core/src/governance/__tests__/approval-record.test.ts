/**
 * What the audit keeps of an approval, in every path that gives one (SPEC-0014 §6.2 rule 4: the approver in full and their motive), and the two
 * refusals the handler and the flow make on their own: the handler does not need the flow to catch a bad decision, and the flow does not trust a
 * decision made elsewhere just because it says yes.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBaseEngine } from '../../engine/createBaseEngine';
import { createToolServer } from '../../mcp/tool-server';
import { ApprovalControlError, createApprovalHandler } from '../../flow/approval-handler';
import { parseFlow } from '../../flow/loader';
import { runFlow } from '../../flow/run';
import { stepApprovalId } from '../../flow/approval';
import { selfAssertedIdentities } from '../agent-identity';
import { MemoryApprovalStore } from '../approval-store';
import { MemoryAuditSink } from '../audit';
import { defineTool, z } from '../../tools/defineTool';
import type { ApprovalOutcome, ApproverDirectory, ApproverRef, ToolPolicy } from '../types';
import type { AgentProfile } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const people: Record<string, { roles: string[] }> = { ana: { roles: ['finance'] }, carlos: { roles: ['finance'] }, intern: { roles: ['intern'] } };
const directory: ApproverDirectory = { describe: (by: ApproverRef) => people[by.id] };
const human = (id: string): ApproverRef => ({ kind: 'human', id });
const outcome = (id: string, reason?: string): ApprovalOutcome => ({ decision: 'approve', by: human(id), ...(reason ? { reason } : {}), at: new Date().toISOString() });
const asks = (roles?: string[]): ToolPolicy => ({ decide: () => ({ effect: 'ask', reason: 'above 10k', accepts: ['human'], ...(roles ? { approverRoles: roles } : {}) }) });
const pay = (counter = { n: 0 }) => defineTool({ name: 'pay', description: '', destructive: true, input: z.object({ n: z.number() }), execute: async () => { counter.n++; return 'paid'; } });
const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['pay'], delegatesTo: [] };
const FLOW = 'flow: one\nversion: 1\ntrigger: { type: manual }\nsteps:\n  - id: s1\n    agent: main\n    prompt: "pay"\n    gate: { approval: human }\n';

describe('the approval of an event carries who, with what authority, and the reason they gave', () => {
    it('the engine, with an approver in process', async () => {
        const audit = new MemoryAuditSink();
        const { transport } = createMockTransport();
        const engine = createBaseEngine({
            requireAgentIdentity: false, providers: { mock: createScriptedProvider([{ tool_calls: [{ id: 'c', name: 'pay', args: { n: 1 } }] }, { content: 'done' }]) }, defaultProvider: 'mock',
            agents: [main], defaultAgent: 'main', tools: [pay()], transport, workingDir: process.cwd(), iterationMode: 'auto', audit, identity: { userId: 'carlos' },
            policy: asks(['finance']), approverDirectory: directory, approver: { ref: human('ana'), request: async () => outcome('ana', 'I looked at the invoice') },
        } as never);
        await engine.run('pay');
        expect(audit.events.find(e => e.tool === 'pay')).toMatchObject({
            reason: 'above 10k', approval: { by: { id: 'ana' }, authority: { matched: 'finance' }, reason: 'I looked at the invoice' },
        });
    });

    it('the engine, with a stored approval run later: the reason is what the stored decision recorded', async () => {
        const audit = new MemoryAuditSink();
        const store = new MemoryApprovalStore();
        const { transport } = createMockTransport();
        const engine = createBaseEngine({
            requireAgentIdentity: false, providers: { mock: createScriptedProvider([{ tool_calls: [{ id: 'c', name: 'pay', args: { n: 1 } }] }, { content: 'pending' }]) }, defaultProvider: 'mock',
            agents: [main], defaultAgent: 'main', tools: [pay()], transport, workingDir: process.cwd(), iterationMode: 'auto', audit, identity: { userId: 'carlos' },
            policy: asks(), approvals: store,
        } as never);
        await engine.run('pay');
        const [pending] = await store.list({ status: 'pending' });
        await store.resolve(pending!.id, outcome('ana', 'checked with the bank'));
        await engine.runApproved(pending!.id);
        expect(audit.events.find(e => e.approval)).toMatchObject({ reason: 'above 10k', approval: { by: { id: 'ana' }, reason: 'checked with the bank' } });
    });

    it('the direct tool server: the same record as the engine, with the mandate it went beyond', async () => {
        const sink = new MemoryAuditSink();
        const exceeds = { id: 'm-1', issuer: 'did:ex:co', subject: 'carlos' };
        const server = createToolServer({
            name: 'srv', tools: [pay()], identity: { userId: 'carlos' }, agentIdentity: selfAssertedIdentities(), auditSink: sink,
            policy: { decide: () => ({ effect: 'ask', reason: 'outside the mandate: above 5000', accepts: ['human'], approverRoles: ['finance'], exceeds }) },
            approver: { ref: human('ana'), request: async () => outcome('ana', 'seen') }, approverDirectory: directory, forbidSelfApproval: true,
        } as never);
        const [c, s] = InMemoryTransport.createLinkedPair();
        await server.connect(s);
        const client = new Client({ name: 'c', version: '0' });
        await client.connect(c);
        try { await client.callTool({ name: 'pay', arguments: { n: 1 } }); } finally { await client.close(); await server.close(); }
        expect(sink.events[0]).toMatchObject({
            decision: 'allow', outcome: 'ok', reason: 'outside the mandate: above 5000', exceeded: { id: 'm-1' },
            approval: { by: { id: 'ana' }, authority: { matched: 'finance' }, reason: 'seen' },
        });
        expect(sink.events[0]!.mandate).toBeUndefined();
    });
});

describe('the handler refuses on its own, and leaves the request open', () => {
    async function pending(extra: Record<string, unknown> = {}) {
        const store = new MemoryApprovalStore();
        const options = { executor: { run: async () => ({ content: 'done' }) }, runId: 'r', approvals: { store, policy: asks(['finance']), ...extra } };
        await runFlow(parseFlow(FLOW), options as never);
        return { store, id: stepApprovalId('r', 's1') };
    }
    const decide = (store: MemoryApprovalStore, id: string, who: string, opts: Record<string, unknown>) => createApprovalHandler(store, opts).decide(id, { decision: 'approve', by: human(who) });

    it('a role the directory does not give is FORBIDDEN, and the request is still pending for someone who may decide it', async () => {
        const { store, id } = await pending({ identity: { userId: 'carlos' } });
        await expect(decide(store, id, 'intern', { approverDirectory: directory })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect((await store.get(id))?.status).toBe('pending');
        await expect(decide(store, id, 'ana', { approverDirectory: directory })).resolves.toMatchObject({ status: 'approved' });
    });

    it('with four eyes on, the requester is FORBIDDEN, and so is any decision about a request that does not say who asked', async () => {
        const asked = await pending({ identity: { userId: 'carlos' } });
        await expect(decide(asked.store, asked.id, 'carlos', { approverDirectory: directory, forbidSelfApproval: true })).rejects.toBeInstanceOf(ApprovalControlError);
        const anonymous = await pending();
        await expect(decide(anonymous.store, anonymous.id, 'ana', { approverDirectory: directory, forbidSelfApproval: true })).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringMatching(/does not say who asked/) });
    });
});

describe('the flow does not trust a decision made elsewhere', () => {
    it('a decision written straight into the store by someone with no checks of its own (an intern) is refused by the flow when it goes on', async () => {
        const ran = { n: 0 };
        const store = new MemoryApprovalStore();
        const options = {
            executor: { run: async () => { ran.n++; return { content: 'done' }; } }, runId: 'r',
            approvals: { store, identity: { userId: 'carlos' }, policy: asks(['finance']), approverDirectory: directory },
        };
        await runFlow(parseFlow(FLOW), options as never);
        await store.resolve(stepApprovalId('r', 's1'), outcome('intern'));   // another process, a script: nothing checked it
        const second = await runFlow(parseFlow(FLOW), options as never);
        expect(ran.n).toBe(0);
        expect(second.status).not.toBe('completed');
    });

    it('four eyes on and no identity.userId: the step is denied, not run with a rule that does nothing', async () => {
        const ran = { n: 0 };
        const result = await runFlow(parseFlow(FLOW), {
            executor: { run: async () => { ran.n++; return { content: 'done' }; } }, runId: 'r',
            approvals: { store: new MemoryApprovalStore(), policy: asks(['finance']), approverDirectory: directory, forbidSelfApproval: true, approver: { ref: human('ana'), request: async () => outcome('ana') } },
        } as never);
        expect(ran.n).toBe(0);
        expect(result.status).not.toBe('completed');
    });
});
