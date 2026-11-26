import * as net from 'node:net';
import { AgentServer, AgentClient, CapabilityError } from '../index';
import type { CapabilityDefinition } from '../index';

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

const def = (name: string, async = false): CapabilityDefinition => ({ name, description: name, async, input: {}, output: {} });
const SECRET = 'connect ECONNREFUSED postgres://admin:hunter2@10.0.0.7/ledger';

interface Logged { err: unknown; errorId: string; where: string; traceId?: string }

const running: AgentServer[] = [];
async function start(extra: Partial<ConstructorParameters<typeof AgentServer>[0]> = {}) {
    const port = await freePort();
    const logged: Logged[] = [];
    const server = new AgentServer({
        name: 'e', version: '1.0.0', description: 'd', port, allowUngated: true,
        onInternalError: (err, info) => logged.push({ err, ...info }),
        ...extra,
    });
    server.register({ definition: def('leak'), execute: async () => { throw new Error(SECRET); } });
    server.register({ definition: def('leak-later', true), execute: async () => { throw new Error(SECRET); } });
    server.register({ definition: def('refuse'), execute: async () => { throw new CapabilityError('INVALID_INPUT', 'invoice INV-7 is already paid', { invoice: 'INV-7' }); } });
    await server.start();
    running.push(server);
    return { url: `http://127.0.0.1:${port}`, logged };
}
afterAll(async () => { await Promise.all(running.map(s => s.stop())); });

const run = (url: string, capability: string, traceId?: string) => fetch(`${url}/v1/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(traceId ? { 'X-Trace-ID': traceId } : {}) },
    body: JSON.stringify({ capability, input: {} }),
});

describe('what an error tells the caller', () => {
    it('an internal error reaches the caller as an errorId, and the server log has the error under that id', async () => {
        const { url, logged } = await start();
        const res = await run(url, 'leak', 'trace-9');
        expect(res.status).toBe(500);
        const { error } = await res.json() as { error: { code: string; message: string; details: { errorId: string } } };
        expect(JSON.stringify(error)).not.toContain('hunter2');
        expect(error.code).toBe('EXECUTION_FAILED');
        expect(logged).toHaveLength(1);
        expect(logged[0]).toMatchObject({ errorId: error.details.errorId, where: 'capability leak', traceId: 'trace-9' });
        expect((logged[0].err as Error).message).toBe(SECRET);
    });

    it('an async task that fails records the generic message, not the internal one', async () => {
        const { url, logged } = await start();
        const client = new AgentClient({ url, circuitBreaker: false, maxRetries: 0 });
        const failure = await client.runAndWait('leak-later', {}, { pollInterval: 20, maxWait: 5_000 }).catch((e: Error) => e);
        expect((failure as Error).message).not.toContain('hunter2');
        expect((failure as Error).message).toContain(logged[0].errorId);
    });

    it('a CapabilityError is meant for the caller: its code, status, message and details go through', async () => {
        const { url, logged } = await start();
        const res = await run(url, 'refuse');
        expect(res.status).toBe(400);
        expect((await res.json() as { error: unknown }).error).toEqual({ code: 'INVALID_INPUT', message: 'invoice INV-7 is already paid', details: { invoice: 'INV-7' } });
        expect(logged).toEqual([]);
    });

    it('a gate that throws is refused without telling the caller why', async () => {
        const { url, logged } = await start({ allowUngated: false, gate: () => { throw new Error(SECRET); } });
        const res = await run(url, 'refuse');
        expect(res.status).toBe(403);
        expect(JSON.stringify(await res.json())).not.toContain('hunter2');
        expect(logged[0]).toMatchObject({ where: 'gate of refuse' });
    });

    it('a logger that throws does not change the answer', async () => {
        const { url } = await start({ onInternalError: () => { throw new Error('log sink down'); } });
        expect((await run(url, 'leak')).status).toBe(500);
    });
});
