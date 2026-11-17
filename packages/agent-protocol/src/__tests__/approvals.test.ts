import * as net from 'node:net';
import { AgentServer, AgentClient, ControlError, PROTOCOL_MINOR } from '../index';
import type { ApprovalHandler, ApprovalSummary } from '../index';

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address() as net.AddressInfo;
            s.close(() => resolve(port));
        });
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json();
const auth = (key?: string): Record<string, string> => ({ 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) });

function pending(id: string): ApprovalSummary {
    return {
        id, status: 'pending', reason: 'pay supplier',
        subject: { kind: 'workflow_step', workflow: 'close-month', step: 'pay', input: { output: 'draft-42' } },
        requestedBy: { agentId: 'finance', sessionId: 'run-1' }, createdAt: '2026-11-16T10:00:00.000Z', accepts: ['human'],
    };
}

/** A host that keeps its approvals in memory. */
function memoryApprovals(): ApprovalHandler & { items: Map<string, ApprovalSummary> } {
    const items = new Map<string, ApprovalSummary>([['ap1', pending('ap1')], ['ap2', pending('ap2')]]);
    const get = (id: string): ApprovalSummary => {
        const a = items.get(id);
        if (!a) throw new ControlError('TASK_NOT_FOUND', `approval ${id} not found`);
        return a;
    };
    return {
        items,
        list: async f => [...items.values()].filter(a => !f.status || a.status === f.status),
        get: async id => ({ ...get(id) }),
        decide: async (id, d) => {
            const a = get(id);
            if (a.status !== 'pending') throw new ControlError('CONFLICT', `approval ${id} was already decided`);
            if (a.accepts && !a.accepts.includes(d.by.kind)) throw new ControlError('FORBIDDEN', `needs ${a.accepts.join(' or ')}`);
            a.status = d.decision === 'approve' ? 'approved' : 'rejected';
            a.outcome = { decision: d.decision, by: d.by, ...(d.reason ? { reason: d.reason } : {}), at: new Date().toISOString() };
            return { ...a };
        },
    };
}

const running: AgentServer[] = [];
async function start(opts: Partial<ConstructorParameters<typeof AgentServer>[0]> = {}) {
    const port = await freePort();
    const handler = memoryApprovals();
    const server = new AgentServer({ name: 'appr', version: '1.0.0', description: 'd', port, approvalHandler: handler, ...opts });
    await server.start();
    running.push(server);
    return { url: `http://127.0.0.1:${port}`, port, handler };
}
afterAll(async () => { await Promise.all(running.map(s => s.stop())); });

const human = { kind: 'human' as const, id: 'ana' };

describe('approvals over agent-protocol (1.2)', () => {
    it('speaks 1.2 and publishes that it has approvals', async () => {
        expect(PROTOCOL_MINOR).toBe(2);
        const { url } = await start({ apiKey: 'run', controlApiKey: 'ctl' });
        const info = (await json(await fetch(`${url}/v1/agent/info`, { headers: auth('run') }))).data;
        expect(info).toMatchObject({ protocolMinor: 2, approvals: true });
    });

    it('needs the control key for everything: not the run key, not no key, not when control is off', async () => {
        const { url } = await start({ apiKey: 'run', controlApiKey: 'ctl' });
        for (const key of ['run', undefined, 'nope']) {
            const r = await fetch(`${url}/v1/agent/approvals`, { headers: auth(key) });
            expect([401]).toContain(r.status);
        }
        const dec = await fetch(`${url}/v1/agent/approvals/ap1/decision`, { method: 'POST', headers: auth('run'), body: JSON.stringify({ decision: 'approve', by: human }) });
        expect(dec.status).toBe(401);

        const off = await start({ apiKey: 'run' }); // no controlApiKey
        expect((await fetch(`${off.url}/v1/agent/approvals`, { headers: auth('run') })).status).toBe(403);
    });

    it('lists pending approvals with what the reviewer needs, filtered by status', async () => {
        const { url, handler } = await start({ controlApiKey: 'ctl' });
        handler.items.get('ap2')!.status = 'approved';
        const all = (await json(await fetch(`${url}/v1/agent/approvals`, { headers: auth('ctl') }))).data.approvals;
        expect(all).toHaveLength(2);
        const open = (await json(await fetch(`${url}/v1/agent/approvals?status=pending`, { headers: auth('ctl') }))).data.approvals;
        expect(open.map((a: ApprovalSummary) => a.id)).toEqual(['ap1']);
        expect(open[0].subject).toMatchObject({ kind: 'workflow_step', step: 'pay', input: { output: 'draft-42' } });
        const bad = await fetch(`${url}/v1/agent/approvals?status=maybe`, { headers: auth('ctl') });
        expect(bad.status).toBe(400);
    });

    it('decides once; a second decision is a CONFLICT (409); an unknown id is 404', async () => {
        const { url } = await start({ controlApiKey: 'ctl' });
        const decide = (id: string, body: unknown) => fetch(`${url}/v1/agent/approvals/${id}/decision`, { method: 'POST', headers: auth('ctl'), body: JSON.stringify(body) });
        const ok = await json(await decide('ap1', { decision: 'approve', reason: 'checked', by: human }));
        expect(ok.data).toMatchObject({ status: 'approved', outcome: { decision: 'approve', by: human, reason: 'checked' } });
        const again = await decide('ap1', { decision: 'reject', by: human });
        expect(again.status).toBe(409);
        expect((await json(again)).error.code).toBe('CONFLICT');
        expect((await decide('missing', { decision: 'approve', by: human })).status).toBe(404);
    });

    it('validates the body and leaves the approver check to the host', async () => {
        const { url } = await start({ controlApiKey: 'ctl' });
        const decide = (body: unknown) => fetch(`${url}/v1/agent/approvals/ap1/decision`, { method: 'POST', headers: auth('ctl'), body: JSON.stringify(body) });
        expect((await decide({ decision: 'maybe', by: human })).status).toBe(400);
        expect((await decide({ decision: 'approve' })).status).toBe(400);
        expect((await decide({ decision: 'approve', by: { kind: 'robot', id: 'x' } })).status).toBe(400);
        expect((await decide({ decision: 'approve', by: { kind: 'service', id: 'bot' } })).status).toBe(403); // the host: only a human
    });

    it('answers CONTROL_UNSUPPORTED when the agent has no approvals', async () => {
        const { url } = await start({ controlApiKey: 'ctl', approvalHandler: undefined });
        expect((await fetch(`${url}/v1/agent/approvals`, { headers: auth('ctl') })).status).toBe(501);
    });

    it('the client lists, reads and decides', async () => {
        const { port } = await start({ apiKey: 'run', controlApiKey: 'ctl' });
        const client = new AgentClient({ url: `http://127.0.0.1:${port}`, apiKey: 'run', controlApiKey: 'ctl' });
        const open = await client.listApprovals({ status: 'pending' });
        expect(open.map(a => a.id)).toEqual(['ap1', 'ap2']);
        expect((await client.approval('ap2')).reason).toBe('pay supplier');
        const done = await client.decideApproval('ap2', { decision: 'reject', reason: 'no budget', by: human });
        expect(done).toMatchObject({ status: 'rejected', outcome: { reason: 'no budget' } });
        await expect(client.decideApproval('ap2', { decision: 'approve', by: human })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
        const noKey = new AgentClient({ url: `http://127.0.0.1:${port}`, apiKey: 'run' });
        await expect(noKey.listApprovals()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
});
