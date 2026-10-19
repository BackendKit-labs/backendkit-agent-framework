import { defineTool, z } from '@backendkit-labs/agent-core';
import type { ExecutionContext, ToolDefinition } from '@backendkit-labs/agent-core';
import type { Db } from './db';
import type { SimilarIncidents } from './similar';
import type { Action, ServerStatus } from './types';

/**
 * Typed MOCK tools. None has real effects: no shell, no network, no fs.
 * The only write is a row in the simulated `tickets` table (and only when not dry-run).
 * Every handler returns a JSON string with a `status` field.
 */

const json = (v: unknown): string => JSON.stringify(v);
const needsHuman = (reason: string): string => json({ status: 'needs_human', reason });

export interface ToolDeps {
    db: Db;
    similar: SimilarIncidents;
}

export function getServerStatus(db: Db, name: string): ServerStatus {
    const r = db.prepare('SELECT * FROM servers WHERE name = ?').get(name) as
        | { name: string; env: 'prod' | 'stg' | 'dev'; criticality: 'low' | 'medium' | 'high'; cpu_pct: number;
            mem_pct: number; status: 'ok' | 'degraded' | 'down'; services: string; autoscale: number }
        | undefined;
    if (!r) return { found: false, name };
    return {
        found: true, name: r.name, env: r.env, criticality: r.criticality, cpu_pct: r.cpu_pct,
        mem_pct: r.mem_pct, status: r.status, services: JSON.parse(r.services) as string[],
        autoscale: r.autoscale === 1,
    };
}

export function createTools(deps: ToolDeps): Record<string, ToolDefinition> {
    const { db, similar } = deps;
    const serverKnown = (name: string): boolean => getServerStatus(db, name).found;

    const get_server_status = defineTool({
        name: 'get_server_status',
        description: 'Read server state from the local inventory (read-only).',
        input: z.object({ server: z.string().min(1) }),
        execute: async ({ server }) => json(getServerStatus(db, server)),
    });

    const search_similar_incidents = defineTool({
        name: 'search_similar_incidents',
        description: 'Find similar past incidents in the local knowledge base (read-only).',
        input: z.object({ query: z.string().min(1), k: z.number().int().min(1).max(5).default(3) }),
        execute: async ({ query, k }) => json({ status: 'ok', ...(await similar.search(query, k)) }),
    });

    const restart_service = defineTool({
        name: 'restart_service',
        description: 'SIMULATED restart of a service on a known server.',
        input: z.object({ server: z.string().min(1), service: z.string().min(1), dry_run: z.boolean().default(false) }),
        execute: async ({ server, service, dry_run }) => {
            if (!serverKnown(server)) return needsHuman(`servidor desconocido: ${server}`);
            return json({
                status: dry_run ? 'pending_approval' : 'simulated', executed: false,
                message: `restart de ${service} en ${server} (simulado)`,
            });
        },
    });

    const scale_cpu = defineTool({
        name: 'scale_cpu',
        description: 'SIMULATED vCPU scale-up on a known server (max +4).',
        input: z.object({ server: z.string().min(1), delta_vcpu: z.number().int().min(1).max(4), dry_run: z.boolean().default(false) }),
        execute: async ({ server, delta_vcpu, dry_run }) => {
            if (!serverKnown(server)) return needsHuman(`servidor desconocido: ${server}`);
            return json({
                status: dry_run ? 'pending_approval' : 'simulated', executed: false,
                message: `+${delta_vcpu} vCPU en ${server} (simulado)`,
            });
        },
    });

    const upsert_ticket = defineTool({
        name: 'upsert_ticket',
        description: 'SIMULATED Jira/ServiceNow ticket create/update (writes only the local simulated tickets table).',
        input: z.object({
            mode: z.enum(['open', 'update']),
            alert_id: z.string().min(1),
            ticket_id: z.string().optional(),
            title: z.string().max(200).optional(),
            body: z.string().min(1).max(2000),
        }),
        execute: async ({ mode, alert_id, ticket_id, title, body }) => {
            const now = new Date().toISOString();
            if (mode === 'update') {
                if (!ticket_id) return needsHuman('update_ticket requiere ticket_id');
                const res = db.prepare('UPDATE tickets SET body = ?, updated_at = ? WHERE id = ?').run(body, now, ticket_id);
                if (res.changes === 0) return needsHuman(`ticket inexistente: ${ticket_id}`);
                return json({ status: 'simulated', ticket_id });
            }
            const id = `SIM-${alert_id}`;
            db.prepare('INSERT OR REPLACE INTO tickets VALUES (?,?,?,?,?,?,?)')
                .run(id, alert_id, title ?? `Alerta ${alert_id}`, 'open', body, now, now);
            return json({ status: 'simulated', ticket_id: id });
        },
    });

    const escalate = defineTool({
        name: 'escalate',
        description: 'SIMULATED escalation to a human on-call engineer.',
        input: z.object({ reason: z.string().min(1).max(500), severity: z.enum(['low', 'medium', 'high', 'critical']) }),
        execute: async ({ reason, severity }) =>
            json({ status: 'simulated', ticket_ref: `ESC-${severity.toUpperCase()}`, reason }),
    });

    const all = [get_server_status, search_similar_incidents, restart_service, scale_cpu, upsert_ticket, escalate];
    return Object.fromEntries(all.map(t => [t.name, t]));
}

/** Action → tool name. no_action / needs_human have no tool (never executed). */
export const ACTION_TOOL: Record<Action, string | null> = {
    restart_service: 'restart_service',
    scale_cpu: 'scale_cpu',
    open_ticket: 'upsert_ticket',
    update_ticket: 'upsert_ticket',
    escalate: 'escalate',
    no_action: null,
    needs_human: null,
};

/** Invoke a tool outside an engine loop (minimal execution context). */
export async function runTool(
    tools: Record<string, ToolDefinition>, name: string, args: unknown,
): Promise<Record<string, unknown>> {
    const tool = tools[name];
    if (!tool) return { status: 'needs_human', reason: `herramienta no permitida: ${name}` };
    const ctx = { agentId: 'aiops-orchestrator', sessionId: 'local' } as unknown as ExecutionContext;
    const raw = await tool.execute(args, ctx);
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return { status: 'needs_human', reason: raw.slice(0, 300) };
    }
}
