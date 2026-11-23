import * as net from 'node:net';
import { AgentServer, type CapabilityDefinition } from '../index';
import { TaskStore } from '../server/TaskStore';

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

const def = (name: string, async = false): CapabilityDefinition => ({
    name, description: name, async, input: {}, output: { type: 'string' },
} as unknown as CapabilityDefinition);

describe('costUsd reported by a handler', () => {
    let server: AgentServer;
    let url: string;

    beforeAll(async () => {
        const port = await freePort();
        url = `http://127.0.0.1:${port}`;
        server = new AgentServer({ allowUngated: true, name: 'a', version: '1.0.0', description: 'd', port });
        server
            .register({ definition: def('paid'), execute: async (_i, ctx) => { ctx.reportCost?.(0.25); ctx.reportCost?.(0.5); return 'ok'; } })
            .register({ definition: def('free'), execute: async () => 'ok' })
            .register({ definition: def('bad-amount'), execute: async (_i, ctx) => { ctx.reportCost?.(-1); ctx.reportCost?.(NaN); return 'ok'; } })
            .register({ definition: def('paid-async', true), execute: async (_i, ctx) => { ctx.reportCost?.(0.1); return 'ok'; } })
            .register({ definition: def('paid-then-fail', true), execute: async (_i, ctx) => { ctx.reportCost?.(0.2); throw new Error('kaput'); } });
        await server.start();
    });
    afterAll(async () => { await server.stop(); });

    const post = async (capability: string) => {
        const res = await fetch(`${url}/v1/agent/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability, input: {} }) });
        return (await res.json()) as { data: { status: string; taskId?: string; costUsd?: number } };
    };
    const task = async (taskId: string) => {
        for (let i = 0; i < 100; i++) {
            const t = ((await (await fetch(`${url}/v1/agent/tasks/${taskId}`)).json()) as { data: { status: string; costUsd?: number } }).data;
            if (t.status === 'done' || t.status === 'failed') return t;
            await new Promise(r => setTimeout(r, 10));
        }
        throw new Error('task did not end');
    };

    it('adds up what a sync handler reports and returns it in the answer', async () => {
        expect((await post('paid')).data.costUsd).toBe(0.75);
    });

    it('leaves costUsd out when nothing was reported (not measured is not zero)', async () => {
        expect('costUsd' in (await post('free')).data).toBe(false);
        expect('costUsd' in (await post('bad-amount')).data).toBe(false);
    });

    it('records the cost on an async task, also when it failed after spending', async () => {
        const ok = await post('paid-async');
        expect((await task(ok.data.taskId!)).costUsd).toBe(0.1);
        const bad = await post('paid-then-fail');
        expect(await task(bad.data.taskId!)).toMatchObject({ status: 'failed', costUsd: 0.2 });
    });

    it('TaskStore keeps costUsd only when given', () => {
        const s = new TaskStore();
        s.create('a'); s.complete('a', 'x', 1.5);
        s.create('b'); s.complete('b', 'x');
        expect(s.get('a')!.costUsd).toBe(1.5);
        expect('costUsd' in s.get('b')!).toBe(false);
    });
});
