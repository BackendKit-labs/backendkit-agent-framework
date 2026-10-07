import { createHash } from 'node:crypto';
import { defineTool, z } from '@backendkit-labs/agent-core';
import { avalKey, avalRequest, type AvalToolsConfig } from './client';

const USD_PER_UNIT = 1_000_000;

interface AvalCredentialNotice {
    keyId: string | null;
    expiresInDays: number | null;
    warning?: string;
}

interface AvalPayment {
    rail: string;
    asset: string;
    nativeAmount: number;
    rate: number;
    ref: string;
}

interface AvalCapability {
    rail: string;
    kind: string;
    actual: number;
    payment: AvalPayment;
}

interface AvalBudget {
    remainingToday: number;
    remainingTotal: number;
}

interface AvalSpendResponse {
    decision?: 'authorized' | 'denied' | 'held';
    authorizationId?: string;
    amount?: number;
    reasons?: string[];
    rail?: string;
    capability?: AvalCapability;
    credential?: AvalCredentialNotice;
    budget?: AvalBudget;
    error?: string;
    retryAfterSeconds?: number;
}

/**
 * A deterministic idempotency key from what the call actually is, not a
 * random one: an agent that retries the exact same request after a timeout
 * gets the exact same key and AVAL treats it as a replay instead of a second
 * charge. A genuinely new request — different args, or a later turn — gets a
 * different key on its own.
 */
function deriveIdempotencyKey(sessionId: string, counterparty: string, ceilingUsd: number, purpose: string): string {
    return createHash('sha256').update(`${sessionId}:${counterparty}:${ceilingUsd}:${purpose}`).digest('hex').slice(0, 24);
}

const usdFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/** Mirrors AVAL's own money() formatter: two decimals normally, up to six for sub-cent amounts. */
function formatUsd(units: number): string {
    return `$${usdFormat.format(units / USD_PER_UNIT)}`;
}

/**
 * AVAL returns a budget snapshot on every `/spend` response, authorized or
 * not — without surfacing it, an agent placing several calls in the same
 * turn (or the same run) has no way to know how much room it has left
 * before the *next* call, so it can't prioritize when the day's spend won't
 * cover everything it's about to ask for.
 */
function formatBudget(budget?: AvalBudget): string {
    if (!budget) return '';
    return `\nPresupuesto restante: ${formatUsd(budget.remainingToday)} hoy, ${formatUsd(budget.remainingTotal)} en total.`;
}

/**
 * Creates the `pay` tool: the amarrada path into AVAL. The agent asks for a
 * ceiling; AVAL decides and, if authorized, pays through its own rail — the
 * agent never sees a vendor credential to bypass.
 */
export function createPayTool(config: AvalToolsConfig) {
    return defineTool({
        name: 'pay',
        description:
            'Solicita un gasto a AVAL para pagar a una contraparte registrada. AVAL decide si se ' +
            'autoriza, se retiene para aprobación humana, o se deniega, y si autoriza, paga él mismo ' +
            'por el carril que corresponda. Nunca gastes por tu cuenta: si la respuesta no es ' +
            '"authorized", no hay pago que hacer. La respuesta incluye el presupuesto restante — ' +
            'útil para priorizar si vas a pedir varios gastos en el mismo turno y no van a entrar todos.',
        input: z.object({
            counterparty: z.string().describe('Identificador de la contraparte registrada en AVAL, p. ej. "ocr.docs".'),
            ceilingUsd: z.number().positive().describe('Techo del gasto en dólares, p. ej. 0.42 para 42 centavos. El coste real puede ser menor.'),
            purpose: z.string().describe('Motivo del gasto, en una frase clara: queda escrito en el registro de AVAL.'),
            idempotencyKey: z
                .string()
                .optional()
                .describe('Sólo si necesitas forzar una clave concreta. Por defecto se deriva de la sesión y los argumentos.'),
        }),
        execute: async ({ counterparty, ceilingUsd, purpose, idempotencyKey }, ctx) => {
            const token = avalKey(config, ctx.secrets);
            if (!token) {
                return `Error: este agente no tiene credencial de AVAL configurada ` +
                    `(falta ctx.secrets.${config.secretName ?? 'AVAL_KEY'} en su perfil).`;
            }

            const ceiling = Math.round(ceilingUsd * USD_PER_UNIT);
            const key = idempotencyKey ?? deriveIdempotencyKey(ctx.sessionId, counterparty, ceiling, purpose);

            const { status, body } = await avalRequest<AvalSpendResponse>(config, token, 'POST', '/api/v1/spend', {
                counterparty,
                ceiling,
                purpose,
                idempotencyKey: key,
            });

            if (status === 429) {
                return `AVAL frenó la petición (demasiados intentos o llamadas). ` +
                    `Reintenta en ${body.retryAfterSeconds ?? '?'} s. ${body.error ?? ''}`.trim();
            }
            if (status === 401 || status === 403) {
                return `Error de credencial: ${body.error}`;
            }
            if (!body.decision) {
                return `Error: respuesta inesperada de AVAL (${status}): ${body.error ?? JSON.stringify(body)}`;
            }

            const warning = body.credential?.warning ? `\nAviso de credencial: ${body.credential.warning}` : '';
            const reasons = body.reasons?.length ? `\nMotivo: ${body.reasons.join(' ')}` : '';
            const budget = formatBudget(body.budget);

            if (body.decision === 'denied') {
                return `Denegado.${reasons}${warning}${budget}`;
            }

            if (body.decision === 'held') {
                return (
                    `Retenido para aprobación humana. authorizationId="${body.authorizationId}".` +
                    `${reasons}\nUsa check_payment con este authorizationId más tarde para saber si ya se resolvió — ` +
                    `no se ha gastado nada todavía.${warning}${budget}`
                );
            }

            // authorized
            const cap = body.capability;
            const actual = cap ? formatUsd(cap.actual) : formatUsd(body.amount ?? ceiling);
            const nativo = cap ? `${cap.payment.nativeAmount} ${cap.payment.asset}` : '';
            return (
                `Pagado. authorizationId="${body.authorizationId}", carril=${body.rail ?? cap?.rail}, ` +
                `coste real=${actual}${nativo ? ` (${nativo})` : ''}, ref=${cap?.payment.ref ?? '—'}.` +
                `${reasons}${warning}${budget}`
            );
        },
    });
}
