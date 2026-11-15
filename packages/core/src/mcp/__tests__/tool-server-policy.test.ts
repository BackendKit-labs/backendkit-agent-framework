import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { defineTool, z } from '../../tools/defineTool';
import { MemoryAuditSink } from '../../governance/audit';
import { hashArgs } from '../../shared/utils/canonical-json';
import type { Approver, ApproverRef, ToolPolicy } from '../../governance/types';
import type { ExecutionContext } from '../../types';
import { createToolServer, type ToolServerOptions } from '../tool-server';

const seen: ExecutionContext[] = [];
const balances = defineTool({
    name: 'balances', description: '', readOnly: true, input: z.object({ date: z.string() }),
    execute: async (_a, ctx) => { seen.push(ctx); return 'ok'; },
});
const pay = defineTool({
    name: 'pay', description: '', destructive: true, input: z.object({ amount: z.number() }),
    execute: async (_a, ctx) => { seen.push(ctx); return ctx.dryRun ? 'simulated' : 'paid'; },
});

async function connect(opts: ToolServerOptions) {
    const server = createToolServer(opts);
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const client = new Client({ name: 'c', version: '0' });
    await client.connect(c);
    return { client, close: async () => { await client.close(); await server.close(); } };
}
const textOf = (r: unknown) => ((r as { content?: Array<{ text?: string }> }).content ?? []).map(x => x.text ?? '').join('');
const approverAs = (by: ApproverRef, decision: 'approve' | 'reject' = 'approve'): Approver => ({ ref: by, request: async () => ({ decision, by, at: new Date().toISOString() }) });

beforeEach(() => { seen.length = 0; });

describe('createToolServer — SPEC-0014 contracts (F4)', () => {
    it('a destructive tool may be gated by a policy instead of authorize', () => {
        expect(() => createToolServer({ name: 's', tools: [pay] })).toThrow(/no authorize hook or policy/);
        expect(() => createToolServer({ name: 's', tools: [pay], policy: { decide: () => ({ effect: 'allow' }) } })).not.toThrow();
    });

    it('policy deny refuses, and auditSink gets the engine AuditEvent with the principal and a hash', async () => {
        const sink = new MemoryAuditSink();
        const policy: ToolPolicy = { decide: (p, c) => c.tool.name === 'pay' ? { effect: 'deny', reason: `no payments for ${p.tenantId}` } : { effect: 'allow' } };
        const { client, close } = await connect({ name: 'treasury', tools: [balances, pay], policy, identity: { tenantId: 'acme' }, auditSink: sink });
        try {
            const denied = await client.callTool({ name: 'pay', arguments: { amount: 5 } });
            expect(denied.isError).toBe(true);
            expect(textOf(denied)).toContain('no payments for acme');
            expect(textOf(await client.callTool({ name: 'balances', arguments: { date: 'd' } }))).toBe('ok');
        } finally {
            await close();
        }
        expect(sink.events.map(e => [e.tool, e.decision, e.outcome, e.reason])).toEqual([
            ['pay', 'deny', undefined, 'no payments for acme'],
            ['balances', 'allow', 'ok', undefined],
        ]);
        expect(sink.events[0].principal).toEqual({ agentId: 'treasury', sessionId: 'mcp', chain: ['treasury'], tenantId: 'acme' });
        expect(sink.events[1].argsHash).toBe(hashArgs({ date: 'd' }));
        expect(seen[0].principal).toMatchObject({ agentId: 'treasury', tenantId: 'acme' });
    });

    it('ask goes to the approver; a person may approve a destructive call, an agent may not', async () => {
        const policy: ToolPolicy = { decide: (_p, c) => c.tool.destructive ? { effect: 'ask', reason: 'payment', accepts: ['human'] } : { effect: 'allow' } };

        const human = new MemoryAuditSink();
        const ok = await connect({ name: 't', tools: [pay], policy, approver: approverAs({ kind: 'human', id: 'ana' }), auditSink: human });
        try {
            expect(textOf(await ok.client.callTool({ name: 'pay', arguments: { amount: 1 } }))).toBe('paid');
        } finally { await ok.close(); }
        expect(human.events[0]).toMatchObject({ decision: 'allow', outcome: 'ok', approval: { by: { kind: 'human', id: 'ana' } } });

        const agent = new MemoryAuditSink();
        const no = await connect({ name: 't', tools: [pay], policy, approver: approverAs({ kind: 'agent', id: 'bot' }), auditSink: agent });
        try {
            const r = await no.client.callTool({ name: 'pay', arguments: { amount: 1 } });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toMatch(/invalid approval: this action needs approval by human/);
        } finally { await no.close(); }
        expect(agent.events[0]).toMatchObject({ decision: 'deny' });
    });

    it('ask without an approver is refused', async () => {
        const { client, close } = await connect({ name: 't', tools: [balances], policy: { decide: () => ({ effect: 'ask', reason: 'four eyes' }) } });
        try {
            const r = await client.callTool({ name: 'balances', arguments: { date: 'd' } });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain('needs approval (four eyes) and no approver is configured');
            expect(seen).toEqual([]);
        } finally { await close(); }
    });

    it('allow with dry_run runs the tool with ctx.dryRun; sandboxed without a sandbox is refused', async () => {
        const dry = await connect({ name: 't', tools: [pay], policy: { decide: () => ({ effect: 'allow', mode: 'dry_run' }) } });
        try {
            expect(textOf(await dry.client.callTool({ name: 'pay', arguments: { amount: 1 } }))).toBe('simulated');
        } finally { await dry.close(); }

        const boxed = await connect({ name: 't', tools: [pay], policy: { decide: () => ({ effect: 'allow', mode: 'sandboxed' }) } });
        try {
            const r = await boxed.client.callTool({ name: 'pay', arguments: { amount: 1 } });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain('requires a sandbox');
        } finally { await boxed.close(); }
    });

    it('authorize still runs first, and the legacy audit hook keeps its format', async () => {
        const records: Array<{ outcome: string }> = [];
        const { client, close } = await connect({
            name: 't', tools: [balances], authorize: () => false, policy: { decide: () => ({ effect: 'allow' }) },
            audit: r => { records.push(r); },
        });
        try {
            expect((await client.callTool({ name: 'balances', arguments: { date: 'd' } })).isError).toBe(true);
        } finally { await close(); }
        expect(records).toEqual([expect.objectContaining({ outcome: 'denied', server: 't', tool: 'balances' })]);
    });
});
