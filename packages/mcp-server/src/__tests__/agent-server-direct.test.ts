import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { defineTool, z, MemoryAuditSink, type ToolCallRecord } from '@backendkit-labs/agent-core';
import { AgentMCPServer } from '../agent-server';

const balances = defineTool({
    name: 'balances',
    description: 'Balances at a date',
    readOnly: true,
    meta: { autonomyLevel: 0 },
    input: z.object({ date: z.string() }),
    execute: async ({ date }) => JSON.stringify({ ok: true, date }),
});

const pay = defineTool({
    name: 'pay',
    description: 'Pay',
    destructive: true,
    input: z.object({ invoiceId: z.string() }),
    execute: async ({ invoiceId }) => `paid ${invoiceId}`,
});

const explain = {
    name: 'explain',
    description: 'Explain something',
    schema: { topic: z.string() },
    buildPrompt: ({ topic }: { topic: string }) => `Explain ${topic}`,
};

const throwingFactory = () => { throw new Error('engine must not be used for direct tools'); };

async function connect(srv: AgentMCPServer): Promise<Client> {
    await srv.start();
    const port = ((srv as any).httpServer.address() as { port: number }).port;
    const client = new Client({ name: 'c', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    return client;
}

const textOf = (r: unknown) =>
    ((r as { content?: Array<{ text?: string }> }).content ?? []).map(c => c.text ?? '').join('');

describe('AgentMCPServer: construction', () => {
    it('accepts a server with only direct tools and no engineFactory', () => {
        expect(() => new AgentMCPServer({ name: 's', directTools: [balances] })).not.toThrow();
    });

    it('still requires engineFactory for prompt tools', () => {
        expect(() => new AgentMCPServer({ name: 's', tools: [explain] })).toThrow(/prompt tools need an engineFactory/);
    });

    it('refuses a name declared in both lists', () => {
        const clash = defineTool({ name: 'explain', description: '', input: z.object({}), execute: async () => '' });
        expect(() => new AgentMCPServer({ name: 's', tools: [explain], directTools: [clash], engineFactory: throwingFactory as never }))
            .toThrow(/both as a prompt tool and as a direct tool/);
    });

    it('refuses a destructive direct tool without authorize, in the constructor', () => {
        expect(() => new AgentMCPServer({ name: 's', directTools: [pay] })).toThrow(/destructive and no authorize hook/);
        expect(() => new AgentMCPServer({ name: 's', directTools: [pay], authorize: () => true })).not.toThrow();
    });

    it('accepts a policy as the gate of a destructive direct tool (SPEC-0014 contract)', () => {
        expect(() => new AgentMCPServer({ name: 's', directTools: [pay], policy: { decide: () => ({ effect: 'allow' }) } })).not.toThrow();
    });
});

describe('AgentMCPServer: direct tools under a policy, audited with the engine event', () => {
    it('a policy deny refuses the call and the audit sink records it with the identity', async () => {
        const sink = new MemoryAuditSink();
        const srv = new AgentMCPServer({
            name: 'gov', port: 0, directTools: [balances, pay], identity: { tenantId: 'acme' }, auditSink: sink,
            policy: { decide: (_p, c) => c.tool.name === 'pay' ? { effect: 'deny', reason: 'frozen' } : { effect: 'allow' } },
        });
        const client = await connect(srv);
        try {
            const denied = await client.callTool({ name: 'pay', arguments: { invoiceId: 'F-1' } });
            expect(denied.isError).toBe(true);
            expect(textOf(denied)).toContain('frozen');
            await client.callTool({ name: 'balances', arguments: { date: 'd' } });
        } finally {
            await client.close();
            await srv.stop();
        }
        expect(sink.events.map(e => [e.tool, e.decision])).toEqual([['pay', 'deny'], ['balances', 'allow']]);
        expect(sink.events[0].principal).toMatchObject({ agentId: 'gov', tenantId: 'acme' });
    });
});

describe('AgentMCPServer: prompt and direct tools together', () => {
    let srv: AgentMCPServer;
    let client: Client;
    const records: ToolCallRecord[] = [];

    beforeAll(async () => {
        srv = new AgentMCPServer({
            name: 'mixed',
            port: 0,
            tools: [explain],
            engineFactory: throwingFactory as never,
            directTools: [balances, pay],
            authorize: ({ tool, args }) => !tool.destructive || args.invoiceId === 'OK-1',
            audit: r => { records.push(r); },
        });
        client = await connect(srv);
    });

    afterAll(async () => {
        await client.close();
        await srv.stop();
    });

    it('lists both kinds, direct ones with annotations and _meta', async () => {
        const { tools } = await client.listTools();
        const byName = Object.fromEntries(tools.map(t => [t.name, t]));
        expect(Object.keys(byName).sort()).toEqual(['balances', 'explain', 'pay']);
        expect(byName.balances.annotations).toEqual({ readOnlyHint: true });
        expect(byName.balances._meta).toEqual({ autonomyLevel: 0 });
        expect(byName.pay.annotations).toEqual({ destructiveHint: true });
        expect(byName.explain.annotations).toBeUndefined();
    });

    it('runs a direct tool without touching the engine', async () => {
        const result = await client.callTool({ name: 'balances', arguments: { date: '2026-10-31' } });
        expect(result.isError).toBeFalsy();
        expect(JSON.parse(textOf(result))).toEqual({ ok: true, date: '2026-10-31' });
    });

    it('applies authorize and passes the real MCP session id to audit', async () => {
        const denied = await client.callTool({ name: 'pay', arguments: { invoiceId: 'NO' } });
        expect(denied.isError).toBe(true);
        const allowed = await client.callTool({ name: 'pay', arguments: { invoiceId: 'OK-1' } });
        expect(textOf(allowed)).toBe('paid OK-1');

        const payRecords = records.filter(r => r.tool === 'pay');
        expect(payRecords.map(r => r.outcome)).toEqual(['denied', 'ok']);
        expect(payRecords[0].sessionId).toBeDefined();
        expect(payRecords[0].sessionId).toBe(client.transport && (client.transport as StreamableHTTPClientTransport).sessionId);
        expect(payRecords[0].server).toBe('mixed');
    });
});
