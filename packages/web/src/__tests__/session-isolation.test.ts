/**
 * Per-user isolation of /sessions, DELETE /sessions/:id and /monitor on a real server.
 * The auth hook stands in for JwtAuth: it sets req.user from ?as=<sub>&roles=<a,b> (a query string works for
 * both fetch and a browser-style WebSocket, which cannot set headers).
 */
import WsClient from 'ws';
import { AgentServer } from '../server/AgentServer';
import type { AgentEngine } from '@backendkit-labs/agent-core';
import type { AuthHook } from '../server/AgentServer';

jest.setTimeout(20_000);

const engine = () => ({
    run: jest.fn().mockResolvedValue(undefined), abort: jest.fn(), use: jest.fn(), getTools: jest.fn().mockReturnValue([]),
}) as unknown as AgentEngine;

const asUser: AuthHook = async (req) => {
    const q = req.query as Record<string, string>;
    if (q.as !== undefined) req.user = { sub: q.as, roles: (q.roles ?? '').split(',').filter(Boolean) };
    if (q.nosub) req.user = { roles: [] } as never;
};

type Frame = Record<string, unknown>;

function connect(port: number, path: string): Promise<{ ws: WsClient; first: Frame; later: Frame[] }> {
    return new Promise((resolve, reject) => {
        const ws = new WsClient(`ws://127.0.0.1:${port}${path}`);
        const later: Frame[] = [];
        let first: Frame | undefined;
        const t = setTimeout(() => reject(new Error(`WS connect timeout: ${path}`)), 5_000);
        ws.on('message', d => {
            const frame = JSON.parse(d.toString()) as Frame;
            if (!first) { first = frame; clearTimeout(t); resolve({ ws, first, later }); } else later.push(frame);
        });
        ws.on('error', reject);
    });
}

const pause = (ms = 250) => new Promise(r => setTimeout(r, ms));
const close = (ws: WsClient) => new Promise<void>(r => {
    if (ws.readyState === WsClient.CLOSED) return r(); // e.g. the server ended the session on DELETE
    ws.once('close', () => r());
    ws.close();
});

async function getJson(port: number, path: string) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() as Record<string, unknown> };
}
async function del(port: number, path: string) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'DELETE' });
    return { status: res.status };
}

describe('session isolation with an authenticated user', () => {
    let server: AgentServer;
    let port: number;
    let alice: Awaited<ReturnType<typeof connect>>;
    let bob: Awaited<ReturnType<typeof connect>>;
    let aliceId: string;
    let bobId: string;

    beforeAll(async () => {
        server = new AgentServer({ port: 0, host: '127.0.0.1', engineFactory: () => engine(), auth: asUser });
        port = parseInt((await server.start()).split(':').pop()!, 10);
        alice = await connect(port, '/chat?as=alice');
        bob = await connect(port, '/chat?as=bob');
        aliceId = alice.first.sessionId as string;
        bobId = bob.first.sessionId as string;
    });
    afterAll(async () => {
        await Promise.all([close(alice.ws), close(bob.ws)]);
        await server.stop();
    });

    const idsFor = async (query: string) =>
        ((await getJson(port, `/sessions?${query}`)).body.sessions as Array<{ id: string }>).map(s => s.id).sort();

    it('GET /sessions lists only the caller\'s sessions', async () => {
        expect(await idsFor('as=alice')).toEqual([aliceId]);
        expect(await idsFor('as=bob')).toEqual([bobId]);
        expect(await idsFor('as=carol')).toEqual([]);
    });

    it('the admin role lists every session', async () => {
        expect(await idsFor('as=root&roles=admin')).toEqual([aliceId, bobId].sort());
    });

    it('a token without sub lists nothing', async () => {
        expect(await idsFor('nosub=1')).toEqual([]);
    });

    it('DELETE of another user\'s session is a 404 and leaves it running', async () => {
        expect((await del(port, `/sessions/${aliceId}?as=bob`)).status).toBe(404);
        expect((await del(port, `/sessions/${aliceId}?nosub=1`)).status).toBe(404);
        expect(await idsFor('as=alice')).toEqual([aliceId]);
    });

    it('DELETE of a session that does not exist is the same 404', async () => {
        expect((await del(port, '/sessions/does-not-exist?as=bob')).status).toBe(404);
    });

    it('/monitor greets a user with their own sessions only and streams only their frames', async () => {
        const mon = await connect(port, '/monitor?as=alice');
        try {
            expect(mon.first.sessionIds).toEqual([aliceId]);
            // a new session of bob is invisible to alice's observer; one of alice's is not
            const bob2 = await connect(port, '/chat?as=bob');
            const alice2 = await connect(port, '/chat?as=alice');
            await pause();
            const opened = mon.later.filter(f => f.type === 'monitor_session_open').map(f => f.sessionId);
            expect(opened).toEqual([alice2.first.sessionId]);
            expect(JSON.stringify(mon.later)).not.toContain(bob2.first.sessionId as string);
            await Promise.all([close(bob2.ws), close(alice2.ws)]);
        } finally {
            await close(mon.ws);
        }
    });

    it('/monitor with the admin role sees every session', async () => {
        const mon = await connect(port, '/monitor?as=root&roles=admin');
        try {
            expect((mon.first.sessionIds as string[]).sort()).toEqual([aliceId, bobId].sort());
        } finally {
            await close(mon.ws);
        }
    });

    it('the owner can end their own session', async () => {
        expect((await del(port, `/sessions/${bobId}?as=bob`)).status).toBe(200);
        await pause();
        expect(await idsFor('as=bob')).toEqual([]);
    });
});

describe('without auth the server stays single-tenant', () => {
    it('/sessions lists every session and any caller may end one', async () => {
        const server = new AgentServer({ port: 0, host: '127.0.0.1', engineFactory: () => engine() });
        const port = parseInt((await server.start()).split(':').pop()!, 10);
        const a = await connect(port, '/chat');
        const b = await connect(port, '/chat');
        try {
            const ids = ((await getJson(port, '/sessions')).body.sessions as Array<{ id: string }>).map(s => s.id).sort();
            expect(ids).toEqual([a.first.sessionId as string, b.first.sessionId as string].sort());
            expect((await del(port, `/sessions/${a.first.sessionId}`)).status).toBe(200);
        } finally {
            await Promise.all([close(a.ws), close(b.ws)]);
            await server.stop();
        }
    });
});
