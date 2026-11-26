import * as net from 'node:net';
import { AgentClient, AgentServer, type ApprovalHandler } from '@backendkit-labs/agent-protocol';
import { createApprovalHandler, ApprovalControlError } from '../approval-handler';
import { createFlowTools } from '../tools';
import { createToolRegistrar } from '../../mcp/tool-server';
import { FlowHost } from '../host';
import { createFlowHandler } from '../handler';
import { runFlow } from '../run';
import type { StepExecutor } from '../run';
import { MemoryRunJournal } from '../journal';
import { stepApprovalId } from '../approval';
import { FlowDefinitionSchema } from '../types';
import { MemoryApprovalStore } from '../../governance/approval-store';
import type { ApprovalRequest } from '../../governance/types';
import type { ExecutionContext } from '../../types';

const ctx = {} as ExecutionContext;
const human = { kind: 'human' as const, id: 'ana' };

function request(id: string, over: Partial<ApprovalRequest> = {}): ApprovalRequest {
    return {
        id, principal: { agentId: 'finance', sessionId: 'run-1', chain: ['director'] },
        subject: { kind: 'workflow_step', workflow: 'close', step: 'pay', input: { output: 'draft-42' } },
        reason: 'pay supplier', accepts: ['human'], createdAt: '2026-11-16T10:00:00.000Z', ...over,
    };
}

async function seeded(...reqs: ApprovalRequest[]) {
    const store = new MemoryApprovalStore();
    for (const r of reqs) await store.put(r);
    return store;
}

describe('createApprovalHandler', () => {
    it('lists and reads what waits, with the subject the reviewer needs', async () => {
        const store = await seeded(request('a1'), request('a2'));
        const h = createApprovalHandler(store);
        expect((await h.list({ status: 'pending' })).map(a => a.id)).toEqual(['a1', 'a2']);
        const one = await h.get('a1');
        expect(one).toMatchObject({
            status: 'pending', reason: 'pay supplier', accepts: ['human'],
            subject: { kind: 'workflow_step', step: 'pay', input: { output: 'draft-42' } },
            requestedBy: { agentId: 'finance', sessionId: 'run-1' },
        });
        await expect(h.get('nope')).rejects.toMatchObject({ name: 'ControlError', code: 'TASK_NOT_FOUND' });
    });

    it('shows a tool call as its tool and arguments, not the whole definition', async () => {
        const store = await seeded(request('t1', {
            subject: { kind: 'tool_call', call: { tool: { name: 'send_payment', description: 'd', parameters: { type: 'object', properties: {} }, execute: async () => '' }, args: { amount: 5 } } },
        }));
        expect((await createApprovalHandler(store).get('t1')).subject).toEqual({ kind: 'tool_call', tool: 'send_payment', args: { amount: 5 } });
    });

    it('records a human decision once; the second is a CONFLICT', async () => {
        const store = await seeded(request('a1'));
        const h = createApprovalHandler(store);
        const done = await h.decide('a1', { decision: 'approve', reason: 'ok', by: human });
        expect(done).toMatchObject({ status: 'approved', outcome: { decision: 'approve', by: human, reason: 'ok' } });
        await expect(h.decide('a1', { decision: 'reject', by: human })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('refuses an approver the request does not accept, and leaves it open', async () => {
        const store = await seeded(request('a1'));
        const h = createApprovalHandler(store);
        await expect(h.decide('a1', { decision: 'approve', by: { kind: 'service', id: 'bot' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect((await h.get('a1')).status).toBe('pending');
    });

    it('an agent of the requester\'s chain cannot approve; another agent only if it could do the action itself', async () => {
        const store = await seeded(request('a1', { accepts: undefined }), request('a2', { accepts: undefined }));
        const h = createApprovalHandler(store);
        await expect(h.decide('a1', { decision: 'approve', by: { kind: 'agent', id: 'director' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(h.decide('a2', { decision: 'approve', by: { kind: 'agent', id: 'auditor' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        const allowing = createApprovalHandler(store, { canAgentAct: async () => true });
        expect((await allowing.decide('a2', { decision: 'approve', by: { kind: 'agent', id: 'auditor' } })).status).toBe('approved');
    });

    it('onDecided runs after the decision, and a failure there does not undo it', async () => {
        const store = await seeded(request('a1'));
        const seen: string[] = [];
        const h = createApprovalHandler(store, { onDecided: a => { seen.push(`${a.id}:${a.status}`); throw new Error('resume failed'); } });
        expect((await h.decide('a1', { decision: 'approve', by: human })).status).toBe('approved');
        expect(seen).toEqual(['a1:approved']);
    });

    it('closes the loop: a flow stops for review, the decision resumes it', async () => {
        const def = FlowDefinitionSchema.parse({
            flow: 'close', trigger: { type: 'manual' },
            steps: [{ id: 'pay', agent: 'finance', prompt: 'pay', gate: { approval: 'human' } }, { id: 'report', agent: 'finance', prompt: 'r', after: ['pay'] }],
        });
        const store = new MemoryApprovalStore();
        const journal = new MemoryRunJournal();
        const ran: string[] = [];
        const executor: StepExecutor = { run: async (s) => { ran.push(s.id); return { content: `out-${s.id}` }; } };
        const approvals = { store, when: 'after' as const };
        let finished: Promise<unknown> | undefined;
        const h = createApprovalHandler(store, {
            onDecided: () => { finished = runFlow(def, { executor, journal, runId: 'r1', approvals }); },
        });

        expect((await runFlow(def, { executor, journal, runId: 'r1', approvals })).status).toBe('awaiting_approval');
        const [waiting] = await h.list({ status: 'pending' });
        expect(waiting.id).toBe(stepApprovalId('r1', 'pay'));
        expect(waiting.subject).toMatchObject({ input: { output: 'out-pay' } });

        await h.decide(waiting.id, { decision: 'approve', by: human });
        expect((await finished as { status: string }).status).toBe('completed');
        expect(ran).toEqual(['pay', 'report']);
    });
});

describe('createFlowTools', () => {
    const find = (tools: ReturnType<typeof createFlowTools>, name: string) => tools.find(t => t.name === name)!;

    it('needs something to expose, and an approver to decide as', () => {
        expect(() => createFlowTools({})).toThrow(/flows, approvals or both/);
        expect(() => createFlowTools({ approvals: createApprovalHandler(new MemoryApprovalStore()) })).toThrow(/need an approver/);
    });

    it('declares what is irreversible, so a server demands authorize or policy for it', () => {
        const tools = createFlowTools({ flows: createFlowHandler({}).handler, approvals: createApprovalHandler(new MemoryApprovalStore()), approver: human });
        expect(tools.map(t => t.name)).toEqual([
            'flow_list', 'flow_start', 'flow_status', 'flow_wait', 'flow_pause', 'flow_resume', 'flow_cancel', 'approval_list', 'approval_get', 'approval_decide',
        ]);
        expect(tools.filter(t => t.destructive).map(t => t.name)).toEqual(['flow_cancel', 'approval_decide']);
        expect(tools.filter(t => t.readOnly).map(t => t.name)).toEqual(['flow_list', 'flow_status', 'flow_wait', 'approval_list', 'approval_get']);
    });

    it('an MCP tool server refuses the destructive ones until authorize or policy decides who may call them', () => {
        const tools = createFlowTools({ flows: createFlowHandler({}).handler });
        expect(() => createToolRegistrar({ name: 's', tools })).toThrow(/flow_cancel/);
        expect(() => createToolRegistrar({ name: 's', tools, authorize: () => true })).not.toThrow();
    });

    it('runs a flow through the tools: start, status, pause, resume, cancel', async () => {
        const { handler } = createFlowHandler({
            work: { steps: ['a'], run: async (_i, c) => { await c.step('a'); await new Promise(r => setTimeout(r, 300)); await c.checkpoint(); return 'done'; } },
        });
        const tools = createFlowTools({ flows: handler, prefix: 'f_' });
        const { flowRunId } = JSON.parse(await find(tools, 'f_flow_start').execute({ flow: 'work', input: { x: 1 } }, ctx) as string);
        expect(JSON.parse(await find(tools, 'f_flow_list').execute({}, ctx) as string)[0].name).toBe('work');
        expect(JSON.parse(await find(tools, 'f_flow_status').execute({ flowRunId }, ctx) as string).status).toBe('running');
        expect(JSON.parse(await find(tools, 'f_flow_pause').execute({ flowRunId }, ctx) as string).status).toBe('paused');
        expect(JSON.parse(await find(tools, 'f_flow_resume').execute({ flowRunId }, ctx) as string).status).toBe('running');
        expect(JSON.parse(await find(tools, 'f_flow_cancel').execute({ flowRunId }, ctx) as string).status).toBe('cancelled');
    });

    it('flow_wait blocks until the run stops running, or times out saying so', async () => {
        const { handler } = createFlowHandler({
            quick: { steps: ['a'], run: async (_i, c) => { await c.step('a'); await new Promise(r => setTimeout(r, 120)); return 'ok'; } },
            slow: { steps: ['a'], run: async (_i, c) => { await c.step('a'); await new Promise(r => setTimeout(r, 2000)); await c.checkpoint(); return 'late'; } },
        });
        const wait = createFlowTools({ flows: handler, waitPollMs: 20 }).find(t => t.name === 'flow_wait')!;
        const a = await handler.start('quick', {});
        const done = JSON.parse(await wait.execute({ flowRunId: a.flowRunId, timeoutMs: 5000 }, ctx) as string);
        expect(done).toMatchObject({ status: 'done', timedOut: false, output: 'ok' });
        const b = await handler.start('slow', {});
        const t0 = Date.now();
        const still = JSON.parse(await wait.execute({ flowRunId: b.flowRunId, timeoutMs: 200 }, ctx) as string);
        expect(still).toMatchObject({ status: 'running', timedOut: true });
        expect(Date.now() - t0).toBeLessThan(1500);
        const ac = new AbortController();
        const p = wait.execute({ flowRunId: b.flowRunId, timeoutMs: 30_000 }, { signal: ac.signal } as ExecutionContext) as Promise<string>;
        setTimeout(() => ac.abort(), 50);
        expect(JSON.parse(await p).timedOut).toBe(true); // an aborted turn does not hold the engine for 30 s
        await handler.cancel(b.flowRunId);
        await expect(wait.execute({ flowRunId: 'nope', timeoutMs: 100 }, ctx)).rejects.toThrow();
    });

    it('rejects arguments that do not match', async () => {
        const tools = createFlowTools({ flows: createFlowHandler({}).handler });
        await expect(find(tools, 'flow_start').execute({}, ctx)).rejects.toThrow(/flow/);
    });

    it('decides as the configured approver, whatever the model says: a service cannot approve what needs a human', async () => {
        const store = await seeded(request('a1'));
        const handler = createApprovalHandler(store);
        const asService = createFlowTools({ approvals: handler, approver: { kind: 'service', id: 'mcp:director' } });
        await expect(find(asService, 'approval_decide').execute({ id: 'a1', decision: 'approve', by: human }, ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        const asHuman = createFlowTools({ approvals: handler, approver: human });
        const out = JSON.parse(await find(asHuman, 'approval_decide').execute({ id: 'a1', decision: 'approve', reason: 'checked' }, ctx) as string);
        expect(out).toMatchObject({ status: 'approved', outcome: { by: human, reason: 'checked' } });
        expect(JSON.parse(await find(asHuman, 'approval_list').execute({ status: 'pending' }, ctx) as string)).toEqual([]);
    });
});

// ── It plugs into the real AgentServer (protocol 1.2) ──────────────────────────

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
    });
}

describe('over agent-protocol', () => {
    it('a supervisor lists and decides through AgentServer/AgentClient', async () => {
        const store = await seeded(request('a1'));
        const port = await freePort();
        const server = new AgentServer({ allowUngated: true,
            name: 'finance', version: '1.0.0', description: 'd', port, controlApiKey: 'ctl',
            approvalHandler: createApprovalHandler(store) as unknown as ApprovalHandler,
            // Who decides comes from what the server authenticates (here a header standing for a personal token), never from the body.
            approverOf: ({ headers }) => (headers['x-user'] === human.id ? human : headers['x-user'] === 'bot' ? { kind: 'service', id: 'bot' } : undefined),
        });
        await server.start();
        try {
            const client = new AgentClient({ url: `http://127.0.0.1:${port}`, controlApiKey: 'ctl' });
            expect((await client.listApprovals({ status: 'pending' }))[0]).toMatchObject({ id: 'a1', subject: { step: 'pay' } });
            await expect(client.decideApproval('a1', { decision: 'approve' }, undefined, { 'x-user': 'bot' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
            // Claiming to be the human with the bot's credentials is refused too.
            await expect(client.decideApproval('a1', { decision: 'approve', by: human }, undefined, { 'x-user': 'bot' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
            expect(await client.decideApproval('a1', { decision: 'approve' }, undefined, { 'x-user': human.id })).toMatchObject({ status: 'approved' });
            await expect(client.decideApproval('a1', { decision: 'approve' }, undefined, { 'x-user': human.id })).rejects.toMatchObject({ code: 'CONFLICT' });
        } finally {
            await server.stop();
        }
    });
});

void FlowHost; void ApprovalControlError;
