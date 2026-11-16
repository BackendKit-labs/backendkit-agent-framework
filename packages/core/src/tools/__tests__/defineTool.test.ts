import { defineTool, z, validateToolDefinition, getToolInputSchema, ToolDefinitionError, ToolArgumentError } from '../defineTool';
import type { ToolDefinition } from '../../types';

const echoTool = defineTool({
    name: 'echo',
    description: 'Echoes its input',
    input: z.object({
        message: z.string(),
        count:   z.number().int().min(1).default(1),
    }),
    execute: async ({ message, count }) => message.repeat(count),
});

const mockCtx = {
    agentId: 'test',
    sessionId: 'test-session',
    memory: { get: () => undefined, set: () => undefined, getAll: () => ({}) },
    askAgent: async () => '',
};

describe('defineTool', () => {
    it('returns a ToolDefinition with the correct name and description', () => {
        expect(echoTool.name).toBe('echo');
        expect(echoTool.description).toBe('Echoes its input');
    });

    it('generates an object JSON Schema', () => {
        expect(echoTool.parameters.type).toBe('object');
        const props = echoTool.parameters.properties as Record<string, unknown>;
        expect(props).toHaveProperty('message');
        expect(props).toHaveProperty('count');
    });

    it('executes with valid args', async () => {
        const result = await echoTool.execute({ message: 'hi', count: 3 }, mockCtx);
        expect(result).toBe('hihihi');
    });

    it('applies Zod defaults', async () => {
        const result = await echoTool.execute({ message: 'hello' }, mockCtx);
        expect(result).toBe('hello');
    });

    it('throws a ToolArgumentError with a code on invalid args', async () => {
        const err = await echoTool.execute({ message: 123 }, mockCtx).catch((e: unknown) => e) as ToolArgumentError;
        expect(err).toBeInstanceOf(ToolArgumentError);
        expect(err.code).toBe('INVALID_ARGUMENTS');
        expect(err.message).toMatch(/Invalid arguments for tool "echo"/);
        expect(err.message).toMatch(/message/);
    });

    it('validates numeric constraints', async () => {
        await expect(echoTool.execute({ message: 'x', count: 0 }, mockCtx)).rejects.toThrow(/Invalid arguments/);
    });

    it('z export is Zod', () => {
        const schema = z.string();
        expect(schema.parse('hello')).toBe('hello');
    });
});

describe('defineTool metadata', () => {
    it('leaves the new fields absent when not declared (existing tools unchanged)', () => {
        expect(echoTool).not.toHaveProperty('readOnly');
        expect(echoTool).not.toHaveProperty('destructive');
        expect(echoTool).not.toHaveProperty('meta');
        expect(echoTool).not.toHaveProperty('title');
        expect(echoTool).not.toHaveProperty('concurrencySafe');
    });

    it('copies declared facts and makes readOnly imply concurrencySafe', () => {
        const tool = defineTool({
            name: 'balances',
            title: 'Balances at date',
            description: 'Read balances',
            readOnly: true,
            idempotent: true,
            openWorld: false,
            meta: { autonomyLevel: 0, erpOperation: 'query' },
            input: z.object({ date: z.string() }),
            execute: async () => '{}',
        });
        expect(tool).toMatchObject({
            title: 'Balances at date',
            readOnly: true,
            concurrencySafe: true,
            idempotent: true,
            openWorld: false,
            meta: { autonomyLevel: 0, erpOperation: 'query' },
        });
    });

    it('keeps the Zod schema reachable for the MCP tool server', () => {
        const schema = getToolInputSchema(echoTool);
        expect(schema).toBeDefined();
        expect(schema!.safeParse({ message: 'x' }).success).toBe(true);
        expect(getToolInputSchema({ name: 'raw', description: '', parameters: {}, execute: async () => '' })).toBeUndefined();
    });

    it('rejects readOnly + destructive at definition time', () => {
        expect(() => defineTool({
            name: 'bad',
            description: '',
            readOnly: true,
            destructive: true,
            input: z.object({}),
            execute: async () => '',
        })).toThrow(ToolDefinitionError);
    });

    it('rejects destructive + concurrencySafe', () => {
        expect(() => defineTool({
            name: 'pay',
            description: '',
            destructive: true,
            concurrencySafe: true,
            input: z.object({}),
            execute: async () => '',
        })).toThrow(/cannot be concurrencySafe/);
    });
});

describe('validateToolDefinition', () => {
    const base: ToolDefinition = { name: 't', description: '', parameters: { type: 'object', properties: {} }, execute: async () => '' };

    it('accepts a plain tool', () => {
        expect(() => validateToolDefinition(base)).not.toThrow();
    });

    it('rejects a non-object parameters schema', () => {
        expect(() => validateToolDefinition({ ...base, parameters: { type: 'string' } })).toThrow(/must describe an object/);
    });

    it('rejects a non-positive timeout', () => {
        expect(() => validateToolDefinition({ ...base, timeoutMs: 0 })).toThrow(/timeoutMs/);
        expect(() => validateToolDefinition({ ...base, timeoutMs: -5 })).toThrow(/timeoutMs/);
    });

    it('names the tool in the error', () => {
        try {
            validateToolDefinition({ ...base, name: 'wire', readOnly: true, destructive: true });
            fail('expected to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(ToolDefinitionError);
            expect((err as ToolDefinitionError).toolName).toBe('wire');
            expect((err as Error).message).toMatch(/^Tool "wire":/);
        }
    });
});
