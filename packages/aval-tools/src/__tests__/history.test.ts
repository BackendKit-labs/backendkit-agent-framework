import { createHistoryTool } from '../history';
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
const history = createHistoryTool(config);

beforeEach(() => {
    global.fetch = jest.fn();
});

describe('list_own_history', () => {
    it('requires a credential before calling out', async () => {
        const result = await history.execute({}, makeCtx());
        expect(result).toMatch(/no tiene credencial de AVAL/);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('requests the default limit when none is given', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, { entries: [] }));
        await history.execute({}, makeCtx({ secrets: { AVAL_KEY: 'k' } }));
        const [url] = (fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('https://aval.test/api/v1/history?limit=20');
    });

    it('passes a custom limit through', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, { entries: [] }));
        await history.execute({ limit: 5 }, makeCtx({ secrets: { AVAL_KEY: 'k' } }));
        const [url] = (fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('https://aval.test/api/v1/history?limit=5');
    });

    it('says so plainly when there is no history yet', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, { entries: [] }));
        const result = await history.execute({}, makeCtx({ secrets: { AVAL_KEY: 'k' } }));
        expect(result).toMatch(/Sin historial todavía/);
    });

    it('formats entries with amount, vendor, purpose and the first reason', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(
            jsonResponse(200, {
                entries: [
                    {
                        seq: 4,
                        ts: '2026-08-07T00:00:00.000Z',
                        type: 'spend.authorized',
                        amount: 300000,
                        asset: 'USD',
                        vendor: 'ocr.docs',
                        purpose: 'Lectura del pedimento A-1190',
                        reasons: ['Dentro de los tres topes: operación, día y total.'],
                    },
                ],
            }),
        );
        const result = await history.execute({}, makeCtx({ secrets: { AVAL_KEY: 'k' } }));
        expect(result).toMatch(/#4/);
        expect(result).toMatch(/\$0\.30/);
        expect(result).toMatch(/ocr\.docs/);
        expect(result).toMatch(/Lectura del pedimento A-1190/);
        expect(result).toMatch(/Dentro de los tres topes/);
    });

    it('reports credential errors instead of a raw error', async () => {
        (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(401, { error: 'Credencial revocada.' }));
        const result = await history.execute({}, makeCtx({ secrets: { AVAL_KEY: 'k' } }));
        expect(result).toMatch(/Error de credencial/);
    });
});
