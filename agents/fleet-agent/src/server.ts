#!/usr/bin/env node
/**
 * Fleet Agent -- MCP server for Docker/Kubernetes fleet operations.
 *
 * Wraps the orchestrator-gateway (:3400) HTTP API but ONLY for operations
 * that require the gateway: container deploy/stop/list and health checks.
 *
 * Orchestration operations (start_flow, list_runs, approve_gate, etc.) are
 * NOT here -- connect directly to orchestrator-mcp-agent via MCP stdio.
 *
 * Env vars:
 *   GATEWAY_URL      Base URL of orchestrator-gateway (default: http://localhost:3400)
 *   GATEWAY_API_KEY  Bearer token if the gateway is secured (optional)
 */

import "dotenv/config";
import { McpServer }            from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z }                    from "zod";

const GATEWAY_URL = (process.env.GATEWAY_URL ?? "http://localhost:3400").replace(/\/$/, "");
const API_KEY     = process.env.GATEWAY_API_KEY;

const log = (msg) => process.stderr.write(`[fleet-agent] ${msg}\n`);

async function gw(method, path, body, timeoutMs = 30_000) {
    const headers = { "Content-Type": "application/json" };
    if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;
    const res = await fetch(`${GATEWAY_URL}${path}`, {
        method, headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

const ok  = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const err = (e)    => ({ content: [{ type: "text", text: `Error: ${e?.message ?? String(e)}` }] });

const srv = new McpServer({ name: "@backendkit-labs/fleet-agent", version: "0.1.0" });
const t = srv.tool.bind(srv);

t("list_deployments",
    "List all agent containers currently managed by Docker or Kubernetes.",
    {},
    async () => { try { return ok(await gw("GET", "/api/deploy")); } catch (e) { return err(e); } });

t("deploy_agent",
    "Deploy an agent as a Docker/Kubernetes container and register it in the orchestrator pool.",
    {
        id:          z.string(),
        image:       z.string().describe("Docker image (e.g. backendkit/docker-agent:latest)"),
        description: z.string().optional(),
        capability:  z.string().optional().describe("Capability tag for orchestrator routing (e.g. docker, coding)"),
        instances:   z.number().int().min(1).default(1),
        env:         z.record(z.string()).optional(),
        mounts:      z.array(z.object({ host: z.string(), container: z.string() })).optional(),
        api_key:     z.string().optional().describe("API key the orchestrator uses to call this agent"),
        memory:      z.string().optional().describe("Memory limit e.g. 512m, 2g"),
        cpu:         z.number().optional().describe("CPU cores limit e.g. 0.5"),
    },
    async ({ id, image, description, capability, instances, env, mounts, api_key, memory, cpu }) => {
        try {
            return ok(await gw("POST", "/api/deploy", {
                id, image, description, capability, instances,
                env, mounts, apiKey: api_key, memory, cpu,
            }, 180_000));
        } catch (e) { return err(e); }
    });

t("stop_agent",
    "Stop all containers for an agent and remove it from the pool.",
    { agent_id: z.string() },
    async ({ agent_id }) => {
        try { return ok(await gw("DELETE", `/api/deploy/${encodeURIComponent(agent_id)}`)); }
        catch (e) { return err(e); }
    });

t("deploy_settings",
    "Get fleet deployment settings: vault host path and runtime type (docker or kubernetes).",
    {},
    async () => { try { return ok(await gw("GET", "/api/deploy/settings")); } catch (e) { return err(e); } });

t("fleet_health",
    "Check gateway connectivity and health status of all registered agents.",
    {},
    async () => { try { return ok(await gw("GET", "/api/health")); } catch (e) { return err(e); } });

async function main() {
    log(`gateway: ${GATEWAY_URL}`);
    log(API_KEY ? "auth: Bearer ***" : "auth: none");
    const transport = new StdioServerTransport();
    await srv.connect(transport);
    log("MCP ready -- tools: list_deployments, deploy_agent, stop_agent, deploy_settings, fleet_health");
}

main().catch(e => { log(`Fatal: ${e?.message}`); process.exit(1); });