import { MCPClientManager, MCP_TOOL_ERROR } from '../MCPClientManager';
import { ToolError } from '../../tools/tool-error';
import { createBaseEngine } from '../../engine/createBaseEngine';
import { createToolContext } from '../../tools/createToolContext';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

// What the fake MCP server answers to the next call.
const answer: { value: { content: Array<{ type: string; text?: string }>; isError?: boolean } } = { value: { content: [] } };

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: class {
        onclose?: () => void;
        async connect() { return undefined; }
        async listTools() { return { tools: [{ name: 'get_weather', description: 'weather', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } }] }; }
        async callTool() { return answer.value; }
        async close() { return undefined; }
    },
}));
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: class { async close() { return undefined; } } }));
jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: class { async close() { return undefined; } } }));
jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class { async close() { return undefined; } } }));

async function weatherTool() {
    const mcp = new MCPClientManager([{ name: 'weather', transport: 'stdio', command: 'unused' } as never]);
    await mcp.initialize();
    return { mcp, tool: mcp.getTools().find(t => t.name === 'mcp__weather__get_weather')! };
}

describe('a tool of an MCP server whose answer is isError: true fails (it used to come back as text, as a success)', () => {
    it('a normal answer is returned as its text', async () => {
        answer.value = { content: [{ type: 'text', text: 'sunny' }, { type: 'text', text: '22 C' }] };
        const { mcp, tool } = await weatherTool();
        expect(await tool.execute({ city: 'London' }, createToolContext())).toBe('sunny\n22 C');
        await mcp.disconnect();
    });

    it('isError: true throws a ToolError with the code MCP_TOOL_ERROR and the text of the server', async () => {
        answer.value = { content: [{ type: 'text', text: 'MCP error -32602: Input validation error: expected string' }], isError: true };
        const { mcp, tool } = await weatherTool();
        const err = await tool.execute({ city: 42 }, createToolContext()).catch(e => e as ToolError);
        expect(err).toBeInstanceOf(ToolError);
        expect((err as ToolError).code).toBe(MCP_TOOL_ERROR);
        expect((err as ToolError).message).toContain('Input validation error');
        await mcp.disconnect();
    });

    it('an error with no text still fails, with the content as the message', async () => {
        answer.value = { content: [{ type: 'image' }], isError: true };
        const { mcp, tool } = await weatherTool();
        await expect(tool.execute({}, createToolContext())).rejects.toMatchObject({ code: MCP_TOOL_ERROR, message: expect.stringContaining('image') });
        await mcp.disconnect();
    });

    it('in an engine it is a failed call with its code, and the model reads the server\'s text', async () => {
        answer.value = { content: [{ type: 'text', text: 'the period is closed' }], isError: true };
        const { mcp } = await weatherTool();
        const { transport, events } = createMockTransport();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: createScriptedProvider([{ tool_calls: [{ id: 'c1', name: 'mcp__weather__get_weather', args: { city: 'London' } }] }, { content: 'done' }]) },
            defaultProvider: 'mock', agents: [{ ...testAgent, id: 'a', allowedTools: ['mcp__weather__get_weather'], delegatesTo: [] }], defaultAgent: 'a',
            tools: mcp.getTools().map(t => ({ ...t, readOnly: true })), transport, workingDir: process.cwd(), iterationMode: 'auto',
        });
        const r = await engine.run('x');
        expect(r.toolCalls.map(t => [t.name, t.success, t.errorCode])).toEqual([['mcp__weather__get_weather', false, MCP_TOOL_ERROR]]);
        expect(events.filter(e => e.type === 'tool_result').map(e => (e as { preview?: string }).preview).join('')).toContain('the period is closed');
        await mcp.disconnect();
    });
});
