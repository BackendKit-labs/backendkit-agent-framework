import { createPayTool } from '../pay';
import type { ExecutionContext } from '@backendkit-labs/agent-core';

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
    return {
        agentId: 'expedientes-bot',
        sessionId: 'session-1',
        memory: { get: () => undefined, set: () => undefined, getAll: () => ({}) },
        askAgent: async () => '',
        ...overrides,
    };
}

function jsonResponse(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

const config = { baseUrl: 'https://aval.test' };
const pay = createPayTool(config);

beforeEach(() => {
    global.fetch = jest.fn();
});

describe('pay', () => {
    it('rejects without touching the network when the agent has no AVAL credential', async () => {
        const result = await pay.execute(
            { counterparty: 'ocr.docs', ceilingUsd: 0.3, purpose: 'test' },
            makeCtx(),
        );
        expect(result).toMatch(/no tiene credencial de AVAL/);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('sends the ceiling in micro-dollars and a bearer token from ctx.secrets', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(
            jsonResponse(200, {
                decision: 'authorized',
                authorizationId: 'auth_1',
                rail: 'proxy',
                reasons: [],
                capability: {
                    rail: 'proxy',
                    kind: 'respuesta',
                    actual: 280000,
                    payment: { rail: 'proxy', asset: 'USD', nativeAmount: 280000, rate: 1, ref: 'req_abc' },
                },
            }),
        );

        await pay.execute(
            { counterparty: 'ocr.docs', ceilingUsd: 0.3, purpose: 'Lectura del pedimento' },
            makeCtx({ secrets: { AVAL_KEY: 'aval_sk_test_secret' } }),
        );

        const [url, init] = (fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('https://aval.test/api/v1/spend');
        expect(init.headers.authorization).toBe('Bearer aval_sk_test_secret');
        const body = JSON.parse(init.body);
        expect(body.ceiling).toBe(300000); // $0.30 → 300000 micro-dollars
        expect(body.counterparty).toBe('ocr.docs');
        expect(typeof body.idempotencyKey).toBe('string');
    });

    it('derives the same idempotency key for the same session and args, a different one for different args', async () => {
        (fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { decision: 'denied', reasons: [] }));
        const ctx = makeCtx({ secrets: { AVAL_KEY: 'k' } });

        await pay.execute({ counterparty: 'ocr.docs', ceilingUsd: 0.3, purpose: 'A' }, ctx);
        await pay.execute({ counterparty: 'ocr.docs', ceilingUsd: 0.3, purpose: 'A' }, ctx);
        await pay.execute({ counterparty: 'ocr.docs', ceilingUsd: 0.31, purpose: 'A' }, ctx);

        const keys = (fetch as jest.Mock).mock.calls.map(([, init]) => JSON.parse(init.body).idempotencyKey);
        expect(keys[0]).toBe(keys[1]);
        expect(keys[0]).not.toBe(keys[2]);
    });

    it('under an engine: the same call in one run is a replay, the same call in another run is a new payment (audit C-04)', async () => {
        (fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { decision: 'denied', reasons: [] }));
        const args = { counterparty: 'ocr.docs', ceilingUsd: 0.3, purpose: 'Lectura del pedimento' };
        // The engine gives the same key to a call repeated in a run, and another one in the next run.
        await pay.execute(args, makeCtx({ secrets: { AVAL_KEY: 'k' }, idempotencyKey: 'run1:agent:pay:args' }));
        await pay.execute(args, makeCtx({ secrets: { AVAL_KEY: 'k' }, idempotencyKey: 'run1:agent:pay:args' }));
        await pay.execute(args, makeCtx({ secrets: { AVAL_KEY: 'k' }, idempotencyKey: 'run2:agent:pay:args' }));
        const keys = (fetch as jest.Mock).mock.calls.map(([, init]) => JSON.parse(init.body).idempotencyKey);
        expect(keys[0]).toBe(keys[1]);
        expect(keys[2]).not.toBe(keys[0]);
    });

    it('reports a held spend without claiming money moved', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(
            jsonResponse(200, {
                decision: 'held',
                authorizationId: 'auth_2',
                reasons: ['$0,70 supera el umbral de $0,60: requiere aprobación de María Restrepo.'],
            }),
        );
        const result = await pay.execute(
            { counterparty: 'tarifas.aduana', ceilingUsd: 0.7, purpose: 'Padrón' },
            makeCtx({ secrets: { AVAL_KEY: 'k' } }),
        );
        expect(result).toMatch(/Retenido/);
        expect(result).toMatch(/auth_2/);
        expect(result).toMatch(/check_payment/);
        expect(result).not.toMatch(/Pagado/);
    });

    it('surfaces the denial reason instead of a raw error', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(
            jsonResponse(200, { decision: 'denied', reasons: ['$0,90 supera el tope por operación de $0,80.'] }),
        );
        const result = await pay.execute(
            { counterparty: 'tarifas.aduana', ceilingUsd: 0.9, purpose: 'Descarga' },
            makeCtx({ secrets: { AVAL_KEY: 'k' } }),
        );
        expect(result).toMatch(/Denegado/);
        expect(result).toMatch(/tope por operación/);
    });

    it('surfaces the remaining budget on every decision, not just authorized', async () => {
        (fetch as jest.Mock)
            .mockResolvedValueOnce(
                jsonResponse(200, {
                    decision: 'denied',
                    reasons: ['$0,90 supera el tope por operación de $0,80.'],
                    budget: { remainingToday: 2_500_000, remainingTotal: 39_000_000 },
                }),
            )
            .mockResolvedValueOnce(
                jsonResponse(200, {
                    decision: 'authorized',
                    authorizationId: 'auth_9',
                    rail: 'proxy',
                    reasons: [],
                    amount: 300000,
                    budget: { remainingToday: 1_000_000, remainingTotal: 20_000_000 },
                }),
            );
        const ctx = makeCtx({ secrets: { AVAL_KEY: 'k' } });

        const denied = await pay.execute({ counterparty: 'tarifas.aduana', ceilingUsd: 0.9, purpose: 'x' }, ctx);
        expect(denied).toMatch(/Presupuesto restante: \$2\.50 hoy, \$39\.00 en total\./);

        const authorized = await pay.execute({ counterparty: 'ocr.docs', ceilingUsd: 0.3, purpose: 'y' }, ctx);
        expect(authorized).toMatch(/Presupuesto restante: \$1\.00 hoy, \$20\.00 en total\./);
    });

    it('omits the budget line when AVAL does not send one', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, { decision: 'denied', reasons: ['x'] }));
        const result = await pay.execute(
            { counterparty: 'ocr.docs', ceilingUsd: 0.1, purpose: 'x' },
            makeCtx({ secrets: { AVAL_KEY: 'k' } }),
        );
        expect(result).not.toMatch(/Presupuesto/);
    });

    it('surfaces rate limiting with the retry window', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(
            jsonResponse(429, { error: 'Demasiados intentos.', retryAfterSeconds: 57 }),
        );
        const result = await pay.execute(
            { counterparty: 'ocr.docs', ceilingUsd: 0.1, purpose: 'x' },
            makeCtx({ secrets: { AVAL_KEY: 'k' } }),
        );
        expect(result).toMatch(/57 s/);
    });
});
