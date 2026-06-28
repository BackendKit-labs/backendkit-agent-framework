#!/usr/bin/env node
/**
 * Cloud MCP — MCP server (stdio) wrapping the agent-cloud REST API.
 *
 * El director-agent lo inicia como proceso hijo y usa sus tools para
 * gestionar departments, deployables, workflows y métricas en agent-cloud.
 *
 * Env vars:
 *   AGENT_CLOUD_URL      Base URL de agent-cloud  (default: http://localhost:3100)
 *   AGENT_CLOUD_API_KEY  API key M2M (bkc_xxx) generada con POST /api-keys
 */

import "dotenv/config";
import { McpServer }            from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z }                    from "zod";
import type {
    CatalogEntry,
    DeployedAgentView,
    DeployResult,
    Department,
    Deployable,
    DirectorMetrics,
    Workflow,
    WorkflowRun,
} from "@backendkit-labs/cloud-platform";

const BASE_URL = (process.env.CLOUD_PLATFORM_URL ?? "http://localhost:3100").replace(/\/$/, "");
const API_KEY  = process.env.CLOUD_PLATFORM_API_KEY;

const log = (msg: string) => process.stderr.write(`[cloud-mcp] ${msg}\n`);

// ── HTTP helper ────────────────────────────────────────────────────────────────

async function cloud<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 30_000,
): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_KEY) headers["X-Api-Key"] = API_KEY;

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();
    if (!res.ok) {
        let detail = text;
        try { detail = JSON.stringify(JSON.parse(text)); } catch { /* keep raw */ }
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${detail}`);
    }
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

const ok  = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const err = (e: unknown)    => ({ content: [{ type: "text" as const, text: `Error: ${(e as Error)?.message ?? String(e)}` }] });

// ── MCP server ─────────────────────────────────────────────────────────────────

const srv = new McpServer({ name: "@backendkit-labs/cloud-mcp", version: "0.1.0" });
const t = srv.tool.bind(srv);

// ── Departments ────────────────────────────────────────────────────────────────

t("list_departments",
    "Lista todos los departamentos de la organización en agent-cloud. " +
    "Devuelve id, name, slug, description, icon, color.",
    {
        status: z.enum(["draft", "active", "paused"]).optional()
            .describe("Filtrar por estado (solo si el endpoint lo soporta)"),
    },
    async ({ status }: { status?: string }) => {
        try {
            const qs = status ? `?status=${status}` : "";
            return ok(await cloud<Department[]>("GET", `/departments${qs}`));
        } catch (e) { return err(e); }
    });

t("get_department",
    "Obtiene el detalle de un departamento incluyendo sus secretos (solo keys, sin valores).",
    { id: z.string().uuid().describe("UUID del departamento") },
    async ({ id }: { id: string }) => {
        try { return ok(await cloud<Department>("GET", `/departments/${id}`)); } catch (e) { return err(e); }
    });

// ── Deployables ────────────────────────────────────────────────────────────────

t("list_deployables",
    "Lista deployables (agentes o apps) en agent-cloud. " +
    "Filtra por departamento, tipo (agent|app) o estado (pending|starting|running|stopped|error).",
    {
        department_id: z.string().uuid().optional().describe("Filtrar por departamento"),
        kind:   z.enum(["agent", "app"]).optional().describe("Tipo de deployable"),
        status: z.enum(["pending", "starting", "running", "stopped", "error"]).optional()
            .describe("Estado del deployable"),
    },
    async ({ department_id, kind, status }: { department_id?: string; kind?: string; status?: string }) => {
        try {
            const params = new URLSearchParams();
            if (department_id) params.set("departmentId", department_id);
            if (kind)   params.set("kind", kind);
            if (status) params.set("status", status);
            const qs = params.size ? `?${params}` : "";
            return ok(await cloud<Deployable[]>("GET", `/deployables${qs}`));
        } catch (e) { return err(e); }
    });

t("get_deployable",
    "Obtiene el estado actual de un deployable específico.",
    { id: z.string().uuid().describe("UUID del deployable") },
    async ({ id }: { id: string }) => {
        try { return ok(await cloud<Deployable>("GET", `/deployables/${id}`)); } catch (e) { return err(e); }
    });

// ── Director (deploy / stop / métricas) ───────────────────────────────────────

t("cloud_deploy",
    "Despliega un deployable en agent-cloud. El deployable debe existir previamente " +
    "(crear con list_deployables y verificar su id). Inyecta secrets del departamento y " +
    "variables estructurales (AGENT_ID, AGENT_TYPE, MODEL) automáticamente.",
    {
        deployable_id: z.string().uuid().describe("UUID del deployable a desplegar"),
        image: z.string().optional().describe("Imagen Docker a usar (override del catalogKey si se especifica)"),
        env:   z.record(z.string()).optional().describe("Variables de entorno extra (baja prioridad frente a secrets del depto)"),
    },
    async ({ deployable_id, image, env }: { deployable_id: string; image?: string; env?: Record<string, string> }) => {
        try {
            return ok(await cloud<DeployResult>("POST", "/director/deploy", { deployableId: deployable_id, image, env }, 120_000));
        } catch (e) { return err(e); }
    });

t("cloud_stop",
    "Detiene un deployable en ejecución en agent-cloud.",
    { deployable_id: z.string().uuid().describe("UUID del deployable a detener") },
    async ({ deployable_id }: { deployable_id: string }) => {
        try { return ok(await cloud<{ message: string }>("POST", `/director/${deployable_id}/stop`)); } catch (e) { return err(e); }
    });

t("cloud_metrics",
    "Obtiene métricas globales de agent-cloud: total de deployables activos, " +
    "distribución por kind (agent/app) y por estado, uptime y uso de memoria.",
    {},
    async () => {
        try { return ok(await cloud<DirectorMetrics>("GET", "/director/metrics")); } catch (e) { return err(e); }
    });

t("cloud_deployed_agents",
    "Lista los agentes actualmente desplegados y su estado de runtime en agent-cloud.",
    {},
    async () => {
        try { return ok(await cloud<DeployedAgentView[]>("GET", "/director/agents")); } catch (e) { return err(e); }
    });

// ── Catalog ────────────────────────────────────────────────────────────────────

t("list_catalog",
    "Lista todas las entradas del catálogo enterprise de agent-cloud. " +
    "Cada entrada es un template reutilizable (image, env, requiredSecrets, category) " +
    "que los deployables referencian via catalogKey. " +
    "Filtra por category para ver solo entradas de una categoría (dev, knowledge, hr, finance, ops, infra, custom).",
    {
        category: z.string().optional()
            .describe("Filtrar por categoría: dev, knowledge, hr, finance, ops, infra, custom"),
    },
    async ({ category }: { category?: string }) => {
        try {
            const qs = category ? `?category=${encodeURIComponent(category)}` : "";
            return ok(await cloud<CatalogEntry[]>("GET", `/catalog${qs}`));
        } catch (e) { return err(e); }
    });

t("get_catalog_entry",
    "Obtiene una entrada del catálogo por su UUID. " +
    "Incluye requiredSecrets — las claves que el departamento DEBE tener configuradas antes de desplegar.",
    { id: z.string().uuid().describe("UUID de la CatalogEntry") },
    async ({ id }: { id: string }) => {
        try { return ok(await cloud<CatalogEntry>("GET", `/catalog/${id}`)); } catch (e) { return err(e); }
    });

t("create_catalog_entry",
    "Crea una nueva entrada en el catálogo enterprise. " +
    "Úsala para registrar templates propios de la empresa: imagen Docker, vars de entorno por defecto, " +
    "y la lista de secrets que el departamento DEBE tener antes de poder desplegar.",
    {
        key:             z.string().describe("Slug único kebab-case (e.g. 'hr-assistant', 'finance-bot')"),
        displayName:     z.string().describe("Nombre legible"),
        description:     z.string().optional(),
        category:        z.string().optional().describe("Categoría: dev, knowledge, hr, finance, ops, infra, custom"),
        kind:            z.enum(["agent", "app"]).optional().describe("Tipo de deployable"),
        image:           z.string().describe("Imagen Docker (e.g. 'my-registry/hr-agent:latest')"),
        env:             z.record(z.string()).optional().describe("Variables de entorno por defecto"),
        defaultModel:    z.string().optional().describe("Modelo LLM por defecto (e.g. 'claude-sonnet-4-6')"),
        runtime:         z.enum(["docker", "k8s", "process"]).optional(),
        requiredSecrets: z.array(z.string()).optional()
            .describe("UPPER_SNAKE_CASE keys que deben existir en dept secrets antes de desplegar"),
        isPublic:        z.boolean().optional(),
    },
    async (dto: {
        key: string; displayName: string; description?: string; category?: string;
        kind?: string; image: string; env?: Record<string, string>; defaultModel?: string;
        runtime?: string; requiredSecrets?: string[]; isPublic?: boolean;
    }) => {
        try { return ok(await cloud<CatalogEntry>("POST", "/catalog", dto)); } catch (e) { return err(e); }
    });

t("update_catalog_entry",
    "Actualiza una entrada del catálogo. Úsala para agregar o modificar requiredSecrets " +
    "cuando el template de un agente necesite nuevas variables.",
    {
        id:              z.string().uuid().describe("UUID de la CatalogEntry"),
        displayName:     z.string().optional(),
        description:     z.string().optional(),
        category:        z.string().optional(),
        image:           z.string().optional(),
        env:             z.record(z.string()).optional(),
        defaultModel:    z.string().optional(),
        requiredSecrets: z.array(z.string()).optional(),
        isPublic:        z.boolean().optional(),
    },
    async ({ id, ...body }: { id: string; [k: string]: unknown }) => {
        try { return ok(await cloud<CatalogEntry>("PATCH", `/catalog/${id}`, body)); } catch (e) { return err(e); }
    });

// ── Workflows ──────────────────────────────────────────────────────────────────

t("list_workflows",
    "Lista workflows definidos en agent-cloud, opcionalmente filtrados por departamento o estado.",
    {
        department_id: z.string().uuid().optional().describe("Filtrar por departamento"),
        status: z.enum(["draft", "active", "paused"]).optional()
            .describe("Filtrar por estado del workflow"),
    },
    async ({ department_id, status }: { department_id?: string; status?: string }) => {
        try {
            const params = new URLSearchParams();
            if (department_id) params.set("departmentId", department_id);
            if (status) params.set("status", status);
            const qs = params.size ? `?${params}` : "";
            return ok(await cloud<Workflow[]>("GET", `/workflows${qs}`));
        } catch (e) { return err(e); }
    });

t("get_workflow",
    "Obtiene la definición completa de un workflow, incluyendo sus steps ordenados.",
    { id: z.string().uuid().describe("UUID del workflow") },
    async ({ id }: { id: string }) => {
        try { return ok(await cloud<Workflow>("GET", `/workflows/${id}`)); } catch (e) { return err(e); }
    });

t("run_workflow",
    "Inicia una ejecución de un workflow. Devuelve el WorkflowRun con status=pending. " +
    "Usa get_workflow_run para hacer seguimiento del estado.",
    {
        workflow_id: z.string().uuid().describe("UUID del workflow a ejecutar"),
        input: z.record(z.unknown()).optional()
            .describe("Payload de entrada para el workflow (JSON libre)"),
    },
    async ({ workflow_id, input }: { workflow_id: string; input?: Record<string, unknown> }) => {
        try {
            return ok(await cloud<WorkflowRun>("POST", `/workflows/${workflow_id}/run`, { input }));
        } catch (e) { return err(e); }
    });

t("list_workflow_runs",
    "Lista el historial de ejecuciones de un workflow.",
    { workflow_id: z.string().uuid().describe("UUID del workflow") },
    async ({ workflow_id }: { workflow_id: string }) => {
        try { return ok(await cloud<WorkflowRun[]>("GET", `/workflows/${workflow_id}/runs`)); } catch (e) { return err(e); }
    });

t("get_workflow_run",
    "Obtiene el estado actual de una ejecución de workflow. " +
    "Incluye status, input, output y error si falló.",
    { run_id: z.string().uuid().describe("UUID del WorkflowRun") },
    async ({ run_id }: { run_id: string }) => {
        try { return ok(await cloud<WorkflowRun>("GET", `/workflows/runs/${run_id}`)); } catch (e) { return err(e); }
    });

// ── Boot ───────────────────────────────────────────────────────────────────────

async function main() {
    log(`cloud-platform: ${BASE_URL}`);
    log(API_KEY ? "auth: X-Api-Key ***" : "ADVERTENCIA: CLOUD_PLATFORM_API_KEY no configurada — requests sin autenticar");

    const transport = new StdioServerTransport();
    await srv.connect(transport);

    log("MCP ready — tools: list_departments, get_department, list_deployables, get_deployable, " +
        "cloud_deploy, cloud_stop, cloud_metrics, cloud_deployed_agents, " +
        "list_catalog, get_catalog_entry, create_catalog_entry, update_catalog_entry, " +
        "list_workflows, get_workflow, run_workflow, list_workflow_runs, get_workflow_run");
}

main().catch(e => { log(`Fatal: ${(e as Error)?.message}`); process.exit(1); });
