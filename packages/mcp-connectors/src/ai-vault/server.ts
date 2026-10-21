#!/usr/bin/env node
import { runMcpServer, parseCliArgs } from '../shared/server-runner.js';
import { buildServer } from './tools.js';

// ── Entry point ───────────────────────────────────────────────────────────────

const { httpMode, port } = parseCliArgs();
runMcpServer(buildServer, { httpMode, port, label: 'ai-vault' });
