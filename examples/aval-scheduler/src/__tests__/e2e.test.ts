import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';
import { buildSchedulerAgent, stopSchedulerAgent } from '../agent';
import { occurrenceIdFor } from '../mcp-payments-source/store';
import { startAvalSim } from './aval-sim';

/**
 * El agente completo, sin red ni dinero: el servidor MCP del calendario es el de verdad (un proceso hijo),
 * AVAL es un simulador local, y el modelo sigue un guion. Lo que se comprueba es lo que importa de un
 * agente que paga: que paga UNA vez, que lo registra, y que la corrida siguiente reconcilia en vez de
 * volver a pagar.
 *
 * Necesita `dist/` (el hijo de Node no ejecuta TypeScript): `npm test` lo compila antes (`pretest`).
 */
const KEY = 'aval_sk_abc123_secreto';
const SERVER = join(__dirname, '..', '..', 'dist', 'mcp-payments-source', 'server.js');
const T = 'mcp__payments-source__';

describe('aval-scheduler — de punta a punta', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'scheduler-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('paga una vez, lo registra, y la corrida siguiente reconcilia sin volver a pagar', async () => {
        const aval = await startAvalSim(KEY);
        const sourcePath = join(dir, 'schedule.json');
        writeFileSync(sourcePath, JSON.stringify({
            schedule: [{ id: 'renta', counterparty: 'ocr.docs', ceilingUsd: 0.5, purpose: 'Renta de oficina', dayOfMonth: 1, active: true }],
            outcomes: {},
        }));
        const occurrenceId = occurrenceIdFor('renta', new Date());

        const call = (name: string, args: Record<string, unknown>, id: string) => ({ tool_calls: [{ id, name, args }] });
        const provider = scriptedProvider([
            // Corrida 1: nada pendiente, un pago vencido.
            call(`${T}list_pending_confirmations`, {}, 'a1'),
            call(`${T}list_due_payments`, {}, 'a2'),
            call('pay', { counterparty: 'ocr.docs', ceilingUsd: 0.5, purpose: 'Renta de oficina', idempotencyKey: `${occurrenceId}:1` }, 'a3'),
            call(`${T}record_payment_outcome`, { occurrenceId, authorizationId: 'auth_1', state: 'authorized' }, 'a4'),
            call(`${T}list_stuck_payments`, {}, 'a5'),
            { content: 'Se autorizó 1 pago.' },
            // Corrida 2: lo autorizado pasa a pendiente de reconciliar; ya no hay nada vencido.
            call(`${T}list_pending_confirmations`, {}, 'b1'),
            call('check_payment', { authorizationId: 'auth_1' }, 'b2'),
            call(`${T}record_payment_outcome`, { occurrenceId, authorizationId: 'auth_1', state: 'settled' }, 'b3'),
            call(`${T}list_due_payments`, {}, 'b4'),
            call(`${T}list_stuck_payments`, {}, 'b5'),
            { content: 'Se liquidó 1 pago. Nada más pendiente.' },
        ]);

        const t = mockTransport();
        const agent = buildSchedulerAgent({
            providers: { mock: provider }, defaultProvider: 'mock',
            avalUrl: aval.url, avalKey: KEY, actsFor: 'test-operator',
            transport: t.transport,
            paymentsSourcePath: sourcePath, paymentsServerEntry: SERVER,
        });

        try {
            const first = await agent.engine.run('Ejecuta la corrida de pagos programados de hoy.');
            expect(first.errors).toEqual([]);
            expect(first.toolCalls.map(c => `${c.name}:${c.success}`)).toEqual([
                `${T}list_pending_confirmations:true`, `${T}list_due_payments:true`, 'pay:true',
                `${T}record_payment_outcome:true`, `${T}list_stuck_payments:true`,
            ]);
            // AVAL aceptó UN gasto, con la clave de idempotencia que entregó el origen (sin modificarla).
            expect(aval.spends).toHaveLength(1);
            expect(aval.spends[0].idempotencyKey).toBe(`${occurrenceId}:1`);
            expect(aval.spends[0].ceiling).toBe(500_000);
            // El origen recordó el resultado.
            let outcomes = JSON.parse(readFileSync(sourcePath, 'utf-8')).outcomes;
            expect(outcomes[occurrenceId].state).toBe('authorized');

            aval.settle('auth_1'); // pasa el tiempo: el carril liquida

            const second = await agent.engine.run('Ejecuta la corrida de pagos programados de hoy.');
            expect(second.errors).toEqual([]);
            expect(second.toolCalls.map(c => c.name)).toContain('check_payment');
            // La segunda corrida no pagó otra vez.
            expect(aval.spends).toHaveLength(1);
            outcomes = JSON.parse(readFileSync(sourcePath, 'utf-8')).outcomes;
            expect(outcomes[occurrenceId].state).toBe('settled');
        } finally {
            await stopSchedulerAgent(agent);
            await aval.close();
        }
    }, 60_000);

    it('arranca con un trigger de cron y se apaga sin dejar el servidor MCP vivo', async () => {
        const aval = await startAvalSim(KEY);
        const sourcePath = join(dir, 'schedule.json');
        writeFileSync(sourcePath, JSON.stringify({ schedule: [], outcomes: {} }));
        const agent = buildSchedulerAgent({
            providers: { mock: scriptedProvider([{ content: 'nada que hacer' }]) }, defaultProvider: 'mock',
            avalUrl: aval.url, avalKey: KEY, actsFor: 'test-operator', transport: mockTransport().transport,
            paymentsSourcePath: sourcePath, paymentsServerEntry: SERVER,
            // El cron es una dependencia opcional del framework: si falta, start() falla aquí.
            triggers: [{ type: 'schedule', cron: '0 9 * * *', task: 'Ejecuta la corrida de pagos programados de hoy.' }],
        });
        try {
            await expect(agent.start()).resolves.toBeUndefined();
        } finally {
            await stopSchedulerAgent(agent);
            await aval.close();
        }
    }, 30_000);
});
