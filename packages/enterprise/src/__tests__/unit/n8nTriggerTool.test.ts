import { createN8nTriggerTool } from '../../integrations/n8nTriggerTool';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(ok: boolean, text: string, status = 200) {
    return jest.fn().mockResolvedValue({ ok, status, text: jest.fn().mockResolvedValue(text) });
}

const WEBHOOK = 'https://n8n.internal/webhook/abc123';

// ── Construction ──────────────────────────────────────────────────────────────

describe('createN8nTriggerTool — construction', () => {
    it('throws when no URL is configured', () => {
        delete process.env.N8N_WEBHOOK_URL;
        expect(() => createN8nTriggerTool()).toThrow('N8N_WEBHOOK_URL');
    });

    it('accepts URL via opts.webhookUrl', () => {
        expect(() => createN8nTriggerTool({ webhookUrl: WEBHOOK })).not.toThrow();
    });

    it('falls back to N8N_WEBHOOK_URL env var', () => {
        process.env.N8N_WEBHOOK_URL = WEBHOOK;
        expect(() => createN8nTriggerTool()).not.toThrow();
        delete process.env.N8N_WEBHOOK_URL;
    });

    it('returns a tool with name "n8n_trigger"', () => {
        const tool = createN8nTriggerTool({ webhookUrl: WEBHOOK });
        expect(tool.name).toBe('n8n_trigger');
    });
});

// ── execute — happy path ──────────────────────────────────────────────────────

describe('createN8nTriggerTool — execute', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
        fetchMock = mockFetch(true, 'ok');
        global.fetch = fetchMock;
    });
    afterEach(() => { jest.restoreAllMocks(); });

    it('calls fetch with POST, correct URL, and Content-Type header', async () => {
        const tool = createN8nTriggerTool({ webhookUrl: WEBHOOK });
        await (tool as any).execute({ event: 'test.event', payload: {}, correlation_id: 'cid-1' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(WEBHOOK);
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('serializes event + payload + correlationId in body', async () => {
        const tool = createN8nTriggerTool({ webhookUrl: WEBHOOK });
        await (tool as any).execute({
            event: 'employee.onboarded',
            payload: { employee_id: 42, name: 'Ana' },
            correlation_id: 'cid-2',
        });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.event).toBe('employee.onboarded');
        expect(body.correlationId).toBe('cid-2');
        expect(body.employee_id).toBe(42);
        expect(body.name).toBe('Ana');
    });

    it('auto-generates a UUID correlation_id when omitted', async () => {
        const tool = createN8nTriggerTool({ webhookUrl: WEBHOOK });
        await (tool as any).execute({ event: 'x', payload: {} });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.correlationId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
    });

    it('returns the event name and correlation_id in the result', async () => {
        const tool = createN8nTriggerTool({ webhookUrl: WEBHOOK });
        const result = await (tool as any).execute({
            event: 'invoice.approved',
            payload: {},
            correlation_id: 'trace-99',
        }) as string;
        expect(result).toContain('invoice.approved');
        expect(result).toContain('trace-99');
    });

    it('includes n8n response text in result when non-empty', async () => {
        fetchMock = mockFetch(true, '{"workflowId":"wf-1"}');
        global.fetch = fetchMock;
        const tool = createN8nTriggerTool({ webhookUrl: WEBHOOK });
        const result = await (tool as any).execute({ event: 'x', payload: {} }) as string;
        expect(result).toContain('wf-1');
    });

    it('throws on non-OK HTTP response', async () => {
        fetchMock = mockFetch(false, 'Webhook not found', 404);
        global.fetch = fetchMock;
        const tool = createN8nTriggerTool({ webhookUrl: WEBHOOK });
        await expect((tool as any).execute({ event: 'x', payload: {} })).rejects.toThrow('404');
    });
});

// ── criterio de salida ─────────────────────────────────────────────────────────

describe('n8n_trigger — criterio de salida', () => {
    beforeEach(() => { global.fetch = mockFetch(true, 'triggered'); });
    afterEach(() => jest.restoreAllMocks());

    it('two separate calls produce different correlation IDs', async () => {
        const tool = createN8nTriggerTool({ webhookUrl: WEBHOOK });
        const r1 = await (tool as any).execute({ event: 'a', payload: {} }) as string;
        const r2 = await (tool as any).execute({ event: 'b', payload: {} }) as string;
        const id1 = r1.match(/correlationId: (\S+)/)?.[1];
        const id2 = r2.match(/correlationId: (\S+)/)?.[1];
        expect(id1).toBeDefined();
        expect(id2).toBeDefined();
        expect(id1).not.toBe(id2);
    });
});
