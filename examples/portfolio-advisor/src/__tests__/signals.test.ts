/**
 * The signals as an MCP server (`signals-server.ts`): another process in production, here a real HTTP server on loopback. The advisor CONSUMES it with the
 * framework's own MCP client; what the tests check is what the framework does with a tool that comes from OUTSIDE: who may call it, whether it asks, what
 * the audit of each side says. The model is scripted and the market is simulated: no key, no network beyond loopback.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryAuditSink, type ApprovalRequest, type RunningToolServer } from '@backendkit-labs/agent-core';
import { ANALYST, REBALANCER, SIGNALS_SERVER, startSignalsServer } from '../index';
import { answerAs, ask, call, nobody, say, setup as build, type Setup } from './harness';

const SIGNAL = 'mcp__signals__get_signal';
const TOKEN = 'a-token-of-the-example';

let dir: string;
let server: RunningToolServer;
let serverAudit: MemoryAuditSink;
const open: Array<{ disconnect(): Promise<void> | undefined }> = [];

beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'signals-'));
    serverAudit = new MemoryAuditSink();
    server = await startSignalsServer({ authToken: TOKEN, auditSink: serverAudit });
});
afterEach(async () => {
    for (const m of open.splice(0)) await m.disconnect();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
});

/** The advisor of the harness, connected to the server. `trust`: believe it when it says a tool is read-only. */
function connected(s: Setup, signals: { url?: string; token?: string; trust?: boolean } = {}) {
    const t = build({ ...s, mutate: (o, op) => { o.signals = { url: server.url, token: TOKEN, ...signals }; s.mutate?.(o, op); } }, dir);
    const manager = t.advisor.engine.getMCPManager();
    if (manager) open.push({ disconnect: () => manager.disconnect() });
    return t;
}
const read = [ask(ANALYST, 'signals?'), call(SIGNAL, { symbol: 'AAA', allocation: 0.4 }), say('analysis done'), say('finished')];

describe('the analyst reads the signals from the server', () => {
    it('with a server it trusts, the call runs with nobody asked, and the result is the server\'s', async () => {
        const t = connected({ script: read }, { trust: true });
        await t.run();
        expect(t.events().find(e => e.tool === SIGNAL)).toMatchObject({ principal: { agentId: ANALYST }, decision: 'allow', outcome: 'ok' });
        expect(t.events().find(e => e.tool === SIGNAL)?.mandate).toBeUndefined();     // reading holds no power
    });

    it('the server has its own identity and its own audit: it records the call and signs it, as another party', async () => {
        const t = connected({ script: read }, { trust: true });
        await t.run();
        expect(serverAudit.events).toHaveLength(1);
        expect(serverAudit.events[0]).toMatchObject({
            tool: 'get_signal', decision: 'allow', outcome: 'ok',
            principal: { agentId: SIGNALS_SERVER, userId: 'market-data' }, agentIdentity: { id: 'did:example:agent:signals' },
        });
        expect(serverAudit.events[0]!.agentSignature).toBeDefined();
        // The advisor's log does not contain the server's calls, and the server's does not contain the advisor's: two parties, two logs.
        expect(t.events().some(e => e.principal.agentId === SIGNALS_SERVER)).toBe(false);
    });

    it('the local copy of the tool is not offered any more: the signals come from one place', async () => {
        const t = connected({ script: [ask(ANALYST, 'x'), call('get_signal', { symbol: 'AAA' }), say('done'), say('finished')] }, { trust: true });
        await t.run();
        expect(t.events().find(e => e.tool === 'get_signal')).toMatchObject({ decision: 'not_found' });
        expect(serverAudit.events).toHaveLength(0);
    });

    it('the unknown symbol is an error of the server, not an invented answer', async () => {
        const t = connected({ script: [ask(ANALYST, 'x'), call(SIGNAL, { symbol: 'ZZZ' }), say('done'), say('finished')] }, { trust: true });
        await t.run();
        expect(t.events().find(e => e.tool === SIGNAL)).toMatchObject({ decision: 'allow', outcome: 'error' });
        expect(serverAudit.events[0]).toMatchObject({ outcome: 'error' });
    });
});

describe('a tool that comes from outside is believed only if the server is', () => {
    it('by default the client does not believe the declaration "read-only": the call asks a person, and with nobody it does not run', async () => {
        const t = connected({ script: read, approver: nobody });
        await t.run();
        expect(t.events().find(e => e.tool === SIGNAL)).toMatchObject({ decision: 'deny' });
        expect(serverAudit.events).toHaveLength(0);                       // it never reached the server
    });

    it('the person who approves lets it through, and the server answers', async () => {
        const asked: ApprovalRequest[] = [];
        const t = connected({ script: read, approver: answerAs('ana', asked) });
        await t.run();
        expect(asked).toHaveLength(1);
        expect(asked[0]!.reason).toMatch(/not declared read-only/);
        expect(t.events().find(e => e.tool === SIGNAL)).toMatchObject({ decision: 'allow', approval: { by: { id: 'ana' } } });
        expect(serverAudit.events).toHaveLength(1);
    });
});

describe('only the analyst has the tool, and only with the credential of the server', () => {
    it('another agent does not have it: it is not in its profile, and the call is refused', async () => {
        const t = connected({ script: [ask(REBALANCER, 'x'), call(SIGNAL, { symbol: 'AAA' }), say('done'), say('finished')] }, { trust: true });
        await t.run();
        expect(t.events().find(e => e.tool === SIGNAL)).toMatchObject({ principal: { agentId: REBALANCER }, decision: 'not_allowed', reason: expect.stringMatching(/not in the allowedTools/) });
        expect(serverAudit.events).toHaveLength(0);
    });

    it('with the wrong token nobody connects, and the analyst has no signals: the advisor does not invent them', async () => {
        // The client warns that it could not connect: that is what this test provokes, so the warning is checked here and does not clutter the output.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const t = connected({ script: read }, { trust: true, token: 'not-the-token' });
            await t.run();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to connect to "signals"'));
            expect(t.events().find(e => e.tool === SIGNAL)).toMatchObject({ principal: { agentId: ANALYST }, decision: 'not_found' });   // the tool is not there: the server never connected
        } finally { warn.mockRestore(); }
        expect(serverAudit.events).toHaveLength(0);
    });
});
