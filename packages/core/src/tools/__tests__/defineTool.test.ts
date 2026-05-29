import { defineTool, z } from '../defineTool';

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

    it('returns an error string (not throws) on invalid args', async () => {
        const result = await echoTool.execute({ message: 123 }, mockCtx);
        expect(result).toMatch(/Error: Invalid arguments/);
        expect(result).toMatch(/message/);
    });

    it('validates numeric constraints', async () => {
        const result = await echoTool.execute({ message: 'x', count: 0 }, mockCtx);
        expect(result).toMatch(/Error: Invalid arguments/);
    });

    it('z export is Zod', () => {
        const schema = z.string();
        expect(schema.parse('hello')).toBe('hello');
    });
});
