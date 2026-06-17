#!/usr/bin/env node
/**
 * Studio Agent — MCP server wrapping the orchestrator-gateway HTTP API.
 *
 * The orchestrator-gateway (:3400) is the control plane bridge used by
 * agent-studio. This agent exposes its HTTP API as MCP tools so the
 * orchestrator can query runs, manage config, and control deployments.
 *
 * Env vars:
 *   GATEWAY_URL      Base URL of orchestrator-gateway (default: http://localhost:3400)
 *   GATEWAY_API_KEY  Bearer token if the gateway is secured (optional)
 */

import 'dotenv/config';
import { McpServer }            from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z }                    from 'zod';

const GATEWAY_URL = (process.env.GATEWAY_URL ?? 'http://localhost:3400').replace(/\/$/, '');
const API_KEY     = process.env.GATEWAY_API_KEY;

const log = (msg: string) => process.stderr.write(`[studio-agent] ${msg}\n`);

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function gw(
    method: string,
    path:   string,
    body?:  unknown,
    timeoutMs = 30_000,
): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

    const res = await fetch(`${GATEWAY_URL}${path}`, {
        method,
        headers,
        body:   body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { raw: text, status: res.status }; }
}

const ok  = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const err = (e: unknown)    => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error).message ?? String(e)}` }] });

// ── MCP Server ────────────────────────────────────────────────────────────────

const srv = new McpServer({ name: '@backendkit-labs/studio-agent', version: '0.1.0' });
// @ts-ignore
const t = srv.tool.bind(srv);

// ── Runs ──────────────────────────────────────────────────────────────────────

t('list_runs',
    'List all orchestration runs with their current status (running, waiting_gate, complete, failed).',
    {},
    async () => { try { return ok(await gw('GET', '/api/runs')); } catch (e) { return err(e); } });

t('start_flow',
    'Start a named flow asynchronously. Returns run_id immediately — poll with get_run_status.',
    { flow_id: z.string().describe('Flow ID to execute'),
      input:   z.record(z.unknown()).optional().describe('Input payload for the flow (e.g. {nombre: "Juan"})') },
    async ({ flow_id, input = {} }) => {
        try { return ok(await gw('POST', '/api/run', { flow_id, input })); } catch (e) { return err(e); }
    });

t('approve_gate',
    'Approve a paused gate so the flow resumes execution.',
    { run_id:   z.string().describe('Run ID returned by start_flow'),
      feedback: z.string().optional().describe('Optional notes from the approver') },
    async ({ run_id, feedback }) => {
        try { return ok(await gw('POST', '/api/approve', { run_id, feedback })); } catch (e) { return err(e); }
    });

t('reject_gate',
    'Reject a paused gate and cancel the flow run.',
    { run_id: z.string(), reason: z.string().optional() },
    async ({ run_id, reason }) => {
        try { return ok(await gw('POST', '/api/reject', { run_id, feedback: reason })); } catch (e) { return err(e); }
    });

t('retry_run',
    'Retry a flow run that is paused on a required-step failure.',
    { run_id:   z.string(),
      feedback: z.string().optional() },
    async ({ run_id, feedback }) => {
        try { return ok(await gw('POST', '/api/retry', { run_id, feedback })); } catch (e) { return err(e); }
    });

// ── Agents & config ───────────────────────────────────────────────────────────

t('list_agents',
    'List all registered agents with their health status and capabilities.',
    {},
    async () => { try { return ok(await gw('GET', '/api/agents')); } catch (e) { return err(e); } });

t('get_config',
    'Get the full orchestrator config: agents, flows, and runtime settings.',
    {},
    async () => { try { return ok(await gw('GET', '/api/config')); } catch (e) { return err(e); } });

t('save_agent_config',
    'Create or update an agent in the orchestrator config store.',
    { agent: z.record(z.unknown()).describe('Agent config object (id, description, transport, capability, etc.)') },
    async ({ agent }) => {
        try { return ok(await gw('POST', '/api/config/agents', agent)); } catch (e) { return err(e); }
    });

t('delete_agent_config',
    'Remove an agent from the orchestrator config store.',
    { id: z.string().describe('Agent ID to remove') },
    async ({ id }) => {
        try { return ok(await gw('DELETE', `/api/config/agents/${encodeURIComponent(id)}`)); } catch (e) { return err(e); }
    });

t('save_flow_config',
    'Create or update a flow in the orchestrator config store.',
    { flow: z.record(z.unknown()).describe('Flow config object (id, name, steps, etc.)') },
    async ({ flow }) => {
        try { return ok(await gw('POST', '/api/config/flows', flow)); } catch (e) { return err(e); }
    });

t('delete_flow_config',
    'Remove a flow from the orchestrator config store.',
    { id: z.string().describe('Flow ID to remove') },
    async ({ id }) => {
        try { return ok(await gw('DELETE', `/api/config/flows/${encodeURIComponent(id)}`)); } catch (e) { return err(e); }
    });

// ── Deploy ────────────────────────────────────────────────────────────────────

t('list_deployments',
    'List all agent containers currently managed by Docker/Kubernetes.',
    {},
    async () => { try { return ok(await gw('GET', '/api/deploy')); } catch (e) { return err(e); } });

t('deploy_agent',
    'Deploy an agent as a Docker/Kubernetes container and register it in the pool.',
    {
        id:          z.string().describe('Agent ID'),
        image:       z.string().describe('Docker image (e.g. backendkit/docker-agent:latest)'),
        description: z.string().optional(),
        capability:  z.string().optional().describe('Capability tag (e.g. docker, coding, knowledge)'),
        instances:   z.number().int().min(1).default(1).describe('Number of replicas'),
        env:         z.record(z.string()).optional().describe('Environment variables for the container'),
        mounts:      z.array(z.object({ host: z.string(), container: z.string() })).optional(),
        apiKey:      z.string().optional().describe('API key the orchestrator uses to call this agent'),
    },
    async (spec) => {
        try { return ok(await gw('POST', '/api/deploy', spec, 180_000)); } catch (e) { return err(e); }
    });

t('stop_agent',
    'Stop all containers for an agent and remove it from the pool.',
    { agent_id: z.string().describe('Agent ID to stop and unregister') },
    async ({ agent_id }) => {
        try { return ok(await gw('DELETE', `/api/deploy/${encodeURIComponent(agent_id)}`)); } catch (e) { return err(e); }
    });

// ── Health ────────────────────────────────────────────────────────────────────

t('gateway_health',
    'Check gateway and agent connectivity status.',
    {},
    async () => { try { return ok(await gw('GET', '/api/health')); } catch (e) { return err(e); } });

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
    log(`gateway: ${GATEWAY_URL}`);
    log(API_KEY ? 'auth: Bearer ***' : 'auth: none (set GATEWAY_API_KEY to secure)');

    const transport = new StdioServerTransport();
    await srv.connect(transport);
    log('MCP ready — tools: list_runs, start_flow, approve_gate, reject_gate, retry_run, list_agents, get_config, save_agent_config, delete_agent_config, save_flow_config, delete_flow_config, list_deployments, deploy_agent, stop_agent, gateway_health');
}

main().catch(e => { log(`Fatal: ${(e as Error).message}`); process.exit(1); });
