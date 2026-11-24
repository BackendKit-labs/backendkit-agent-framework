/**
 * The rebalance as a durable flow: it stops for a person, survives a restart, and goes on without repeating what it did. A "restart" here is a new
 * advisor (new engine, new journal object, new approval store) over the same directory: nothing is shared in memory except the simulated broker,
 * which stands for the real one.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stepApprovalId, verifyAuditChain, type ApproverRef } from '@backendkit-labs/agent-core';
import { approvalHandler, directory, runRebalance } from '../index';
import { answerAs, call, large, say, setup, small, type Setup } from './harness';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'advisor-flow-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const RUN = 'rebalance-2026-11';
const runDir = () => join(dir, 'run');
const build = (s: Setup) => setup({ audit: 'audit.ndjson', ...s }, dir);
const start = (advisor: ReturnType<typeof build>, userId = 'carlos') => runRebalance({ engine: advisor.advisor.engine, dir: runDir(), runId: RUN, userId, directory });
const decide = (decision: 'approve' | 'reject', by: ApproverRef) =>
    approvalHandler(runDir(), directory).decide(stepApprovalId(RUN, 'execute'), { decision, by, reason: 'seen' });
const human = (id: string): ApproverRef => ({ kind: 'human', id });

const planTurns = [call('plan_rebalance'), say('plan ready')];

describe('the rebalance flow', () => {
    it('plans, stops for a person, and nothing is sent until that person decides', async () => {
        const p1 = build({ script: planTurns });
        const first = await start(p1);
        expect(first.status).toBe('awaiting_approval');
        expect(p1.events().map(e => e.tool)).toEqual(['plan_rebalance']);
        expect(p1.broker.executed).toHaveLength(0);
    });

    it('survives a restart: after the decision it goes on, does not plan again, and sends the order', async () => {
        const p1 = build({ script: planTurns });
        await start(p1);

        // the process dies. A new one, with its own engine, journal and store, over the same directory.
        const p2 = build({ script: [call('place_order', small), say('sent')], broker: p1.broker, op: p1.op });
        await decide('approve', human('ana'));
        const second = await start(p2);

        expect(second.status).toBe('completed');
        expect(p2.broker.executed).toEqual([small]);
        // the plan was computed once, by the first process; the second one only sent
        expect(p2.events().filter(e => e.tool === 'plan_rebalance')).toHaveLength(1);
        // the audit of the two processes is one chain, every event signed by the agent that ran it
        const verdict = verifyAuditChain(p2.auditLogPath, { agentSignatures: { keyOf: p2.op.keyOf } });
        expect(verdict).toMatchObject({ ok: true });
        expect(verdict.ok && verdict.signedEvents).toBe(p2.events().length);
    });

    it('an order above the limit asks again even though the plan was approved: approving the plan is not approving every order', async () => {
        const p1 = build({ script: planTurns });
        await start(p1);
        const asked: unknown[] = [];
        const p2 = build({ script: [call('place_order', large), say('sent')], broker: p1.broker, op: p1.op, approver: answerAs('laura', asked as never) });
        await decide('approve', human('ana'));
        await start(p2);
        expect(asked).toHaveLength(1);                       // the engine asked, on top of the flow
        expect(p2.broker.executed).toEqual([large]);
    });

    it('a rejected plan sends nothing, and the executor never runs', async () => {
        const p1 = build({ script: planTurns });
        await start(p1);
        const p2 = build({ script: [call('place_order', small), say('sent')], broker: p1.broker, op: p1.op });
        await decide('reject', human('ana'));
        const second = await start(p2);
        expect(second.status).not.toBe('completed');
        expect(p2.broker.executed).toHaveLength(0);
        expect(p2.events().some(e => e.tool === 'place_order')).toBe(false);
    });

    it('with no decision yet, running it again changes nothing', async () => {
        const p1 = build({ script: planTurns });
        await start(p1);
        const p2 = build({ script: [call('place_order', small), say('sent')], broker: p1.broker, op: p1.op });
        const again = await start(p2);
        expect(again.status).toBe('awaiting_approval');
        expect(p2.broker.executed).toHaveLength(0);
    });

    // Who may approve the plan. A flow gate used to say "a human" and nothing more (agent-core before 0.49.9): an intern, or the person who asked, could
    // approve. Now the policy names the role and the flow, the handler and the check when it goes on all apply it, with four eyes.
    describe('who may approve the plan', () => {
        const approvedBy = async (who: string, requester = 'carlos') => {
            const p1 = build({ script: planTurns, userId: requester });
            await start(p1, requester);
            const p2 = build({ script: [call('place_order', small), say('sent')], broker: p1.broker, op: p1.op, userId: requester });
            const refused = await decide('approve', human(who)).then(() => undefined, (err: { code?: string }) => err.code);
            await start(p2, requester);
            return { executed: p2.broker.executed, refused };
        };

        it('a person of finance approves it and the order is sent', async () => {
            expect((await approvedBy('ana')).executed).toHaveLength(1);
        });
        it('not someone with no authority over it (an intern): the handler refuses and the plan stays open', async () => {
            const r = await approvedBy('intern');
            expect(r.refused).toBe('FORBIDDEN');
            expect(r.executed).toHaveLength(0);
        });
        it('not the person who asked for the rebalance, even with the role (four eyes)', async () => {
            const r = await approvedBy('laura', 'laura');          // laura is in finance and asked for it
            expect(r.refused).toBe('FORBIDDEN');
            expect(r.executed).toHaveLength(0);
        });
        it('after a refused decision, a person who may decide still can, and the flow goes on', async () => {
            const p1 = build({ script: planTurns });
            await start(p1);
            await expect(decide('approve', human('intern'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
            await decide('approve', human('ana'));
            const p2 = build({ script: [call('place_order', small), say('sent')], broker: p1.broker, op: p1.op });
            expect((await start(p2)).status).toBe('completed');
        });
    });
});
