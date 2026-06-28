#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WorkspaceManager } from './WorkspaceManager.js';
import { registerTools } from './tools/index.js';

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'workspace-manager-project',
  version: '1.0.0',
});

// ── Workspace Manager instance ────────────────────────────────────────────────

const wm = new WorkspaceManager();

// ── Register all tools ────────────────────────────────────────────────────────

registerTools(server, wm);

// ── Transport: stdio ──────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

// To use this server, add it to your MCP client config:
// {
//   "mcpServers": {
//     "workspace-manager-project": {
//       "command": "node",
//       "args": ["path/to/workspace-manager-project/dist/server.js"]
//     }
//   }
// }
