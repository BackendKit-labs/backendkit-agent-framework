#!/usr/bin/env node
import { runMcpServer, parseCliArgs } from '../shared/server-runner.js';
import { buildServer } from './tools.js';

const missing = [!process.env.JIRA_HOST && 'JIRA_HOST', !process.env.JIRA_EMAIL && 'JIRA_EMAIL', !process.env.JIRA_TOKEN && 'JIRA_TOKEN'].filter(Boolean);
if (missing.length) {
    process.stderr.write(`[bk-mcp-jira] Missing env vars: ${missing.join(', ')}\n`);
    process.exit(1);
}

// ── Start ─────────────────────────────────────────────────────────────────────

const { httpMode, port } = parseCliArgs();
runMcpServer(buildServer, { httpMode, port, label: 'bk-mcp-jira' }).catch(err => {
    process.stderr.write(`[bk-mcp-jira] Fatal: ${(err as Error).message}\n`);
    process.exit(1);
});
