import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { defineTool, z } from '../../tools/defineTool';
import type { ToolDefinition } from '../../types';
import { createToolServer, hashArgs, type ToolCallRecord, type ToolServerOptions } from '../tool-server';

const balances = defineTool({
    name: 'balances',
    title: 'Balances',
    description: 'Balances at a date',
    readOnly: true,
    meta: { autonomyLevel: 0 },
    input: z.object({ date: z.string(), accounts: z.array(z.string()).default([]) }),
    execute: async ({ date, accounts }) => JSON.stringify({ ok: true, date, accounts }),
});

const pay = defineTool({
    name: 'pay',
    description: 'Pay an invoice',
    destructive: true,
    input: z.object({ invoiceId: z.string(), approval: z.string().optional() }),
    execute: async ({ invoiceId }) => JSON.stringify({ ok: true, paid: invoiceId }),
});

const boom = defineTool({
    name: 'boom',
    description: 'Throws',
    input: z.object({}),
    execute: async () => { throw new Error('ERP down'); },
});

const slow = defineTool({
    name: 'slow',
    description: 'Waits until aborted',
    timeoutMs: 50,
    input: z.object({}),
    execute: (_args, ctx) => new Promise<string>((resolve, reject) => {
        ctx.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        setTimeout(() => resolve('late'), 5_000).unref();
    }),
});

const big = defineTool({
    name: 'big',
    description: 'Returns a lot',
    input: z.object({ chars: z.number().int() }),
    execute: async ({ chars }) => 'x'.repeat(chars),
});

const rawTool: ToolDefinition = {
    name: 'raw',
    description: 'Hand-written, JSON Schema only',
    parameters: {
        type: 'object',
        properties: { n: { type: 'integer', minimum: 1 }, tag: { type: 'string', nullable: true } },
        required: ['n'],
    },
    execute: async (args) => `n=${(args as { n: number }).n}`,
};

async function connect(opts: ToolServerOptions): Promise<{ client: Client; close: () => Promise<void> }> {
    const server = createToolServer({ requireAgentIdentity: false, ...opts });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    return { client, close: async () => { await client.close(); await server.close(); } };
}

const textOf = (result: unknown): string =>
    ((result as { content?: Array<{ type: string; text?: string }> }).content ?? []).map(c => c.text ?? '').join('');

describe('createToolServer: registration', () => {
    it('lists tools with their JSON Schema, annotations and _meta', async () => {
        const { client, close } = await connect({ name: 'ledger', tools: [balances, rawTool] });
        try {
            const { tools } = await client.listTools();
            const listed = Object.fromEntries(tools.map(t => [t.name, t]));

            expect(listed.balances.title).toBe('Balances');
            expect(listed.balances.annotations).toEqual({ readOnlyHint: true });
            expect(listed.balances._meta).toEqual({ autonomyLevel: 0 });
            // Same shape the engine sends to the LLM: properties and required agree.
            const schema = listed.balances.inputSchema as { properties: Record<string, unknown>; required?: string[] };
            expect(Object.keys(schema.properties).sort()).toEqual(['accounts', 'date']);
            expect(schema.required).toEqual(['date']);

            expect(listed.raw.annotations).toBeUndefined();
            const raw = listed.raw.inputSchema as { properties: Record<string, unknown>; required?: string[] };
            expect(Object.keys(raw.properties).sort()).toEqual(['n', 'tag']);
            expect(raw.required).toEqual(['n']);
        } finally {
            await close();
        }
    });

    it('refuses duplicate names', () => {
        expect(() => createToolServer({ name: 's', tools: [balances, balances] })).toThrow(/duplicate tool name "balances"/);
    });

    it('refuses a destructive tool without an authorize hook', () => {
        expect(() => createToolServer({ name: 's', tools: [pay] })).toThrow(/"pay" is destructive and no authorize hook/);
        expect(() => createToolServer({ name: 's', tools: [pay], authorize: () => true })).not.toThrow();
    });

    it('refuses inconsistent declared facts', () => {
        const bad: ToolDefinition = { ...rawTool, name: 'bad', readOnly: true, destructive: true };
        expect(() => createToolServer({ name: 's', tools: [bad], authorize: () => true })).toThrow(/cannot be both readOnly and destructive/);
    });

    it('fails loudly on a JSON Schema it cannot express', () => {
        const weird: ToolDefinition = {
            ...rawTool,
            name: 'weird',
            parameters: { type: 'object', if: { properties: { a: { const: 1 } } }, then: { required: ['b'] } },
        };
        expect(() => createToolServer({ name: 's', tools: [weird] })).toThrow(/cannot derive an input schema for tool "weird"/);
    });
});

describe('createToolServer: calls', () => {
    it('runs a defineTool tool with validated, defaulted args and returns its text as payload', async () => {
        const { client, close } = await connect({ name: 'ledger', tools: [balances] });
        try {
            const result = await client.callTool({ name: 'balances', arguments: { date: '2026-10-31' } });
            expect(result.isError).toBeFalsy();
            expect(JSON.parse(textOf(result))).toEqual({ ok: true, date: '2026-10-31', accounts: [] });
        } finally {
            await close();
        }
    });

    it('rejects invalid arguments at the protocol level, before execute runs', async () => {
        const { client, close } = await connect({ name: 'ledger', tools: [balances] });
        try {
            // The SDK answers invalid arguments itself: isError with the -32602 message; execute never runs.
            const result = await client.callTool({ name: 'balances', arguments: { date: 7 } });
            expect(result.isError).toBe(true);
            expect(textOf(result)).toMatch(/-32602.*Invalid arguments for tool balances/);
        } finally {
            await close();
        }
    });

    it('runs a hand-written tool, including nullable fields from the openapi dialect', async () => {
        const { client, close } = await connect({ name: 'ledger', tools: [rawTool] });
        try {
            expect(textOf(await client.callTool({ name: 'raw', arguments: { n: 3, tag: null } }))).toBe('n=3');
            const invalid = await client.callTool({ name: 'raw', arguments: { n: 0 } });
            expect(invalid.isError).toBe(true);
            expect(textOf(invalid)).toMatch(/-32602/);
        } finally {
            await close();
        }
    });

    it('a thrown error becomes isError with the message and no stack', async () => {
        const { client, close } = await connect({ name: 'ledger', tools: [boom] });
        try {
            const result = await client.callTool({ name: 'boom', arguments: {} });
            expect(result.isError).toBe(true);
            expect(textOf(result)).toBe('Tool "boom" failed: ERP down');
            expect(textOf(result)).not.toMatch(/at .*\.ts/);
        } finally {
            await close();
        }
    });

    it('a business failure the tool returns stays payload', async () => {
        const failing = defineTool({
            name: 'post',
            description: '',
            input: z.object({}),
            execute: async () => JSON.stringify({ ok: false, code: 'INVOICE_CANCELLED' }),
        });
        const { client, close } = await connect({ name: 'ledger', tools: [failing] });
        try {
            const result = await client.callTool({ name: 'post', arguments: {} });
            expect(result.isError).toBeFalsy();
            expect(JSON.parse(textOf(result)).code).toBe('INVOICE_CANCELLED');
        } finally {
            await close();
        }
    });

    it('authorize=false denies before the tool runs', async () => {
        let ran = false;
        const guarded = defineTool({
            name: 'pay',
            description: '',
            destructive: true,
            input: z.object({ invoiceId: z.string(), approval: z.string().optional() }),
            execute: async () => { ran = true; return 'paid'; },
        });
        const { client, close } = await connect({
            name: 'ledger',
            tools: [guarded],
            authorize: ({ tool, args }) => !tool.destructive || typeof args.approval === 'string',
        });
        try {
            const denied = await client.callTool({ name: 'pay', arguments: { invoiceId: 'F-1' } });
            expect(denied.isError).toBe(true);
            expect(textOf(denied)).toMatch(/denied/);
            expect(ran).toBe(false);

            const allowed = await client.callTool({ name: 'pay', arguments: { invoiceId: 'F-1', approval: 'A-9' } });
            expect(allowed.isError).toBeFalsy();
            expect(ran).toBe(true);
        } finally {
            await close();
        }
    });

    it('an authorize hook that throws also denies', async () => {
        const { client, close } = await connect({
            name: 'ledger',
            tools: [pay],
            authorize: () => { throw new Error('PDP unreachable'); },
        });
        try {
            const result = await client.callTool({ name: 'pay', arguments: { invoiceId: 'F-1' } });
            expect(result.isError).toBe(true);
            expect(textOf(result)).toMatch(/PDP unreachable/);
        } finally {
            await close();
        }
    });

    it('timeoutMs aborts the context signal and reports a timeout', async () => {
        const { client, close } = await connect({ name: 'ledger', tools: [slow] });
        try {
            const result = await client.callTool({ name: 'slow', arguments: {} });
            expect(result.isError).toBe(true);
            expect(textOf(result)).toBe('Tool "slow" timed out after 50ms');
        } finally {
            await close();
        }
    });

    it('caps the output size', async () => {
        const { client, close } = await connect({ name: 'ledger', tools: [big], maxOutputChars: 100 });
        try {
            expect(textOf(await client.callTool({ name: 'big', arguments: { chars: 100 } }))).toHaveLength(100);
            const result = await client.callTool({ name: 'big', arguments: { chars: 101 } });
            expect(result.isError).toBe(true);
            expect(textOf(result)).toMatch(/returned 101 characters; the limit is 100/);
        } finally {
            await close();
        }
    });

    it('gives every tool the context fields the server was configured with', async () => {
        const probe = defineTool({
            name: 'probe',
            description: '',
            input: z.object({}),
            execute: async (_a, ctx) => JSON.stringify({ agentId: ctx.agentId, sessionId: ctx.sessionId, workingDir: ctx.workingDir, hasSignal: ctx.signal !== undefined }),
        });
        const { client, close } = await connect({ name: 'ledger', tools: [probe], context: { workingDir: '/data' } });
        try {
            const out = JSON.parse(textOf(await client.callTool({ name: 'probe', arguments: {} })));
            expect(out).toEqual({ agentId: 'ledger', sessionId: 'mcp', workingDir: '/data', hasSignal: true });
        } finally {
            await close();
        }
    });
});

describe('createToolServer: audit', () => {
    it('records every call with a hash of the arguments, never the arguments', async () => {
        const records: ToolCallRecord[] = [];
        const { client, close } = await connect({
            name: 'ledger',
            tools: [balances, boom, pay],
            authorize: ({ tool }) => !tool.destructive,
            audit: r => { records.push(r); },
        });
        try {
            await client.callTool({ name: 'balances', arguments: { date: '2026-10-31' } });
            await client.callTool({ name: 'boom', arguments: {} });
            await client.callTool({ name: 'pay', arguments: { invoiceId: 'SECRET-1' } });
        } finally {
            await close();
        }

        expect(records.map(r => [r.tool, r.outcome])).toEqual([['balances', 'ok'], ['boom', 'error'], ['pay', 'denied']]);
        expect(records[0]).toMatchObject({ server: 'ledger', argsHash: hashArgs({ date: '2026-10-31', accounts: [] }) });
        expect(records[0].outputChars).toBeGreaterThan(0);
        expect(records[1].error).toBe('ERP down');
        expect(records[2].outputChars).toBe(0);
        expect(JSON.stringify(records)).not.toContain('SECRET-1');
        for (const r of records) {
            expect(r.durationMs).toBeGreaterThanOrEqual(0);
            expect(() => new Date(r.at).toISOString()).not.toThrow();
        }
    });

    it('a failing audit hook does not change the result', async () => {
        const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const { client, close } = await connect({
            name: 'ledger',
            tools: [balances],
            audit: () => { throw new Error('disk full'); },
        });
        try {
            const result = await client.callTool({ name: 'balances', arguments: { date: 'd' } });
            expect(result.isError).toBeFalsy();
            expect(stderr).toHaveBeenCalledWith(expect.stringContaining('audit hook failed for balances: disk full'));
        } finally {
            stderr.mockRestore();
            await close();
        }
    });
});

describe('hashArgs', () => {
    it('is independent of key order and nesting order', () => {
        expect(hashArgs({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(hashArgs({ b: { d: 'x', c: [1, 2] }, a: 1 }));
        expect(hashArgs({ a: 1 })).not.toBe(hashArgs({ a: 2 }));
    });
});
