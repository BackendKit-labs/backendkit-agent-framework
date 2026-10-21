import { OllamaProvider, OLLAMA_DEFAULT_HOST, OLLAMA_DEFAULT_MODEL } from '../OllamaProvider';
import { httpError, netError, openaiClient, recorder, text, userMsg } from './helpers';

const fast = { retryBaseDelayMs: 1, retryMaxDelayMs: 2 };

describe('OllamaProvider', () => {
    it('uses its defaults and now asks for usage (it used to omit include_usage)', async () => {
        const { client, create } = openaiClient([[text('hi')]]);
        await new OllamaProvider({ client, ...fast }).chat([userMsg('x')], [], recorder().callbacks);
        const [params] = create.mock.calls[0] as [Record<string, unknown>];
        expect(params).toMatchObject({ model: OLLAMA_DEFAULT_MODEL, max_tokens: 4096, stream_options: { include_usage: true } });
        expect(OLLAMA_DEFAULT_HOST).toBe('http://localhost:11434');
    });

    it('maxRetries keeps counting retries: 2 retries = 3 attempts (the default)', async () => {
        const a = openaiClient([httpError(500)]);
        await new OllamaProvider({ client: a.client, ...fast }).chat([userMsg('x')], [], recorder().callbacks);
        expect(a.create).toHaveBeenCalledTimes(3);

        const b = openaiClient([httpError(500)]);
        await new OllamaProvider({ client: b.client, maxRetries: 1, ...fast }).chat([userMsg('x')], [], recorder().callbacks);
        expect(b.create).toHaveBeenCalledTimes(2);

        const c = openaiClient([httpError(500)]);
        await new OllamaProvider({ client: c.client, maxAttempts: 4, maxRetries: 1, ...fast }).chat([userMsg('x')], [], recorder().callbacks);
        expect(c.create).toHaveBeenCalledTimes(4);
    });

    it('retries 429 as well (it used to retry only 5xx and connection errors)', async () => {
        const { client, create } = openaiClient([httpError(429), [text('ok')]]);
        const r = recorder();
        await new OllamaProvider({ client, ...fast }).chat([userMsg('x')], [], r.callbacks);
        expect(create).toHaveBeenCalledTimes(2);
        expect(r.error).toBeUndefined();
    });

    it('turns exhausted connection errors into a hint to run ollama serve', async () => {
        const { client } = openaiClient([netError('ECONNREFUSED')]);
        const r = recorder();
        await new OllamaProvider({ client, host: 'http://example:1/', ...fast }).chat([userMsg('x')], [], r.callbacks);
        expect(r.error?.message).toBe('Ollama no está disponible en http://example:1. Ejecuta: ollama serve');
    });

    it('turns a 404 into a hint to pull the model, without retrying', async () => {
        const { client, create } = openaiClient([httpError(404)]);
        const r = recorder();
        await new OllamaProvider({ client, model: 'phi3', ...fast }).chat([userMsg('x')], [], r.callbacks);
        expect(create).toHaveBeenCalledTimes(1);
        expect(r.error?.message).toContain('ollama pull phi3');
    });

    describe('checkConnection', () => {
        const realFetch = global.fetch;
        afterEach(() => { global.fetch = realFetch; });

        it('resolves when the server answers', async () => {
            global.fetch = jest.fn(async () => ({ ok: true })) as unknown as typeof fetch;
            await expect(new OllamaProvider({ host: 'http://h:1' }).checkConnection()).resolves.toBeUndefined();
            expect(global.fetch).toHaveBeenCalledWith('http://h:1/api/tags');
        });

        it('explains how to start Ollama when it is unreachable', async () => {
            global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
            await expect(new OllamaProvider({ host: 'http://h:1' }).checkConnection()).rejects.toThrow(/ollama serve/);
        });

        it('rethrows other failures', async () => {
            global.fetch = jest.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
            await expect(new OllamaProvider({ host: 'http://h:1' }).checkConnection()).rejects.toThrow('status 500');
        });
    });
});
