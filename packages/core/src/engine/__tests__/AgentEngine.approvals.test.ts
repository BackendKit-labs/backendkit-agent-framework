import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createBaseEngine } from '../createBaseEngine';
import { FileApprovalStore } from '../../governance/approval-store';
import { MemoryAuditSink } from '../../governance/audit';
import { agentApprover } from '../../governance/approvers';
import type { ApprovalStore, Approver } from '../../governance/types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['write', 'erase'], delegatesTo: [] };
const supervisor: AgentProfile = { ...testAgent, id: 'supervisor', name: 'Supervisor', allowedTools: ['write', 'erase'], delegatesTo: [] };

function build(script: Turn[], opts: { approvals?: ApprovalStore; approver?: Approver }) {
    const ran: string[] = [];
    const audit = new MemoryAuditSink();
    const tools: ToolDefinition[] = [
        { name: 'write', description: '', parameters: { type: 'object' }, execute: async (a) => { ran.push(`write:${JSON.stringify(a)}`); return 'written'; } },
        { name: 'erase', description: '', parameters: { type: 'object' }, destructive: true, execute: async () => { ran.push('erase'); return 'erased'; } },
    ];
    const { transport } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock',
        agents: [main, supervisor], defaultAgent: 'main', tools,
        transport, workingDir: process.cwd(), iterationMode: 'auto', audit, ...opts,
    });
    return { engine, ran, audit };
}

const call = (name: string, args: Record<string, unknown> = {}): Turn => ({ tool_calls: [{ id: 'c', name, args }] });

describe('AgentEngine — durable approval, resubmission (SPEC-0014 F5)', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'engine-approvals-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('a pending call survives a restart and runs exactly once after approval', async () => {
        const first = build([call('write', { amount: 7 }), { content: 'asked for approval' }], { approvals: new FileApprovalStore(dir) });
        await first.engine.run('go');
        expect(first.ran).toEqual([]);
        const [pending] = await new FileApprovalStore(dir).list({ status: 'pending' });
        expect(pending).toBeDefined();

        // Someone approves later, from another process (here: another store instance).
        await new FileApprovalStore(dir).resolve(pending.id, { decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() });

        // A new engine (after a restart) runs the approved call once.
        const second = build([], { approvals: new FileApprovalStore(dir) });
        expect(await second.engine.runApproved(pending.id)).toBe('written');
        expect(second.ran).toEqual(['write:{"amount":7}']);
        expect(second.audit.events[0]).toMatchObject({ tool: 'write', decision: 'allow', outcome: 'ok', approval: { id: pending.id, by: { kind: 'human', id: 'ana' } } });

        await expect(second.engine.runApproved(pending.id)).rejects.toThrow(/already executed/);
        expect(second.ran).toHaveLength(1);
    });

    it('a rejected or still pending request does not run', async () => {
        const store = new FileApprovalStore(dir);
        const { engine, ran } = build([call('write'), { content: 'x' }, call('write'), { content: 'y' }], { approvals: store });
        await engine.run('one');
        await engine.run('two');
        const [a, b] = await store.list();
        await store.resolve(a.id, { decision: 'reject', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() });
        await expect(engine.runApproved(a.id)).rejects.toThrow(/rejected, not approved/);
        await expect(engine.runApproved(b.id)).rejects.toThrow(/pending, not approved/);
        expect(ran).toEqual([]);
    });

    it('a stored approval from an agent does not cover a destructive call: consumed and audited as deny', async () => {
        const store = new FileApprovalStore(dir);
        const { engine, ran, audit } = build([call('erase'), { content: 'x' }], { approvals: store });
        await engine.run('go');
        const [pending] = await store.list();
        await store.resolve(pending.id, { decision: 'approve', by: { kind: 'agent', id: 'supervisor' }, at: new Date().toISOString() });
        const result = await engine.runApproved(pending.id);
        expect(result).toMatch(/invalid approval: this action needs approval by human/);
        expect(ran).toEqual([]);
        expect(audit.events.at(-1)).toMatchObject({ tool: 'erase', decision: 'deny' });
        expect((await store.get(pending.id))!.status).toBe('executed');
    });
});

describe('AgentEngine — a supervising agent as approver', () => {
    it('approves a normal call, cannot approve a destructive one', async () => {
        let engineRef: ReturnType<typeof createBaseEngine> | undefined;
        const approver = agentApprover((id, q) => engineRef!.consultAgent(id, q), 'supervisor');
        const { engine, ran, audit } = build([
            call('write', { a: 1 }),
            { content: 'APPROVE: it only writes a draft' },   // supervisor's answer
            call('erase'),
            { content: 'done' },
        ], { approver });
        engineRef = engine;
        await engine.run('go');
        expect(ran).toEqual(['write:{"a":1}']);
        expect(audit.events.find(e => e.tool === 'write')).toMatchObject({ decision: 'allow', approval: { by: { kind: 'agent', id: 'supervisor' } } });
        // erase is destructive: the default policy accepts only a person, so the agent is never even asked to count.
        expect(audit.events.find(e => e.tool === 'erase')).toMatchObject({ decision: 'deny' });
    });
});
