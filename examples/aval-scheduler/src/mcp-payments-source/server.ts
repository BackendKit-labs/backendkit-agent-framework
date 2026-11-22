#!/usr/bin/env node
/**
 * bk-mcp-payments-source — origen de pagos programados, expuesto por MCP.
 *
 * El agente lo consume como cualquier otro servidor MCP: no sabe ni le
 * importa que hoy sea un JSON local. Sustituir esto por un conector a
 * Postgres, Airtable o el ERP real es cambiar este fichero — `store.ts`
 * define el contrato (`listDue`, `listPending`, `recordOutcome`) y no
 * cambia.
 *
 * Variables de entorno:
 *   PAYMENTS_SOURCE_PATH   ruta del JSON. Por defecto: ~/.aval-scheduler/schedule.json
 *
 * Uso (stdio, como lo arranca el agente):
 *   node dist/mcp-payments-source/server.js
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PaymentsSourceStore } from './store';
import { SEED_SCHEDULE } from './seed';
import { parseCliArgs, runMcpServer } from './server-runner';

const STORE_PATH =
    process.env.PAYMENTS_SOURCE_PATH ?? path.join(os.homedir(), '.aval-scheduler', 'schedule.json');

const store = new PaymentsSourceStore(STORE_PATH, SEED_SCHEDULE);

function buildServer(): McpServer {
    const srv = new McpServer({ name: 'payments-source', version: '0.1.0' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = srv.tool.bind(srv) as any;

    t(
        'list_due_payments',
        'Pagos programados que vencen hoy o antes y conviene intentar (nuevos, o cuyo último ' +
        'intento fue denegado — AVAL puede haber cambiado la política desde entonces). Cada uno ' +
        'trae idempotencyKey — pásalo tal cual al llamar a pay, NUNCA construyas uno vos mismo ' +
        'ni reutilices el de una corrida anterior: ya viene armado para que AVAL evalúe la ' +
        'política de nuevo en vez de repetir una decisión vieja.',
        {},
        async () => {
            const due = store.listDue();
            return { content: [{ type: 'text' as const, text: JSON.stringify(due, null, 2) }] };
        },
    );

    t(
        'list_pending_confirmations',
        'Pagos que ya se intentaron en una corrida anterior y quedaron retenidos o autorizados ' +
        'sin confirmar el cobro final. Revisa cada uno con check_payment antes de procesar pagos ' +
        'nuevos, y actualiza su estado con record_payment_outcome.',
        {},
        async () => {
            const pending = store.listPending();
            return { content: [{ type: 'text' as const, text: JSON.stringify(pending, null, 2) }] };
        },
    );

    t(
        'list_stuck_payments',
        'Pagos que llevan varias denegaciones seguidas y ya no aparecen en list_due_payments — ' +
        'necesitan que alguien mire AVAL (presupuesto, contraparte, política) o el propio ' +
        'calendario, no otro intento de pay. Menciónalos en el resumen final de la corrida; ' +
        'nunca los proceses con pay.',
        {},
        async () => {
            const stuck = store.listStuck();
            return { content: [{ type: 'text' as const, text: JSON.stringify(stuck, null, 2) }] };
        },
    );

    t(
        'record_payment_outcome',
        'Registra el resultado de un intento de pago contra este origen: qué pasó con un ' +
        'occurrenceId concreto. Llamar siempre después de pay o de check_payment, con el estado ' +
        'que devolvieron. Es seguro llamarlo más de una vez con el mismo resultado.',
        {
            occurrenceId: z.string().describe('El occurrenceId devuelto por list_due_payments o list_pending_confirmations.'),
            authorizationId: z.string().describe('El authorizationId que devolvió AVAL.'),
            state: z.enum(['authorized', 'held', 'settled', 'denied', 'released'])
                .describe('El estado actual según AVAL: decision de pay, o state de check_payment.'),
        },
        async ({ occurrenceId, authorizationId, state }: { occurrenceId: string; authorizationId: string; state: 'authorized' | 'held' | 'settled' | 'denied' | 'released' }) => {
            store.recordOutcome(occurrenceId, authorizationId, state);
            return { content: [{ type: 'text' as const, text: `Registrado: ${occurrenceId} → ${state}` }] };
        },
    );

    return srv;
}

const { httpMode, port } = parseCliArgs();
runMcpServer(buildServer, { httpMode, port, label: 'payments-source' }).catch((err) => {
    process.stderr.write(`[payments-source] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
