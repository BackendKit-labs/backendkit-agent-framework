/** The gate on its own: no engine, no provider, no loop. This is what moving it out of AgentEngine buys. */
import { GovernanceGate, type GovernanceGateDeps } from '../GovernanceGate';
import { declaredAskPolicy } from '../../governance/policy';
import type { Approver, ApproverRef, Principal, ToolPolicy } from '../../governance/types';
import type { ToolDefinition } from '../../types';

const principal: Principal = { agentId: 'desk', sessionId: 's', chain: ['desk'], userId: 'carlos' };
const tool = { name: 'pay', description: '', parameters: {}, destructive: true, execute: async () => 'paid' } as ToolDefinition;
const ana: ApproverRef = { kind: 'human', id: 'ana' };
const answer = (by: ApproverRef, decision: 'approve' | 'reject' = 'approve'): Approver => ({
    ref: by,
    request: async () => ({ decision, by, at: new Date().toISOString() }),
});
const askHuman: ToolPolicy = { decide: () => ({ effect: 'ask', reason: 'always', accepts: ['human'] }) };

function gate(over: Partial<GovernanceGateDeps> = {}) {
    const events: unknown[] = [];
    const g = new GovernanceGate({
        policies: [askHuman, declaredAskPolicy],
        hasSandbox: false,
        agents: { get: () => undefined },
        transport: { emit: (e: unknown) => { events.push(e); } } as never,
        principalFor: (agentId, chain) => ({ ...principal, agentId, chain: chain ?? [agentId] }),
        noApproverForSandbox: (t) => ({ run: false, decision: 'sandbox_denied', reason: 'x', message: t }),
        ...over,
    });
    return { g, events };
}

const decide = (g: GovernanceGate, args = '{"amount":5}') => g.decide(tool, args, principal, []);

describe('GovernanceGate.decide', () => {
    it('allows when the policies allow', async () => {
        const { g } = gate({ policies: [{ decide: () => ({ effect: 'allow' }) }] });
        expect(await decide(g)).toEqual({ run: true });
    });

    it('denies when a policy denies, and when a policy throws (fail closed)', async () => {
        expect(await decide(gate({ policies: [{ decide: () => ({ effect: 'deny', reason: 'no' }) }] }).g)).toMatchObject({ run: false, decision: 'deny' });
        const boom: ToolPolicy = { decide: () => { throw new Error('bad'); } };
        expect(await decide(gate({ policies: [boom] }).g)).toMatchObject({ run: false, decision: 'deny', reason: expect.stringContaining('policy failed') });
    });

    it('refuses arguments that are valid JSON but not an object', async () => {
        const { g } = gate({ policies: [{ decide: () => ({ effect: 'allow' }) }] });
        for (const raw of ['[1]', 'null', '7']) expect(await decide(g, raw)).toMatchObject({ run: false, decision: 'deny', reason: 'the arguments are not a JSON object' });
    });

    it('asks the live approver: approve runs, reject does not', async () => {
        expect(await decide(gate({ approver: answer(ana) }).g)).toMatchObject({ run: true, approval: { by: ana } });
        expect(await decide(gate({ approver: answer(ana, 'reject') }).g)).toMatchObject({ run: false, decision: 'deny' });
    });

    it('with no approver and no store an ask is refused, never run', async () => {
        expect(await decide(gate().g)).toMatchObject({ run: false, decision: 'deny', reason: expect.stringContaining('no approver is configured') });
    });

    it('an approver that does not answer in time is denied', async () => {
        const never: Approver = { ref: ana, request: () => new Promise(() => undefined) };
        expect(await decide(gate({ approver: never, approverTimeoutMs: 30 }).g)).toMatchObject({ run: false, decision: 'deny', reason: expect.stringContaining('did not answer in 30ms') });
    });

    it('an approver that is the person who asked is refused when four eyes is on', async () => {
        const carlos: ApproverRef = { kind: 'human', id: 'carlos' };
        expect(await decide(gate({ approver: answer(carlos), forbidSelfApproval: true }).g)).toMatchObject({ run: false, reason: expect.stringContaining('cannot approve it') });
    });

    it('roles are checked against the directory, and no directory means refused', async () => {
        const needsFinance: ToolPolicy = { decide: () => ({ effect: 'ask', reason: 'r', accepts: ['human'], approverRoles: ['finance'] }) };
        const directory = { describe: (by: { id: string }) => (by.id === 'ana' ? { roles: ['finance'] } : undefined) };
        expect(await decide(gate({ policies: [needsFinance], approver: answer(ana), approverDirectory: directory }).g)).toMatchObject({ run: true });
        expect(await decide(gate({ policies: [needsFinance], approver: answer(ana) }).g)).toMatchObject({ run: false });
    });

    it('a stored approval whose request expired is not run', async () => {
        const { g } = gate();
        const past = new Date(Date.now() - 1000).toISOString();
        const v = await g.decide(tool, '{"amount":5}', principal, [], { by: ana, approvalId: 'a1', expiresAt: past });
        expect(v).toMatchObject({ run: false, reason: expect.stringContaining('expired') });
    });
});

describe('GovernanceGate credentials', () => {
    const needs = { ...tool, credentials: ['treasury'] } as ToolDefinition;

    it('no broker is a refusal, not a run without the credential', async () => {
        const out = await gate().g.leaseCredentials(needs, '{}', principal);
        expect(out).toMatchObject({ problem: expect.stringContaining('no credential broker') });
    });

    it('leases each credential and releases them all, recording what was released', async () => {
        const released: string[] = [];
        const broker = { lease: async (r: { name: string }) => ({ value: `v-${r.name}`, id: `id-${r.name}`, release: async () => { released.push(r.name); } }) };
        const { g } = gate({ credentialBroker: broker as never });
        const held = await g.leaseCredentials({ ...needs, credentials: ['a', 'b'] } as ToolDefinition, '{}', principal);
        if ('problem' in held) throw new Error(held.problem);
        expect(held.values).toEqual({ a: 'v-a', b: 'v-b' });
        const audit = await g.releaseCredentials(held);
        expect(released).toEqual(['a', 'b']);
        expect(audit.every(c => c.released)).toBe(true);
    });

    it('an unusable lease (no value) is refused and nothing stays leased', async () => {
        const released: string[] = [];
        let n = 0;
        const broker = { lease: async () => (++n === 1 ? { value: 'ok', id: '1', release: async () => { released.push('first'); } } : { value: '', id: '2' }) };
        const { g } = gate({ credentialBroker: broker as never });
        const out = await g.leaseCredentials({ ...needs, credentials: ['a', 'b'] } as ToolDefinition, '{}', principal);
        expect(out).toMatchObject({ problem: expect.stringContaining('unusable lease') });
        expect(released).toEqual(['first']);
    });
});
