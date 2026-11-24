/**
 * The advisor offered over the agent protocol (`service.ts`): a real HTTP server on loopback and a real client. What the tests check is what the
 * identity gate and the advisor behind it do with a call that comes from the network: who it is for, what is refused before anything runs, and that the
 * person of the token is the one the mandate has to empower. The model is scripted and the market simulated.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentClient, type AgentServer } from '@backendkit-labs/agent-protocol';
import { MemoryAuditSink, agentSignatureProblem, ed25519AgentIdentities, type AuditEvent } from '@backendkit-labs/agent-core';
import { mockTransport, scriptedProvider, type Turn } from '@backendkit-labs/agent-testkit';
import { SERVICE, SimulatedBroker, USER_TOKEN_HEADER, buildAdvisorService, buildOperator, createAdvisor } from '../index';
import { nobody, small, tradeScript } from './harness';

const API_KEY = 'shared-key-of-the-example';
const TOKENS = { 'token-of-carlos': 'carlos', 'token-of-intern': 'intern' };

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
    });
}

let dir: string;
let server: AgentServer | undefined;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'service-')); });
afterEach(async () => { await server?.stop(); server = undefined; rmSync(dir, { recursive: true, force: true }); });

async function start(script: Turn[] = tradeScript(small)) {
    const port = await freePort();
    const op = buildOperator({ userId: 'carlos' });
    const broker = new SimulatedBroker({ cash: 10_000, holdings: { AAA: 60, BBB: 20 } });
    const targets = { AAA: 0.2, BBB: 0.4 };
    const serviceKey = generateKeyPairSync('ed25519');
    const audit = new MemoryAuditSink();
    server = buildAdvisorService({
        port, apiKey: API_KEY, tokens: TOKENS, broker, targets, auditSink: audit,
        identities: ed25519AgentIdentities({ [SERVICE]: { id: 'did:example:agent:advisor-service', privateKey: serviceKey.privateKey } }),
        // One advisor per person: it is the person of the token the mandates have to empower.
        advisorFor: (userId) => createAdvisor({
            provider: scriptedProvider(script), transport: mockTransport().transport, userId, broker, targets,
            identities: op.identities, credentials: op.credentials(), trustedIssuers: op.trustedIssuers, directory: op.directory,
            approver: nobody, auditLogPath: join(dir, `advisor-${userId}.ndjson`),
        }),
    });
    await server.start();
    const url = `http://127.0.0.1:${port}`;
    // The client carries the personal token of each call (`headers`, agent-protocol 0.7.3); `post` is the raw request, for what the client would not send (no key, no token).
    const client = new AgentClient({ url, apiKey: API_KEY });
    const post = async (capability: string, headers: Record<string, string> = {}, key: string | null = API_KEY) => {
        const res = await fetch(`${url}/v1/agent/run`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers }, body: JSON.stringify({ capability, input: {} }),
        });
        return { status: res.status, body: (await res.json()) as { data?: unknown; error?: { code?: string; message?: string } } };
    };
    /** Runs a capability for the person of the token and waits for its answer. */
    const runFor = (token: string, capability: string): Promise<unknown> => client.runAndWait(capability, {}, { headers: { [USER_TOKEN_HEADER]: token }, pollInterval: 25 });
    return { broker, audit, post, runFor, client, serviceAudit: (): AuditEvent[] => audit.events, serviceKey };
}

describe('what is refused before anything runs', () => {
    it('with no personal token the run has no person to act for: refused, and the reason says what is missing', async () => {
        const s = await start();
        const r = await s.post('plan_rebalance');
        expect(r.status).toBe(403);
        expect(r.body.error).toMatchObject({ code: 'FORBIDDEN', message: expect.stringMatching(/x-user-token.*person to act for/) });
        expect(s.serviceAudit()[0]).toMatchObject({ decision: 'deny', tool: 'plan_rebalance' });
        expect(s.broker.executed).toHaveLength(0);
    });

    it('a header the caller sets by itself is not an identity: naming "carlos" in x-tenant-id or x-user-id gets nothing', async () => {
        const s = await start();
        const r = await s.post('rebalance', { 'x-tenant-id': 'carlos', 'x-user-id': 'carlos' });
        expect(r.status).toBe(403);
        expect(s.broker.executed).toHaveLength(0);
    });

    it('the client of the protocol sends the token of each call, and with none the refusal reaches the caller as an error', async () => {
        const s = await start();
        await expect(s.client.run('plan_rebalance', {})).rejects.toMatchObject({ status: 403 });
        await expect(s.client.run('plan_rebalance', {}, { headers: { [USER_TOKEN_HEADER]: 'token-of-carlos' } })).resolves.toMatchObject({ status: 'done' });
        expect(s.serviceAudit().map(e => e.decision)).toEqual(['deny', 'allow']);
    });

    it('a token nobody issued is refused the same way', async () => {
        const s = await start();
        expect((await s.post('plan_rebalance', { [USER_TOKEN_HEADER]: 'invented' })).status).toBe(403);
    });

    it('without the shared key the protocol does not even look at the token', async () => {
        const s = await start();
        expect((await s.post('plan_rebalance', { [USER_TOKEN_HEADER]: 'token-of-carlos' }, null)).status).toBe(401);
        expect(s.serviceAudit()).toHaveLength(0);
    });
});

describe('a run for a person', () => {
    it('plan_rebalance answers at once, and the audit of the service says who it acted for and is signed by the service', async () => {
        const s = await start();
        const answer = await s.runFor('token-of-carlos', 'plan_rebalance') as { orders: unknown[] };
        expect(answer.orders.length).toBeGreaterThan(0);
        const [event] = s.serviceAudit();
        expect(event).toMatchObject({
            decision: 'allow', outcome: 'ok', tool: 'plan_rebalance',
            principal: { agentId: SERVICE, userId: 'carlos' }, agentIdentity: { id: 'did:example:agent:advisor-service' },
        });
        // The signature verifies with the public key of the service, and with any other key it does not: the log of a service is proof of what IT ran.
        expect(agentSignatureProblem(event!, { keyOf: () => s.serviceKey.publicKey })).toBeUndefined();
        expect(agentSignatureProblem(event!, { keyOf: () => generateKeyPairSync('ed25519').publicKey })).toBeDefined();
    });

    it('rebalance runs the advisor for the person of the token: an order inside their power is sent', async () => {
        const s = await start();
        await s.runFor('token-of-carlos', 'rebalance');
        expect(s.broker.executed).toEqual([small]);
    });

    it('the person of the token is the one the mandate has to empower: the same order for the intern is not sent', async () => {
        const s = await start();
        await s.runFor('token-of-intern', 'rebalance');
        expect(s.broker.executed).toHaveLength(0);
    });
});
