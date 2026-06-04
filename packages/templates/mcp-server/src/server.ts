#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { exampleHandler, exampleInputSchema } from './tools/example';

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
    name: 'my-mcp-server',
    version: '0.1.0',
});

// ── Register tools ────────────────────────────────────────────────────────────

// @ts-expect-error: MCP SDK + zod generic depth limit, safe at runtime
server.tool(
    'example_query',
    'TODO: describe what this tool does',
    exampleInputSchema.shape,
    async (args: z.infer<typeof exampleInputSchema>) => ({
        content: [{ type: 'text' as const, text: await exampleHandler(args) }],
    }),
);

// TODO: register more tools following the same pattern:
// server.tool('tool_name', 'description', schema.shape, handler)

// ── Transport: stdio (for Claude Desktop / Cursor / VS Code) ─────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

// To use this server, add it to your MCP client config:
// {
//   "mcpServers": {
//     "my-server": { "command": "npx", "args": ["my-mcp-server"] }
//   }
// }
