#!/usr/bin/env node
import { runMcpServer, parseCliArgs } from '../shared/server-runner.js';
import { buildServer } from './tools.js';

if (!process.env.HUBSPOT_TOKEN) {
    process.stderr.write('[bk-mcp-hubspot] HUBSPOT_TOKEN env var is required (HubSpot Private App token).\n');
    process.exit(1);
}

// ── Start ─────────────────────────────────────────────────────────────────────

const { httpMode, port } = parseCliArgs();
runMcpServer(buildServer, { httpMode, port, label: 'bk-mcp-hubspot' }).catch(err => {
    process.stderr.write(`[bk-mcp-hubspot] Fatal: ${(err as Error).message}\n`);
    process.exit(1);
});
