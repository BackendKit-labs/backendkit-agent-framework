import { createCheckPaymentTool } from '../check-payment';
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
const checkPayment = createCheckPaymentTool(config);

beforeEach(() => {
    global.fetch = jest.fn();
});

describe('check_payment', () => {
    it('requires a credential before calling out', async () => {
        const result = await checkPayment.execute({ authorizationId: 'auth_1' }, makeCtx());
        expect(result).toMatch(/no tiene credencial de AVAL/);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('reports a resolved (settled) authorization', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(
            jsonResponse(200, {
                authorizationId: 'auth_2',
                state: 'settled',
                amount: 589500,
                vendor: 'tarifas.aduana',
                purpose: 'Padrón arancelario completo — trimestre',
                rail: 'proxy',
                reasons: ['Pagado por proxy: $0,5895.'],
                createdAt: '2026-08-07T00:00:00.000Z',
            }),
        );
        const result = await checkPayment.execute(
            { authorizationId: 'auth_2' },
            makeCtx({ secrets: { AVAL_KEY: 'k' } }),
        );
        expect(result).toMatch(/liquidado/);
        expect(result).toMatch(/\$0\.5895/); // 589500 micro-dollars, shown to sub-cent precision
        expect(result).toMatch(/tarifas\.aduana/);
    });

    it('still shows "held" while nobody has decided yet', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(
            jsonResponse(200, {
                authorizationId: 'auth_3',
                state: 'held',
                amount: 700000,
                vendor: 'tarifas.aduana',
                purpose: 'Actualización trimestral',
                rail: 'proxy',
                reasons: [],
                createdAt: '2026-08-07T00:00:00.000Z',
            }),
        );
        const result = await checkPayment.execute(
            { authorizationId: 'auth_3' },
            makeCtx({ secrets: { AVAL_KEY: 'k' } }),
        );
        expect(result).toMatch(/retenido/);
        expect(result).toMatch(/todavía no se gastó nada/);
    });

    it('reports 404 as a plain not-found message, not a raw error', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(404, { error: 'No existe la autorización.' }));
        const result = await checkPayment.execute(
            { authorizationId: 'auth_ghost' },
            makeCtx({ secrets: { AVAL_KEY: 'k' } }),
        );
        expect(result).toMatch(/No existe/);
    });

    it('reports 403 as an ownership message when the authorization is not this agent\'s', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(403, { error: 'no es de este agente' }));
        const result = await checkPayment.execute(
            { authorizationId: 'auth_other' },
            makeCtx({ secrets: { AVAL_KEY: 'k' } }),
        );
        expect(result).toMatch(/no pertenece a este agente/);
    });
});
