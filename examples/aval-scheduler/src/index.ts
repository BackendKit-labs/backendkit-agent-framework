#!/usr/bin/env node
/**
 * Punto de entrada. Levanta el agente de pagos programados:
 *
 *   trigger de cron → engine.run(prompt) → el agente reconcilia lo pendiente,
 *   procesa lo nuevo, y termina. Nada queda esperando entre corridas —
 *   AVAL es quien recuerda qué pasó, no este proceso.
 *
 * Variables de entorno requeridas: ver .env.example
 */

import * as path from 'node:path';
import * as os from 'node:os';
import type { Server } from 'node:http';
import 'dotenv/config';
import { StdoutTransport } from '@backendkit-labs/agent-core';
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';
import { buildSchedulerAgent, stopSchedulerAgent } from './agent';
import { PaymentsSourceStore } from './mcp-payments-source/store';
import { SEED_SCHEDULE } from './mcp-payments-source/seed';
import { startAdminServer } from './admin-server';

const RUN_NOW_TOPIC = 'scheduler.run-now';

const PREFIX = '[aval-scheduler-agent]';

/** Una línea de progreso normal durante el arranque. */
function ok(message: string): void {
    process.stderr.write(`${PREFIX} ✓ ${message}\n`);
}

/**
 * Corta el arranque con algo que se pueda leer sin tener el código delante:
 * qué pasó, y qué hacer al respecto. `never` porque nada después de llamarlo
 * llega a ejecutarse — así TypeScript no exige un valor de vuelta imposible
 * en `requireEnv`.
 */
function fail(message: string, hint?: string): never {
    process.stderr.write(`\n${PREFIX} ✖ ${message}\n`);
    if (hint) process.stderr.write(`  → ${hint}\n`);
    process.stderr.write('\n');
    process.exit(1);
}

function requireEnv(name: string, hint: string): string {
    const value = process.env[name];
    if (!value) fail(`Falta la variable de entorno ${name}.`, hint);
    return value;
}

/**
 * Falla rápido, no en silencio. Sin esto, una clave que todavía es el
 * placeholder del `.env.example`, o un AVAL caído, dejan al proceso
 * "corriendo" hasta que el cron dispara la primera corrida de verdad, que
 * puede ser horas después.
 *
 * `GET /api/v1/verify` no pide credencial a propósito (ver su comentario en
 * el propio AVAL), así que confirma que el servidor responde sin escribir
 * nada en el registro — no hay forma honesta de "probar" la credencial del
 * agente sin gastar una autorización de verdad, así que eso se deja para la
 * primera corrida real.
 */
async function checkAval(avalUrl: string, avalKey: string): Promise<void> {
    if (!/^aval_sk_[a-f0-9]+_.+$/.test(avalKey)) {
        fail(
            'AVAL_KEY no tiene la forma de una clave de agente (aval_sk_<id>_<secreto>).',
            'Si el valor es literalmente "aval_sk_...", todavía es el placeholder de .env.example — ' +
                'dá de alta el agente en la consola de AVAL (Agentes → + Nuevo agente) y pegá la clave que te muestra.',
        );
    }

    let response: Response;
    try {
        response = await fetch(`${avalUrl}/api/v1/verify`);
    } catch (err) {
        fail(
            `No se pudo alcanzar AVAL en ${avalUrl}.`,
            `¿Está levantado? En el repo de AVAL: npm run dev. Detalle: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    if (!response.ok) {
        fail(
            `AVAL respondió ${response.status} en ${avalUrl}/api/v1/verify.`,
            'Revisá que AVAL_URL apunte al servidor correcto.',
        );
    }

    const status = (await response.json()) as { ok: boolean; length: number; brokenAt?: number };
    if (!status.ok) {
        fail(
            `AVAL está arriba pero su cadena está rota (entrada ${status.brokenAt}).`,
            'No tiene sentido programar pagos sobre un registro que no se puede confiar — arreglá eso primero.',
        );
    }

    ok(`AVAL en línea en ${avalUrl} — cadena íntegra, ${status.length} entradas.`);
}

async function main(): Promise<void> {
    const avalUrl = process.env.AVAL_URL ?? 'http://localhost:3000';
    const avalKey = requireEnv(
        'AVAL_KEY',
        'Dá de alta el agente en la consola de AVAL (Agentes → + Nuevo agente) y pegá la clave que te muestra en .env.',
    );
    const llmKey = requireEnv(
        'DEEPSEEK_API_KEY',
        'Conseguí una clave en https://platform.deepseek.com y pegala en .env.',
    );
    const cron = process.env.SCHEDULE_CRON ?? '0 9 * * *'; // diario, 9:00

    // Disparo manual, además del cron: sin esto, un pago que quedó denegado
    // por presupuesto (y que listDue() ya vuelve a ofrecer) espera hasta la
    // próxima corrida programada aunque alguien suba el tope en AVAL un
    // minuto después. Opcional a propósito — sin SCHEDULER_WEBHOOK_SECRET no
    // se abre ningún puerto nuevo, en vez de dejarlo escuchando sin
    // autenticación por defecto.
    const webhookSecret = process.env.SCHEDULER_WEBHOOK_SECRET;
    const webhookPort = Number(process.env.SCHEDULER_WEBHOOK_PORT ?? 3100);

    // Panel admin (CRUD del calendario + historial + botón "correr ahora").
    // Mismo apagado-por-defecto que el webhook: sin ADMIN_TOKEN no se levanta
    // nada. "Correr ahora" no llama al motor directamente — emite un evento
    // que un trigger 'event' recoge, para pasar por el mismo `busy` gate de
    // TriggerManager que ya protege al cron y al webhook de pisarse.
    const adminToken = process.env.ADMIN_TOKEN;
    const adminPort = Number(process.env.ADMIN_PORT ?? 3200);
    const paymentsSourcePath =
        process.env.PAYMENTS_SOURCE_PATH ?? path.join(os.homedir(), '.aval-scheduler', 'schedule.json');

    await checkAval(avalUrl, avalKey);

    const agent = buildSchedulerAgent({
        providers: { deepseek: new DeepSeekProvider({ apiKey: llmKey }) },
        defaultProvider: 'deepseek',
        avalUrl,
        avalKey,
        transport: new StdoutTransport(),
        // Solo se pasa si el operador lo fijó: el servidor MCP tiene su propio valor por defecto.
        paymentsSourcePath: process.env.PAYMENTS_SOURCE_PATH || undefined,
        ...(webhookSecret ? { webhookPort } : {}),
        triggers: [
            { type: 'schedule', cron, task: 'Ejecuta la corrida de pagos programados de hoy.' },
            ...(webhookSecret
                ? [
                      {
                          type: 'webhook' as const,
                          path: '/run-now',
                          secret: webhookSecret,
                          buildPrompt: () =>
                              'Alguien pidió una corrida fuera de horario (POST /run-now). Ejecuta la ' +
                              'corrida de pagos programados de hoy, igual que si fuera el disparo del cron.',
                      },
                  ]
                : []),
            ...(adminToken
                ? [
                      {
                          type: 'event' as const,
                          topic: RUN_NOW_TOPIC,
                          buildPrompt: () =>
                              'Alguien pidió una corrida ahora mismo desde el panel admin. Ejecuta la ' +
                              'corrida de pagos programados de hoy, igual que si fuera el disparo del cron.',
                      },
                  ]
                : []),
        ],
    });

    await agent.start();

    let adminServer: Server | undefined;
    if (adminToken) {
        const store = new PaymentsSourceStore(paymentsSourcePath, SEED_SCHEDULE);
        adminServer = startAdminServer({
            port: adminPort,
            token: adminToken,
            store,
            emitRunNow: () => agent.emit(RUN_NOW_TOPIC, {}, 'admin-panel'),
        });
    }

    ok(
        `en línea. cron="${cron}"` +
            (webhookSecret ? ` · webhook POST /run-now en :${webhookPort}` : '') +
            (adminToken ? ` · panel admin en :${adminPort}` : '') +
            ' · esperando la próxima corrida.',
    );

    const shutdown = async () => {
        await stopSchedulerAgent(agent);
        adminServer?.close();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
});
