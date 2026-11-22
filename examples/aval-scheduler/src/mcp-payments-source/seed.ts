import type { ScheduledPayment } from './store';

/**
 * Datos de ejemplo para probar el agente sin conectar un origen real.
 * Sustituir por lo que sea que lea de verdad — este fichero es el único
 * lugar donde importa que hoy es una lista fija en código.
 *
 * Los cuatro de abajo son la prueba de control agente↔AVAL: mismo agente,
 * misma política, cuatro montos elegidos a propósito para que cada uno
 * dispare una decisión distinta. Sólo el primero arranca `active: true` — los
 * demás se activan a mano, uno por vez, editando directamente
 * `~/.aval-scheduler/schedule.json` (una vez que existe, manda él, no esta
 * semilla) y reiniciando el agente para que la vuelva a leer.
 *
 * La política que se dio de alta en AVAL para esta prueba: asset USD,
 * perCallMax $2,00, dailyMax $2,50, approvalAbove $1,00,
 * allowedVendors ["ocr.docs", "llm.inference"], allowedRails ["proxy"].
 */
export const SEED_SCHEDULE: ScheduledPayment[] = [
    {
        id: 'prueba-auth',
        counterparty: 'ocr.docs',
        ceilingUsd: 0.5,
        purpose: 'Prueba de control — dentro de los tres topes',
        dayOfMonth: 1,
        active: true,
    },
    {
        // > approvalAbove ($1,00) y <= perCallMax ($2,00): queda retenido.
        id: 'prueba-retenido',
        counterparty: 'llm.inference',
        ceilingUsd: 1.5,
        purpose: 'Prueba de control — retenido para aprobación humana',
        dayOfMonth: 1,
        active: false,
    },
    {
        // sms.gateway no está en allowedVendors: se deniega antes de mirar presupuesto.
        id: 'prueba-vendor',
        counterparty: 'sms.gateway',
        ceilingUsd: 0.3,
        purpose: 'Prueba de control — proveedor no permitido',
        dayOfMonth: 1,
        active: false,
    },
    {
        // Tras los dos anteriores el agente ya lleva $2,00 comprometidos hoy;
        // $0,75 más supera el dailyMax de $2,50.
        id: 'prueba-tope',
        counterparty: 'ocr.docs',
        ceilingUsd: 0.75,
        purpose: 'Prueba de control — tope diario superado',
        dayOfMonth: 1,
        active: false,
    },
];
