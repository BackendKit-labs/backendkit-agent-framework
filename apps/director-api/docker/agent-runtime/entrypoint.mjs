#!/usr/bin/env node
/**
 * agent-runtime — reference agent image for agent-cloud.
 *
 * Implements the "agent image" contract (see .specs/design-phase2-agent-images.md):
 *   - reads identity from env: AGENT_ID, AGENT_TYPE, MODEL
 *   - long-lived: heartbeat loop keeps the container running
 *   - exposes GET /health on AGENT_PORT (default 8080)
 *   - handles SIGTERM for a clean stop
 *
 * Real agents (director, codex-context, bk-coder…) can follow the same contract.
 */
import http from 'node:http';

const AGENT_ID = process.env.AGENT_ID ?? 'unknown';
const AGENT_TYPE = process.env.AGENT_TYPE ?? 'generic';
const MODEL = process.env.MODEL ?? null;
const PORT = Number(process.env.AGENT_PORT ?? 8080);
const startedAt = Date.now();

const log = (msg) => console.log(`[agent-runtime] ${msg}`);

log(`starting · id=${AGENT_ID} · type=${AGENT_TYPE} · model=${MODEL ?? 'n/a'}`);

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'healthy',
        agentId: AGENT_ID,
        type: AGENT_TYPE,
        model: MODEL,
        uptime: Math.round((Date.now() - startedAt) / 1000),
      }),
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => log(`health endpoint on :${PORT}/health`));

const heartbeat = setInterval(() => {
  log(`heartbeat · uptime=${Math.round((Date.now() - startedAt) / 1000)}s`);
}, 30_000);

function shutdown(signal) {
  log(`received ${signal}, shutting down`);
  clearInterval(heartbeat);
  server.close(() => process.exit(0));
  // Failsafe if connections hang.
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
