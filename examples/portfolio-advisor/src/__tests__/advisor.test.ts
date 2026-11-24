/**
 * The advisor under governance, with a scripted model: no key, no network. The model ALWAYS asks for what the script says; what the tests check is
 * what the framework lets through. Every assertion is on the state of the simulated broker and on the audit, never on what the model says.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAuditChain, type ApprovalRequest, type Approver, type AuditEvent } from '@backendkit-labs/agent-core';
import { mockTransport, scriptedProvider, type Turn } from '@backendkit-labs/agent-testkit';
import { ANALYST, EXECUTOR, REBALANCER, createAdvisor, buildOperator, identityOf, profiles, SimulatedBroker, type AdvisorOptions } from '../index';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'advisor-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// ── scripts: what the scripted model says, in the order the agents speak ──────────────────────────────────────

const ask = (agent: string, question: string): Turn => ({ tool_calls: [{ id: `a-${agent}`, name: 'ask_agent', args: { agent_id: agent, question } }] });
const call = (name: string, args: Record<string, unknown> = {}): Turn => ({ tool_calls: [{ id: `c-${name}`, name, args }] });
const say = (content: string): Turn => ({ content });

/** The orchestrator sends an order through the executor: the three turns of the executor are the call and its answer. */
const tradeScript = (order: Record<string, unknown>): Turn[] => [
    ask(EXECUTOR, 'send this order'), call('place_order', order), say('the executor answered'), say('finished'),
];
const small = { symbol: 'BBB', side: 'buy', quantity: 20, amount: 1_000, currency: 'EUR' };         // within the 5,000 EUR the executor may do alone
const large = { symbol: 'AAA', side: 'sell', quantity: 60, amount: 6_000, currency: 'EUR' };        // above it

/** An approver that answers as `id` and remembers what it was asked. */
function answerAs(id: string, asked: ApprovalRequest[] = []): Approver {
    return {
        ref: { kind: 'human', id },
        request: async (req) => { asked.push(req); return { decision: 'approve', by: { kind: 'human', id }, at: new Date().toISOString() }; },
    };
}
const nobody: Approver = { ref: { kind: 'human', id: 'nobody' }, request: async () => ({ decision: 'reject', by: { kind: 'human', id: 'nobody' }, at: new Date().toISOString() }) };

interface Setup { script: Turn[]; /** The file of the audit log; one per advisor when a test builds two. */ audit?: string; approver?: Approver; userId?: string; mutate?: (o: AdvisorOptions, op: ReturnType<typeof buildOperator>) => void }

function setup(s: Setup) {
    const op = buildOperator({ userId: s.userId ?? 'carlos' });
    const broker = new SimulatedBroker({ cash: 10_000, holdings: { AAA: 60, BBB: 20 } });
    const auditLogPath = join(dir, s.audit ?? 'audit.ndjson');
    const options: AdvisorOptions = {
        provider: scriptedProvider(s.script), transport: mockTransport().transport, userId: op.userId, broker, targets: { AAA: 0.2, BBB: 0.4 },
        identities: op.identities, credentials: op.credentials(), trustedIssuers: op.trustedIssuers, directory: op.directory,
        approver: s.approver ?? nobody, auditLogPath,
    };
    s.mutate?.(options, op);
    const advisor = createAdvisor(options);
    const events = (): AuditEvent[] => readFileSync(auditLogPath, 'utf8').split('\n').filter(Boolean).map(l => (JSON.parse(l) as { event: AuditEvent }).event);
    const order = () => events().find(e => e.tool === 'place_order');
    return { advisor, broker, op, auditLogPath, events, order, run: () => advisor.engine.run('rebalance my portfolio') };
}

describe('an order inside the power of the executor', () => {
    it('runs with nobody asked, and the audit says who, under which power and that possession of the key was proven', async () => {
        const t = setup({ script: tradeScript(small) });
        await t.run();
        expect(t.broker.executed).toEqual([small]);
        expect(t.order()).toMatchObject({
            decision: 'allow', outcome: 'ok', principal: { agentId: EXECUTOR, userId: 'carlos' },
            agentIdentity: { id: identityOf(EXECUTOR) },
            mandate: { subject: 'carlos', agentIdentity: identityOf(EXECUTOR), holderBinding: 'proven' },
        });
    });

    it('every event of every agent is signed by the identity that ran it, and the whole log verifies with the keys of the operator', async () => {
        const t = setup({ script: tradeScript(small) });
        await t.run();
        const verdict = verifyAuditChain(t.auditLogPath, { agentSignatures: { keyOf: t.op.keyOf } });
        expect(verdict).toMatchObject({ ok: true });
        expect(verdict.ok && verdict.signedEvents).toBe(t.events().length);
        // the delegation shows in the log: the orchestrator asked, and the EXECUTOR (not the orchestrator) placed the order
        expect(t.events().map(e => `${e.principal.agentId}:${e.tool}`)).toEqual(expect.arrayContaining([`orchestrator:ask_agent`, `executor:place_order`]));
    });

    it('editing the log afterwards is detected', async () => {
        const t = setup({ script: tradeScript(small) });
        await t.run();
        const lines = readFileSync(t.auditLogPath, 'utf8').split('\n').filter(Boolean);
        const i = lines.findIndex(l => l.includes('"place_order"'));
        lines[i] = lines[i]!.replace('"decision":"allow"', '"decision":"deny"');
        writeFileSync(t.auditLogPath, lines.join('\n') + '\n');
        expect(verifyAuditChain(t.auditLogPath, { agentSignatures: { keyOf: t.op.keyOf } }).ok).toBe(false);
    });
});

describe('an order above the limit asks a person, who must not be the one who asked', () => {
    it('a person of finance approves and the order runs; the audit keeps who approved', async () => {
        const asked: ApprovalRequest[] = [];
        const t = setup({ script: tradeScript(large), approver: answerAs('ana', asked) });
        await t.run();
        expect(asked).toHaveLength(1);
        expect(asked[0]).toMatchObject({ principal: { agentId: EXECUTOR, userId: 'carlos' } });
        expect(t.broker.executed).toEqual([large]);
        expect(t.order()).toMatchObject({ decision: 'allow', outcome: 'ok', approval: { by: { id: 'ana' } } });
    });

    it('carlos, who asked for the rebalance, cannot approve it himself (four eyes), even though he is a person', async () => {
        const t = setup({ script: tradeScript(large), approver: answerAs('carlos') });
        await t.run();
        expect(t.broker.executed).toHaveLength(0);
    });

    it('with nobody to answer, the order does not run', async () => {
        const t = setup({ script: tradeScript(large), approver: nobody });
        await t.run();
        expect(t.broker.executed).toHaveLength(0);
    });

    // FINDING 1 (see the README). This is the behaviour we want and today it FAILS, so it is written with `it.failing`: the suite is green while the
    // gap exists and goes red the day the framework closes it, which is the signal to change `it.failing` into `it`. The `ask` that `mandatePolicy`
    // returns for an order outside the mandate carries no `approverRoles`, so the engine accepts any person who is not the requester.
    it.failing('a person with no authority over this (an intern) cannot approve it either', async () => {
        const t = setup({ script: tradeScript(large), approver: answerAs('intern') });
        await t.run();
        expect(t.broker.executed).toHaveLength(0);
    });
});

describe('a power that is not valid is no power, each for its own reason', () => {
    it('a credential stolen from the executor, presented by an agent that does not hold its key: refused even for a small order', async () => {
        const thief = generateKeyPairSync('ed25519');
        const t = setup({
            script: tradeScript(small),
            mutate: (o, op) => { o.credentials[EXECUTOR] = op.credentialFor(EXECUTOR, { holderKey: thief.publicKey }); },   // tied to another key
        });
        await t.run();
        expect(t.broker.executed).toHaveLength(0);
        expect(t.order()?.reason).toMatch(/prove possession/);
    });

    it('a credential issued to another agent identity does not cover the executor', async () => {
        const t = setup({ script: tradeScript(small), mutate: (o, op) => { o.credentials[EXECUTOR] = op.credentialFor(EXECUTOR, { forAgent: REBALANCER }); } });
        await t.run();
        expect(t.broker.executed).toHaveLength(0);
        expect(t.order()).toMatchObject({ decision: 'deny', reason: expect.stringMatching(/another agent identity/) });
    });

    it('with no credential the executor holds no power and nothing runs', async () => {
        const t = setup({ script: tradeScript(small), mutate: (o) => { delete o.credentials[EXECUTOR]; } });
        await t.run();
        expect(t.broker.executed).toHaveLength(0);
        expect(t.order()).toMatchObject({ decision: 'deny', reason: expect.stringMatching(/no valid mandate/) });
    });

    it('a credential for another person does not serve carlos', async () => {
        const t = setup({ script: tradeScript(small), mutate: (o) => { o.userId = 'laura'; } });   // the credentials empower carlos
        await t.run();
        expect(t.broker.executed).toHaveLength(0);
    });

    it('the executor power does not cover another agent that has the same tool: the rebalancer given place_order and the executor credential', async () => {
        const rogue = profiles.map(p => (p.id === REBALANCER ? { ...p, allowedTools: [...(p.allowedTools ?? []), 'place_order'] } : p));
        const t = setup({
            script: [ask(REBALANCER, 'send this order'), call('place_order', small), say('the rebalancer answered'), say('finished')],
            mutate: (o, op) => { o.agents = rogue; o.credentials[REBALANCER] = op.credentialFor(EXECUTOR); },
        });
        await t.run();
        expect(t.broker.executed).toHaveLength(0);
        expect(t.events().find(e => e.tool === 'place_order')).toMatchObject({ principal: { agentId: REBALANCER }, decision: 'deny' });
    });

    it('a credential not tied to a key (a bearer one) is refused when the operator requires possession, and accepted but marked none when it does not', async () => {
        const bearer = (o: AdvisorOptions, op: ReturnType<typeof buildOperator>) => { o.credentials[EXECUTOR] = op.credentialFor(EXECUTOR, { holderKey: null }); };
        const strict = setup({ script: tradeScript(small), mutate: bearer });
        await strict.run();
        expect(strict.broker.executed).toHaveLength(0);

        const lax = setup({ script: tradeScript(small), audit: 'lax.ndjson', mutate: (o, op) => { bearer(o, op); o.requireHolderBinding = false; } });
        await lax.run();
        expect(lax.broker.executed).toHaveLength(1);
        expect(lax.order()?.mandate).toMatchObject({ holderBinding: 'none' });
    });
});

describe('the agents that only read', () => {
    it('the analyst reads the portfolio and a signal under its own power, and cannot place an order: it does not list the tool', async () => {
        const t = setup({ script: [ask(ANALYST, 'what do the signals say?'), call('get_portfolio'), call('get_signal', { symbol: 'AAA' }), say('analysis done'), say('finished')] });
        await t.run();
        const tools = t.events().filter(e => e.principal.agentId === ANALYST).map(e => `${e.tool}:${e.decision}`);
        expect(tools).toEqual(['get_portfolio:allow', 'get_signal:allow']);
        expect(t.broker.executed).toHaveLength(0);
    });

    it('an agent with no credential is denied even a read: the framework does not guess that reading is fine', async () => {
        const t = setup({
            script: [ask(ANALYST, 'what do the signals say?'), call('get_signal', { symbol: 'AAA' }), say('analysis done'), say('finished')],
            mutate: (o) => { delete o.credentials[ANALYST]; },
        });
        await t.run();
        expect(t.events().find(e => e.tool === 'get_signal')).toMatchObject({ decision: 'deny' });
    });

    it('the signal of a symbol with no data fails as an error, not as an invented answer', async () => {
        const t = setup({ script: [ask(ANALYST, 'x'), call('get_signal', { symbol: 'ZZZ' }), say('done'), say('finished')] });
        await t.run();
        expect(t.events().find(e => e.tool === 'get_signal')).toMatchObject({ decision: 'allow', outcome: 'error' });
    });
});
