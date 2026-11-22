import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * El origen de pagos programados, tal como lo vería el agente.
 *
 * Es el mismo principio que los carriles simulados de AVAL: un adaptador
 * sustituible. Aquí el calendario vive en un JSON local; en producción es
 * Postgres, Airtable, una hoja de cálculo o el propio ERP — lo único que
 * importa es que implemente estas tres operaciones. `server.ts` es la única
 * pieza que sabría que cambió de proveedor.
 */

export interface ScheduledPayment {
    id: string;
    counterparty: string;
    ceilingUsd: number;
    purpose: string;
    /** Día del mes en que vence (1-28, para no pisar meses cortos). */
    dayOfMonth: number;
    active: boolean;
}

export type OutcomeState = 'authorized' | 'held' | 'settled' | 'denied' | 'released';

export interface Outcome {
    occurrenceId: string;
    authorizationId: string;
    state: OutcomeState;
    /** Cuántas veces se le pidió a AVAL una decisión nueva para esta ocurrencia (ver recordOutcome). */
    attempt: number;
    /**
     * Denegaciones seguidas, sin ningún resultado distinto en el medio. Sube
     * en cada intento nuevo que vuelve a dar "denied", se resetea a 0 en
     * cualquier otro estado. No distingue la causa (presupuesto agotado hoy
     * vs. contraparte que nunca se va a registrar sola) — a propósito: la
     * mayoría de los motivos de denegación de AVAL son estructurales
     * (necesitan que un humano cambie algo en AVAL), no sólo el de
     * presupuesto diario, y adivinar la causa por el texto de `reasons`
     * sería frágil. Ver STUCK_THRESHOLD.
     */
    consecutiveDenials: number;
    updatedAt: string;
}

export interface DuePayment {
    occurrenceId: string;
    /**
     * La clave de idempotencia que hay que pasarle a `pay` — ya armada,
     * distinta en cada intento tras una denegación (ver listDue). No es
     * `occurrenceId` a secas: `lib/engine.ts` (`spend()`, en AVAL) cachea la
     * decisión por idempotencyKey y la repite tal cual sin volver a evaluar
     * la política — si el reintento usara la misma clave que la vez
     * denegada, AVAL devolvería "denegado" de nuevo aunque el presupuesto ya
     * se haya subido.
     */
    idempotencyKey: string;
    counterparty: string;
    ceilingUsd: number;
    purpose: string;
}

export interface PendingOutcome {
    occurrenceId: string;
    authorizationId: string;
    counterparty: string;
    purpose: string;
}

export interface StuckPayment {
    occurrenceId: string;
    counterparty: string;
    purpose: string;
    consecutiveDenials: number;
}

/**
 * A partir de cuántas denegaciones seguidas una ocurrencia deja de ofrecerse
 * en `listDue()` y pasa a `listStuck()`. Tres, no una: la primera vez puede
 * ser casualidad (el tope diario justo se llenó con otro gasto), la segunda
 * ya es un patrón, la tercera es información — alguien tiene que mirarlo.
 */
export const STUCK_THRESHOLD = 3;

interface StoreData {
    schedule: ScheduledPayment[];
    outcomes: Record<string, Outcome>;
}

const RESOLVED: ReadonlySet<OutcomeState> = new Set(['settled', 'denied', 'released']);

/** Datos de un pago programado que puede editar quien lo programa — todo menos `id`. */
export type PaymentInput = Omit<ScheduledPayment, 'id' | 'active'> & { active?: boolean };

/** Se lanza ante datos inválidos o un `id` que no corresponde — el llamador (la API admin) la traduce a 400/404. */
export class PaymentValidationError extends Error {}

function validatePaymentInput(input: PaymentInput): void {
    if (!input.counterparty.trim()) throw new PaymentValidationError('counterparty no puede estar vacío.');
    if (!input.purpose.trim()) throw new PaymentValidationError('purpose no puede estar vacío.');
    if (!Number.isFinite(input.ceilingUsd) || input.ceilingUsd <= 0) {
        throw new PaymentValidationError('ceilingUsd tiene que ser un número positivo.');
    }
    if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28) {
        throw new PaymentValidationError('dayOfMonth tiene que ser un entero entre 1 y 28 (para no pisar meses cortos).');
    }
}

/**
 * Identifica una ocurrencia concreta de un pago recurrente: el mismo pago,
 * el mismo mes. Es la clave de idempotencia que el agente pasa a `pay` — sin
 * esto, un pago mensual sólo se ejecutaría la primera vez: la clave de
 * idempotencia automática de `aval-tools` se deriva de la sesión y los
 * argumentos, y una sesión de agente autónomo es la misma entre corridas del
 * cron, así que "renta, $500, agosto" y "renta, $500, septiembre" colisionarían
 * si no llevaran esta marca de tiempo explícita.
 */
export function occurrenceIdFor(paymentId: string, when: Date): string {
    const ym = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${paymentId}:${ym}`;
}

export class PaymentsSourceStore {
    constructor(
        private readonly filePath: string,
        private readonly seed: ScheduledPayment[] = [],
    ) {}

    /**
     * Lee del disco en cada llamada — a propósito, no cachea nada entre una
     * llamada y la siguiente. El servidor MCP de pagos (proceso propio,
     * hijo del agente) y el panel admin (mismo proceso que el agente) usan
     * cada uno su propia instancia de este store contra el mismo archivo; si
     * uno cacheara en memoria, un alta desde el panel no se vería desde el
     * MCP hasta que ese proceso reiniciara. El archivo es la única fuente de
     * verdad compartida entre los dos — el costo de un `readFileSync` extra
     * por llamada es irrelevante frente a eso, dado el volumen de uso real
     * (una corrida diaria, algún clic ocasional en el panel).
     */
    private read(): StoreData {
        if (existsSync(this.filePath)) {
            try {
                return JSON.parse(readFileSync(this.filePath, 'utf-8')) as StoreData;
            } catch {
                // Fichero corrupto: se reconstruye desde la semilla en vez de tumbar el agente.
            }
        }
        return { schedule: this.seed, outcomes: {} };
    }

    /** Escritura atómica: si el proceso muere a mitad de camino, no queda un JSON truncado. */
    private write(data: StoreData): void {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
        renameSync(tmp, this.filePath);
    }

    /**
     * Pagos programados que vencen hoy o antes y conviene intentar: sin
     * ningún intento todavía, o cuyo último intento fue denegado — mientras
     * no lleve ya `STUCK_THRESHOLD` denegaciones seguidas (ver `listStuck`).
     *
     * Denegado no es terminal a propósito: AVAL pudo haber cambiado la
     * política entre corridas (más presupuesto, contraparte recién
     * registrada) y no hay ninguna razón para enterrar el pago hasta el mes
     * que viene sólo porque una vez no alcanzó. Retenido/autorizado sí se
     * excluyen de acá — esos se reconcilian con `check_payment` vía
     * listPending(), no pidiendo una decisión nueva. Liquidado/liberado son
     * los únicos de verdad terminales.
     */
    listDue(now: Date = new Date()): DuePayment[] {
        const data = this.read();
        const today = now.getUTCDate();
        return data.schedule
            .filter((p) => p.active && p.dayOfMonth <= today)
            .map((p) => ({ payment: p, occurrenceId: occurrenceIdFor(p.id, now) }))
            .filter(({ occurrenceId }) => {
                const outcome = data.outcomes[occurrenceId];
                return !outcome || (outcome.state === 'denied' && outcome.consecutiveDenials < STUCK_THRESHOLD);
            })
            .map(({ payment, occurrenceId }) => {
                const previousAttempt = data.outcomes[occurrenceId]?.attempt ?? 0;
                return {
                    occurrenceId,
                    idempotencyKey: `${occurrenceId}:${previousAttempt + 1}`,
                    counterparty: payment.counterparty,
                    ceilingUsd: payment.ceilingUsd,
                    purpose: payment.purpose,
                };
            });
    }

    /**
     * Ocurrencias que ya se intentaron pero quedaron en un estado que puede
     * cambiar (retenido o autorizado sin liquidar todavía) — lo que el agente
     * debe reconciliar con `check_payment` antes de mirar pagos nuevos.
     */
    listPending(): PendingOutcome[] {
        const data = this.read();
        return Object.values(data.outcomes)
            .filter((o) => !RESOLVED.has(o.state))
            .map((o) => {
                const paymentId = o.occurrenceId.split(':')[0];
                const payment = data.schedule.find((p) => p.id === paymentId);
                return {
                    occurrenceId: o.occurrenceId,
                    authorizationId: o.authorizationId,
                    counterparty: payment?.counterparty ?? 'desconocido',
                    purpose: payment?.purpose ?? o.occurrenceId,
                };
            });
    }

    /**
     * Ocurrencias que `listDue` dejó de ofrecer por llevar `STUCK_THRESHOLD`
     * denegaciones seguidas — el agente las reporta en el resumen de la
     * corrida en vez de seguir gastando una llamada a `pay` por día en algo
     * que no va a cambiar sin que un humano intervenga (en AVAL, o
     * desactivando/reactivando el pago acá).
     */
    listStuck(): StuckPayment[] {
        const data = this.read();
        return Object.values(data.outcomes)
            .filter((o) => o.state === 'denied' && o.consecutiveDenials >= STUCK_THRESHOLD)
            .map((o) => {
                const paymentId = o.occurrenceId.split(':')[0];
                const payment = data.schedule.find((p) => p.id === paymentId);
                return {
                    occurrenceId: o.occurrenceId,
                    counterparty: payment?.counterparty ?? 'desconocido',
                    purpose: payment?.purpose ?? o.occurrenceId,
                    consecutiveDenials: o.consecutiveDenials,
                };
            });
    }

    /**
     * Saca a un pago del estado atascado: resetea el contador de
     * denegaciones seguidas de su ocurrencia del mes actual, para que
     * `listDue` lo vuelva a ofrecer en la próxima corrida. Gesto humano
     * explícito a propósito — nada lo reactiva solo con el paso del tiempo,
     * porque un pago mal configurado (contraparte que nunca se va a
     * registrar) volvería a intentarse para siempre igual, sólo que más
     * espaciado. No hace falta arreglar la causa en AVAL antes de llamarlo:
     * si todavía no está resuelta, simplemente va a volver a denegarse y a
     * sumar de nuevo hacia `STUCK_THRESHOLD`.
     */
    reactivate(paymentId: string, now: Date = new Date()): void {
        const data = this.read();
        if (!data.schedule.some((p) => p.id === paymentId)) {
            throw new PaymentValidationError(`No existe ningún pago programado con id «${paymentId}».`);
        }
        const occurrenceId = occurrenceIdFor(paymentId, now);
        const outcome = data.outcomes[occurrenceId];
        if (!outcome) return; // nada que reactivar — listDue() ya lo estaba ofreciendo
        outcome.consecutiveDenials = 0;
        this.write(data);
    }

    /**
     * Registra o actualiza el resultado de una ocurrencia. Idempotente.
     *
     * El número de intento se deduce del `authorizationId`, no de un
     * parámetro aparte que el LLM tendría que llevar bien: si coincide con
     * el de la vez anterior, es la misma decisión de AVAL actualizándose
     * (p. ej. retenido → liquidado, vía check_payment, o una llamada
     * duplicada) y el intento no cambia. Un `authorizationId` distinto sólo
     * puede venir de una idempotencyKey nueva — la que listDue() entrega
     * después de una denegación — así que ahí sí es un intento nuevo.
     */
    recordOutcome(occurrenceId: string, authorizationId: string, state: OutcomeState): void {
        const data = this.read();
        const previous = data.outcomes[occurrenceId];
        const isNewAttempt = !previous || previous.authorizationId !== authorizationId;
        const attempt = isNewAttempt ? (previous?.attempt ?? 0) + 1 : previous.attempt;
        // Sólo un intento nuevo mueve el contador — reconciliar el mismo
        // intento (mismo authorizationId, p. ej. held → settled, o una
        // llamada duplicada) no debe ni sumar ni resetear.
        const consecutiveDenials = !isNewAttempt
            ? (previous?.consecutiveDenials ?? 0)
            : state === 'denied'
              ? (previous?.consecutiveDenials ?? 0) + 1
              : 0;
        data.outcomes[occurrenceId] = {
            occurrenceId,
            authorizationId,
            state,
            attempt,
            consecutiveDenials,
            updatedAt: new Date().toISOString(),
        };
        this.write(data);
    }

    /** El calendario completo, tal como lo vería un panel de administración. */
    listSchedule(): ScheduledPayment[] {
        return [...this.read().schedule];
    }

    /**
     * Todos los resultados registrados, del más reciente al más antiguo —
     * para un historial legible en un panel, no para que el agente decida
     * nada (eso sigue siendo `listDue`/`listPending`).
     */
    listOutcomes(): Outcome[] {
        return Object.values(this.read().outcomes).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    /** Da de alta un pago programado nuevo. `id` debe ser único — es la raíz del `occurrenceId` de cada mes. */
    addPayment(id: string, input: PaymentInput): ScheduledPayment {
        if (!id.trim()) throw new PaymentValidationError('id no puede estar vacío.');
        const data = this.read();
        if (data.schedule.some((p) => p.id === id)) {
            throw new PaymentValidationError(`Ya existe un pago programado con id «${id}».`);
        }
        validatePaymentInput(input);
        const payment: ScheduledPayment = { id, active: true, ...input };
        data.schedule.push(payment);
        this.write(data);
        return payment;
    }

    /**
     * Modifica un pago programado existente. Un cambio de `ceilingUsd`,
     * `counterparty` o `dayOfMonth` no toca ninguna ocurrencia ya
     * registrada — sólo afecta qué pide `listDue` de ahí en adelante.
     */
    updatePayment(id: string, patch: Partial<PaymentInput>): ScheduledPayment {
        const data = this.read();
        const index = data.schedule.findIndex((p) => p.id === id);
        if (index === -1) throw new PaymentValidationError(`No existe ningún pago programado con id «${id}».`);
        const updated: ScheduledPayment = { ...data.schedule[index], ...patch };
        validatePaymentInput(updated);
        data.schedule[index] = updated;
        this.write(data);
        return updated;
    }

    /**
     * Da de baja un pago programado. No borra sus `outcomes` — el historial
     * de lo que ya se intentó o pagó es un hecho pasado, no algo que
     * desaparezca porque el pago dejó de programarse.
     */
    removePayment(id: string): void {
        const data = this.read();
        const index = data.schedule.findIndex((p) => p.id === id);
        if (index === -1) throw new PaymentValidationError(`No existe ningún pago programado con id «${id}».`);
        data.schedule.splice(index, 1);
        this.write(data);
    }

    /** Sólo para pruebas y semillas. */
    all(): StoreData {
        return this.read();
    }
}
