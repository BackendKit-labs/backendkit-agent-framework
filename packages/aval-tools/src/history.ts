import { defineTool, z } from '@backendkit-labs/agent-core';
import { avalKey, avalRequest, describeUnexpected, type AvalToolsConfig } from './client';

const USD_PER_UNIT = 1_000_000;
const usdFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const formatUsd = (units: number) => `$${usdFormat.format(units / USD_PER_UNIT)}`;

interface AvalHistoryEntry {
    seq: number;
    ts: string;
    type: string;
    amount: number;
    asset: string | null;
    vendor: string | null;
    purpose: string | null;
    reasons: string[];
}

interface AvalHistoryResponse {
    entries?: AvalHistoryEntry[];
    error?: string;
}

/**
 * Creates the `list_own_history` tool: the agent's own recent activity in
 * AVAL (`GET /api/v1/history`). `pay` and `check_payment` only ever show
 * what happened to ONE spend. Without this, an agent that has to decide
 * between several due payments in the same turn — and whose budget won't
 * cover all of them — has no way to see patterns (which counterparty gets
 * paid regularly, which requests have been failing) to prioritize with.
 *
 * Deliberately read-only and separate from `pay`: an agent should reach for
 * it only when it actually needs the context, not on every turn.
 */
export function createHistoryTool(config: AvalToolsConfig) {
    return defineTool({
        name: 'list_own_history',
        description:
            'Consulta el historial propio de este agente en AVAL: los últimos gastos (autorizados, ' +
            'retenidos o denegados), con contraparte, monto y motivo. Útil cuando necesitás contexto ' +
            'para priorizar entre varios pagos posibles — no hace falta llamarlo si ya sabés qué hacer.',
        input: z.object({
            limit: z.number().int().positive().max(200).optional().describe('Cuántas entradas recientes traer. Por defecto 20.'),
        }),
        execute: async ({ limit }, ctx) => {
            const token = avalKey(config, ctx.secrets);
            if (!token) {
                return `Error: este agente no tiene credencial de AVAL configurada ` +
                    `(falta ctx.secrets.${config.secretName ?? 'AVAL_KEY'} en su perfil).`;
            }

            const { status, body } = await avalRequest<AvalHistoryResponse>(
                config,
                token,
                'GET',
                `/api/v1/history?limit=${limit ?? 20}`,
            );

            if (status === 401 || status === 403) return `Error de credencial: ${body.error ?? `HTTP ${status}`}`;
            if (!body.entries) return `Error: ${describeUnexpected(status, body)}`;
            if (body.entries.length === 0) return 'Sin historial todavía — este agente no tiene ninguna entrada en AVAL.';

            const lines = body.entries.map((e) => {
                const reason = e.reasons?.length ? ` — ${e.reasons[0]}` : '';
                return `#${e.seq} ${e.ts} ${e.type} ${formatUsd(e.amount)} ${e.vendor ?? '—'} · ${e.purpose ?? '—'}${reason}`;
            });
            return `${body.entries.length} entrada(s), más reciente al final:\n${lines.join('\n')}`;
        },
    });
}
