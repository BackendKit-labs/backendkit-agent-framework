#!/usr/bin/env node
import { runMcpServer, parseCliArgs } from '../shared/server-runner.js';
import { buildServer } from './tools.js';

// ── Start ─────────────────────────────────────────────────────────────────────

const { httpMode, port } = parseCliArgs();
runMcpServer(buildServer, { httpMode, port, label: 'bk-mcp-odoo' }).catch(err => {
    process.stderr.write(`[bk-mcp-odoo] Fatal: ${(err as Error).message}\n`);
    process.exit(1);
});
