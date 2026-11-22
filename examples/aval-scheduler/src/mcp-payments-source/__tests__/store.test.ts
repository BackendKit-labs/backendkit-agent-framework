import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PaymentsSourceStore, PaymentValidationError, STUCK_THRESHOLD, occurrenceIdFor, type ScheduledPayment } from '../store';

function makeDir(): string {
    return mkdtempSync(join(tmpdir(), `aval-scheduler-${randomUUID()}-`));
}

const rent: ScheduledPayment = {
    id: 'renta-oficina',
    counterparty: 'inmobiliaria.co',
    ceilingUsd: 500,
    purpose: 'Renta de oficina',
    dayOfMonth: 5,
    active: true,
};

describe('occurrenceIdFor', () => {
    it('es la misma para el mismo mes y distinta entre meses', () => {
        const a = occurrenceIdFor('renta-oficina', new Date(Date.UTC(2026, 7, 3)));
        const b = occurrenceIdFor('renta-oficina', new Date(Date.UTC(2026, 7, 20)));
        const c = occurrenceIdFor('renta-oficina', new Date(Date.UTC(2026, 8, 3)));
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });
});

describe('PaymentsSourceStore', () => {
    let dir: string;
    beforeEach(() => { dir = makeDir(); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('no lista un pago antes de su día de vencimiento', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const due = store.listDue(new Date(Date.UTC(2026, 7, 3))); // día 3, vence el 5
        expect(due).toEqual([]);
    });

    it('lo lista el día de vencimiento y después', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        expect(store.listDue(new Date(Date.UTC(2026, 7, 5)))).toHaveLength(1);
        expect(store.listDue(new Date(Date.UTC(2026, 7, 20)))).toHaveLength(1);
    });

    it('ignora los pagos inactivos', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [{ ...rent, active: false }]);
        expect(store.listDue(new Date(Date.UTC(2026, 7, 20)))).toEqual([]);
    });

    it('un pago liquidado no vuelve a aparecer como debido ese mismo mes', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const now = new Date(Date.UTC(2026, 7, 5));
        const [due] = store.listDue(now);
        store.recordOutcome(due.occurrenceId, 'auth_1', 'settled');
        expect(store.listDue(now)).toEqual([]);
    });

    it('el mes siguiente vuelve a aparecer, con otro occurrenceId', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const august = new Date(Date.UTC(2026, 7, 5));
        const [due] = store.listDue(august);
        store.recordOutcome(due.occurrenceId, 'auth_1', 'settled');

        const september = new Date(Date.UTC(2026, 8, 5));
        const [dueAgain] = store.listDue(september);
        expect(dueAgain).toBeDefined();
        expect(dueAgain.occurrenceId).not.toBe(due.occurrenceId);
    });

    it('un pago retenido no vuelve a listDue, pero sí a listPending', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const now = new Date(Date.UTC(2026, 7, 5));
        const [due] = store.listDue(now);
        store.recordOutcome(due.occurrenceId, 'auth_1', 'held');

        expect(store.listDue(now)).toEqual([]);
        const pending = store.listPending();
        expect(pending).toHaveLength(1);
        expect(pending[0].authorizationId).toBe('auth_1');
    });

    it('un pago resuelto (denegado o liberado) sale de listPending', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const now = new Date(Date.UTC(2026, 7, 5));
        const [due] = store.listDue(now);
        store.recordOutcome(due.occurrenceId, 'auth_1', 'held');
        store.recordOutcome(due.occurrenceId, 'auth_1', 'released');
        expect(store.listPending()).toEqual([]);
    });

    it('recordOutcome es idempotente: registrar dos veces el mismo estado no duplica nada', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const now = new Date(Date.UTC(2026, 7, 5));
        const [due] = store.listDue(now);
        store.recordOutcome(due.occurrenceId, 'auth_1', 'held');
        store.recordOutcome(due.occurrenceId, 'auth_1', 'held');
        expect(store.listPending()).toHaveLength(1);
    });

    it('persiste entre instancias (sobrevive un reinicio del proceso)', () => {
        const file = join(dir, 's.json');
        const now = new Date(Date.UTC(2026, 7, 5));
        const a = new PaymentsSourceStore(file, [rent]);
        const [due] = a.listDue(now);
        a.recordOutcome(due.occurrenceId, 'auth_1', 'settled');

        const b = new PaymentsSourceStore(file, [rent]); // misma ruta, semilla ignorada porque el archivo ya existe
        expect(b.listDue(now)).toEqual([]);
    });

    it('un archivo corrupto no tumba el store: arranca desde la semilla', () => {
        const file = join(dir, 's.json');
        writeFileSync(file, '{ esto no es json', 'utf-8');
        const store = new PaymentsSourceStore(file, [rent]);
        expect(store.listDue(new Date(Date.UTC(2026, 7, 20)))).toHaveLength(1);
    });

    it('un pago denegado vuelve a aparecer en listDue con un idempotencyKey distinto', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const now = new Date(Date.UTC(2026, 7, 5));
        const [due] = store.listDue(now);
        store.recordOutcome(due.occurrenceId, 'auth_1', 'denied');

        const [dueAgain] = store.listDue(now);
        expect(dueAgain).toBeDefined();
        expect(dueAgain.occurrenceId).toBe(due.occurrenceId);
        expect(dueAgain.idempotencyKey).not.toBe(due.idempotencyKey);
    });

    it('liquidado, retenido o liberado no vuelven a aparecer en listDue', () => {
        const now = new Date(Date.UTC(2026, 7, 5));

        for (const state of ['settled', 'held', 'released'] as const) {
            const store = new PaymentsSourceStore(join(dir, `${state}.json`), [rent]);
            const [due] = store.listDue(now);
            store.recordOutcome(due.occurrenceId, 'auth_1', state);
            expect(store.listDue(now)).toEqual([]);
        }
    });

    it('autorizado tampoco vuelve a listDue: se reconcilia por listPending, no por un intento nuevo', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const now = new Date(Date.UTC(2026, 7, 5));
        const [due] = store.listDue(now);
        store.recordOutcome(due.occurrenceId, 'auth_1', 'authorized');
        expect(store.listDue(now)).toEqual([]);
    });

    it('dos denegaciones seguidas producen tres idempotencyKeys distintos entre sí', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const now = new Date(Date.UTC(2026, 7, 5));

        const [first] = store.listDue(now);
        store.recordOutcome(first.occurrenceId, 'auth_1', 'denied');

        const [second] = store.listDue(now);
        store.recordOutcome(second.occurrenceId, 'auth_2', 'denied');

        const [third] = store.listDue(now);

        const keys = new Set([first.idempotencyKey, second.idempotencyKey, third.idempotencyKey]);
        expect(keys.size).toBe(3);
    });

    it('registrar el mismo authorizationId otra vez no avanza el número de intento', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const now = new Date(Date.UTC(2026, 7, 5));

        const [first] = store.listDue(now);
        store.recordOutcome(first.occurrenceId, 'auth_1', 'denied');

        const [second] = store.listDue(now);
        expect(second.idempotencyKey).toBe(`${first.occurrenceId}:2`);

        // Misma authorizationId que la vez anterior: es una actualización del
        // mismo intento (p.ej. una llamada duplicada), no una decisión nueva
        // de AVAL — el número de intento no debe avanzar.
        store.recordOutcome(first.occurrenceId, 'auth_1', 'denied');

        const [third] = store.listDue(now);
        expect(third.idempotencyKey).toBe(`${first.occurrenceId}:2`);
    });
});

describe('PaymentsSourceStore — CRUD del calendario', () => {
    let dir: string;
    beforeEach(() => { dir = makeDir(); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('addPayment da de alta y aparece en listSchedule', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), []);
        const created = store.addPayment('luz-oficina', {
            counterparty: 'electrica.co',
            ceilingUsd: 80,
            purpose: 'Luz de oficina',
            dayOfMonth: 10,
        });
        expect(created).toEqual({ id: 'luz-oficina', active: true, counterparty: 'electrica.co', ceilingUsd: 80, purpose: 'Luz de oficina', dayOfMonth: 10 });
        expect(store.listSchedule()).toEqual([created]);
    });

    it('addPayment rechaza un id duplicado', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        expect(() =>
            store.addPayment('renta-oficina', { counterparty: 'x', ceilingUsd: 1, purpose: 'x', dayOfMonth: 1 }),
        ).toThrow(PaymentValidationError);
    });

    it.each([
        ['ceilingUsd no positivo', { counterparty: 'x', ceilingUsd: 0, purpose: 'x', dayOfMonth: 1 }],
        ['dayOfMonth fuera de 1-28', { counterparty: 'x', ceilingUsd: 1, purpose: 'x', dayOfMonth: 29 }],
        ['counterparty vacío', { counterparty: '  ', ceilingUsd: 1, purpose: 'x', dayOfMonth: 1 }],
        ['purpose vacío', { counterparty: 'x', ceilingUsd: 1, purpose: '  ', dayOfMonth: 1 }],
    ])('addPayment rechaza: %s', (_label, input) => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), []);
        expect(() => store.addPayment('nuevo', input)).toThrow(PaymentValidationError);
        expect(store.listSchedule()).toEqual([]);
    });

    it('updatePayment modifica sólo los campos dados y persiste', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const updated = store.updatePayment('renta-oficina', { ceilingUsd: 550 });
        expect(updated.ceilingUsd).toBe(550);
        expect(updated.counterparty).toBe(rent.counterparty);

        const reloaded = new PaymentsSourceStore(join(dir, 's.json'), []);
        expect(reloaded.listSchedule()).toEqual([updated]);
    });

    it('updatePayment sobre un id inexistente lanza PaymentValidationError', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        expect(() => store.updatePayment('no-existe', { ceilingUsd: 1 })).toThrow(PaymentValidationError);
    });

    it('updatePayment valida el resultado combinado, no sólo el patch', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        expect(() => store.updatePayment('renta-oficina', { ceilingUsd: -5 })).toThrow(PaymentValidationError);
        // No debe haber quedado a medio actualizar.
        expect(store.listSchedule()[0]).toEqual(rent);
    });

    it('removePayment lo saca del calendario pero no toca sus outcomes', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const now = new Date(Date.UTC(2026, 7, 5));
        const [due] = store.listDue(now);
        store.recordOutcome(due.occurrenceId, 'auth_1', 'settled');

        store.removePayment('renta-oficina');

        expect(store.listSchedule()).toEqual([]);
        expect(store.listOutcomes()).toHaveLength(1);
    });

    it('removePayment sobre un id inexistente lanza PaymentValidationError', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), []);
        expect(() => store.removePayment('fantasma')).toThrow(PaymentValidationError);
    });

    it('listOutcomes ordena del más reciente al más antiguo', async () => {
        const luz: ScheduledPayment = { id: 'luz-oficina', counterparty: 'electrica.co', ceilingUsd: 80, purpose: 'Luz', dayOfMonth: 5, active: true };
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent, luz]);
        const now = new Date(Date.UTC(2026, 7, 5));
        const [dueA, dueB] = store.listDue(now);
        store.recordOutcome(dueA.occurrenceId, 'auth_1', 'settled');
        // updatedAt es Date.now(): un tick real entre registros para que el
        // orden no dependa de que dos timestamps caigan en el mismo milisegundo.
        await new Promise((resolve) => setTimeout(resolve, 5));
        store.recordOutcome(dueB.occurrenceId, 'auth_2', 'settled');

        const outcomes = store.listOutcomes();
        expect(outcomes).toHaveLength(2);
        expect(outcomes[0].occurrenceId).toBe(dueB.occurrenceId);
        expect(outcomes[1].occurrenceId).toBe(dueA.occurrenceId);
    });
});

describe('PaymentsSourceStore — freno por denegaciones seguidas (atascado)', () => {
    let dir: string;
    beforeEach(() => { dir = makeDir(); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    /** Deniega `n` veces seguidas la única ocurrencia debida y devuelve el store. */
    function denyNTimes(n: number, now: Date): PaymentsSourceStore {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        for (let i = 0; i < n; i++) {
            const [due] = store.listDue(now);
            store.recordOutcome(due.occurrenceId, `auth_${i}`, 'denied');
        }
        return store;
    }

    it(`sigue en listDue por debajo de STUCK_THRESHOLD (${STUCK_THRESHOLD})`, () => {
        const now = new Date(Date.UTC(2026, 7, 5));
        const store = denyNTimes(STUCK_THRESHOLD - 1, now);
        expect(store.listDue(now)).toHaveLength(1);
        expect(store.listStuck()).toEqual([]);
    });

    it(`al llegar a STUCK_THRESHOLD (${STUCK_THRESHOLD}) sale de listDue y entra a listStuck`, () => {
        const now = new Date(Date.UTC(2026, 7, 5));
        const store = denyNTimes(STUCK_THRESHOLD, now);

        expect(store.listDue(now)).toEqual([]);
        const stuck = store.listStuck();
        expect(stuck).toHaveLength(1);
        expect(stuck[0].counterparty).toBe(rent.counterparty);
        expect(stuck[0].consecutiveDenials).toBe(STUCK_THRESHOLD);
    });

    it('un resultado distinto de denied resetea la racha almacenada, aunque venía cerca del umbral', () => {
        const now = new Date(Date.UTC(2026, 7, 5));
        const store = denyNTimes(STUCK_THRESHOLD - 1, now); // a un paso de quedar atascado

        const [due] = store.listDue(now);
        store.recordOutcome(due.occurrenceId, 'auth_authorized', 'authorized'); // se resolvió: el tope se subió

        expect(store.all().outcomes[due.occurrenceId].consecutiveDenials).toBe(0);
        expect(store.listStuck()).toEqual([]);
    });

    it('reconciliar el mismo intento (mismo authorizationId) no suma ni resetea el contador', () => {
        const now = new Date(Date.UTC(2026, 7, 5));
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        const [due] = store.listDue(now);
        store.recordOutcome(due.occurrenceId, 'auth_1', 'denied');
        store.recordOutcome(due.occurrenceId, 'auth_1', 'denied'); // llamada duplicada, misma auth

        const [dueAgain] = store.listDue(now);
        // Si la duplicada hubiera sumado, el próximo idempotencyKey sería :3 en vez de :2.
        expect(dueAgain.idempotencyKey).toBe(`${due.occurrenceId}:2`);
    });

    it('reactivate resetea el contador y listDue lo vuelve a ofrecer', () => {
        const now = new Date(Date.UTC(2026, 7, 5));
        const store = denyNTimes(STUCK_THRESHOLD, now);
        expect(store.listDue(now)).toEqual([]);

        store.reactivate('renta-oficina', now);

        expect(store.listStuck()).toEqual([]);
        expect(store.listDue(now)).toHaveLength(1);
    });

    it('reactivate sobre un id inexistente lanza PaymentValidationError', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        expect(() => store.reactivate('fantasma')).toThrow(PaymentValidationError);
    });

    it('reactivate sobre un pago sin ninguna ocurrencia registrada no hace nada (no revienta)', () => {
        const store = new PaymentsSourceStore(join(dir, 's.json'), [rent]);
        expect(() => store.reactivate('renta-oficina')).not.toThrow();
    });
});
