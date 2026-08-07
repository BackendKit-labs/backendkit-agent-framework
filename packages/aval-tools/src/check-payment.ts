import { defineTool, z } from '@backendkit-labs/agent-core';
import { avalKey, avalRequest, type AvalToolsConfig } from './client';

const USD_PER_UNIT = 1_000_000;
const usdFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const formatUsd = (units: number) => `$${usdFormat.format(units / USD_PER_UNIT)}`;

interface AvalAuthorizationStatus {
    authorizationId: string;
    state: 'held' | 'authorized' | 'settled' | 'released';
    amount: number;
    vendor: string;
    purpose: string;
    rail: string | null;
    reasons: string[];
    createdAt: string;
    error?: string;
}

const STATE_LABEL: Record<AvalAuthorizationStatus['state'], string> = {
    held: 'retenido — esperando aprobación humana, todavía no se gastó nada',
    authorized: 'autorizado — AVAL está pagando o ya pagó, aún sin confirmar el coste final',
    settled: 'liquidado — el pago se completó',
    released: 'liberado — se rechazó o falló, no se gastó nada',
};

/**
 * Creates the `check_payment` tool: the other half of the async approval
 * story. `pay` can return "retenido" and end the turn there — nothing in the
 * framework blocks waiting for a human. This tool is how a later invocation
 * (a cron trigger, a follow-up prompt, a human asking "¿ya se aprobó?") finds
 * out what happened without needing the console credential AVAL's dashboard
 * requires.
 */
export function createCheckPaymentTool(config: AvalToolsConfig) {
    return defineTool({
        name: 'check_payment',
        description:
            'Consulta el estado de un gasto pedido antes con pay, usando su authorizationId. ' +
            'Úsalo para saber si un gasto "retenido" ya fue aprobado o rechazado.',
        input: z.object({
            authorizationId: z.string().describe('El authorizationId que devolvió pay.'),
        }),
        execute: async ({ authorizationId }, ctx) => {
            const token = avalKey(config, ctx.secrets);
            if (!token) {
                return `Error: este agente no tiene credencial de AVAL configurada ` +
                    `(falta ctx.secrets.${config.secretName ?? 'AVAL_KEY'} en su perfil).`;
            }

            const { status, body } = await avalRequest<AvalAuthorizationStatus>(
                config,
                token,
                'GET',
                `/api/v1/spend/${encodeURIComponent(authorizationId)}`,
            );

            if (status === 404) return `No existe ninguna autorización con id "${authorizationId}".`;
            if (status === 403) return `Esa autorización no pertenece a este agente.`;
            if (status === 401) return `Error de credencial: ${body.error}`;
            if (!body.state) return `Error: respuesta inesperada de AVAL (${status}): ${body.error ?? JSON.stringify(body)}`;

            const reasons = body.reasons?.length ? `\nMotivo: ${body.reasons.join(' ')}` : '';
            return (
                `${authorizationId} → ${STATE_LABEL[body.state]}.\n` +
                `${formatUsd(body.amount)} · ${body.vendor}${body.rail ? ` · vía ${body.rail}` : ''} · ${body.purpose}` +
                reasons
            );
        },
    });
}
