import { OpenAICompatibleProvider, DeepSeekProvider } from '@backendkit-labs/agent-providers';
import { createBaseEngine, isContextOverflowError, type LLMMessage, type LLMProvider } from '@backendkit-labs/agent-core';
import { startMockLlmServer, mockTransport, type MockLlmServer, type MockBehavior } from '../index';

let server: MockLlmServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

const MESSAGES: LLMMessage[] = [{ role: 'user', content: 'hello' }];

async function boot(script: MockBehavior[]) {
    server = await startMockLlmServer({ script });
    return server;
}

/** A real provider pointed at the mock, with near-zero backoff so retries do not slow the tests. */
function providerFor(s: MockLlmServer, maxAttempts = 3) {
    return new OpenAICompatibleProvider({ apiKey: 'test', baseUrl: s.url, model: 'mock-model', maxAttempts, retryBaseDelayMs: 1, retryMaxDelayMs: 5 });
}

interface Outcome { text: string; done?: LLMMessage; error?: Error; metrics?: [number, number]; toolCalls: Array<[string, string, string]> }

async function ask(provider: LLMProvider, signal?: AbortSignal): Promise<Outcome> {
    const out: Outcome = { text: '', toolCalls: [] };
    await provider.chat(MESSAGES, [], {
        onChunk: d => { out.text += d; },
        onToolCall: (name, args, id) => { out.toolCalls.push([name, args, id]); },
        onDone: m => { out.done = m; },
        onError: e => { out.error = e; },
        onMetrics: (i, o) => { out.metrics = [i, o]; },
        signal,
    });
    return out;
}

describe('startMockLlmServer — normal answers', () => {
    it('streams text in chunks and reports usage', async () => {
        const s = await boot([{ kind: 'text', content: 'The quick brown fox', chunkSize: 5, usage: { promptTokens: 42, completionTokens: 7 } }]);
        const out = await ask(providerFor(s));
        expect(out.error).toBeUndefined();
        expect(out.text).toBe('The quick brown fox');
        expect(out.done?.content).toBe('The quick brown fox');
        expect(out.metrics).toEqual([42, 7]);
    });

    it('assembles a tool call from streamed fragments', async () => {
        const s = await boot([{ kind: 'tool_call', name: 'read_file', args: { path: 'a.txt', lines: [1, 2] }, id: 'call_9' }]);
        const out = await ask(providerFor(s));
        expect(out.toolCalls).toEqual([['read_file', JSON.stringify({ path: 'a.txt', lines: [1, 2] }), 'call_9']]);
        expect(out.done?.tool_calls?.[0].function.name).toBe('read_file');
    });

    it('captures what the client sent', async () => {
        const s = await boot([{ kind: 'text', content: 'ok' }]);
        await ask(providerFor(s));
        expect(s.requests).toHaveLength(1);
        expect(s.requests[0].url).toBe('/v1/chat/completions');
        expect(s.requests[0].body).toMatchObject({ model: 'mock-model', stream: true, messages: [{ role: 'user', content: 'hello' }] });
        expect(s.requests[0].headers.authorization).toBe('Bearer test');
    });

    it('answers non-streaming requests as one JSON completion', async () => {
        const s = await boot([{ kind: 'text', content: 'plain json' }]);
        const res = await fetch(`${s.url}/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'm', messages: [] }) });
        const json: any = await res.json();
        expect(json.choices[0].message.content).toBe('plain json');
        expect(json.usage.total_tokens).toBeGreaterThan(0);
    });

    it('delays a response when asked to', async () => {
        const s = await boot([{ kind: 'text', content: 'slow', delayMs: 120 }]);
        const t0 = Date.now();
        await ask(providerFor(s));
        expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    });

    it('answers 404 for other routes and 500 "mock script exhausted" when the script runs out', async () => {
        const s = await boot([]);
        expect((await fetch(`${s.url}/models`)).status).toBe(404);
        const res = await fetch(`${s.url}/chat/completions`, { method: 'POST', body: '{}' });
        expect(res.status).toBe(500);
        expect(JSON.stringify(await res.json())).toContain('mock script exhausted');
        expect(s.remaining()).toBe(0);
    });
});

describe('startMockLlmServer — provider failures against the real providers', () => {
    it('retries a 429 and succeeds on the next attempt', async () => {
        const s = await boot([{ kind: 'status', status: 429, message: 'rate limited' }, { kind: 'text', content: 'after retry' }]);
        const out = await ask(providerFor(s));
        expect(out.error).toBeUndefined();
        expect(out.text).toBe('after retry');
        expect(s.requests).toHaveLength(2);
    });

    it('gives up on a persistent 503 after maxAttempts and reports the error', async () => {
        const s = await boot([{ kind: 'status', status: 503 }, { kind: 'status', status: 503 }, { kind: 'status', status: 503 }, { kind: 'text', content: 'never reached' }]);
        const out = await ask(providerFor(s, 3));
        expect((out.error as any)?.status).toBe(503);
        expect(out.done).toBeUndefined();
        expect(s.requests).toHaveLength(3);
        expect(s.remaining()).toBe(1);
    });

    it('does not retry a 400', async () => {
        const s = await boot([{ kind: 'status', status: 400, message: 'bad request' }, { kind: 'text', content: 'unused' }]);
        const out = await ask(providerFor(s));
        expect((out.error as any)?.status).toBe(400);
        expect(s.requests).toHaveLength(1);
    });

    it('retries a dropped connection', async () => {
        const s = await boot([{ kind: 'reset' }, { kind: 'text', content: 'second try' }]);
        const out = await ask(providerFor(s));
        expect(out.text).toBe('second try');
        expect(s.requests).toHaveLength(2);
    });

    it('an error event after the stream started fails without retrying (the caller already saw part of the answer)', async () => {
        const s = await boot([{ kind: 'stream_error', message: 'upstream blew up', content: 'half an answ', afterChunks: 2 }, { kind: 'text', content: 'would be a duplicate' }]);
        const out = await ask(providerFor(s));
        expect(out.text).toBe('half an answ');
        expect(out.done).toBeUndefined();
        expect(out.error?.message).toContain('upstream blew up');
        expect(s.requests).toHaveLength(1);
    });

    it('a corrupt stream chunk becomes an error instead of hanging', async () => {
        const s = await boot([{ kind: 'corrupt' }, { kind: 'corrupt' }, { kind: 'corrupt' }]);
        const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);   // the SDK logs the bad chunk
        const out = await ask(providerFor(s)).finally(() => quiet.mockRestore());
        expect(out.error).toBeDefined();
        expect(out.done).toBeUndefined();
    });

    it('aborting a stalled request returns promptly and is not retried', async () => {
        const s = await boot([{ kind: 'stall' }, { kind: 'text', content: 'unused' }]);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 80);
        const t0 = Date.now();
        const out = await ask(providerFor(s), controller.signal);
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(out.done).toBeUndefined();
        expect(s.requests).toHaveLength(1);
    });

    it('context overflow arrives as the real wire format and is recognised, with no retry', async () => {
        const s = await boot([{ kind: 'overflow' }]);
        const out = await ask(new DeepSeekProvider({ apiKey: 'test', baseUrl: s.url, retryBaseDelayMs: 1 }));
        expect((out.error as any)?.status).toBe(400);
        expect(out.error?.message).toContain("This model's maximum context length is 1048576 tokens");
        expect(isContextOverflowError(out.error)).toBe(true);
        expect(s.requests).toHaveLength(1);
    });
});

describe('startMockLlmServer — engine recovery from overflow (SPEC-0002 §3)', () => {
    it('compacts and retries when the provider reports an overflow, then finishes the run', async () => {
        const s = await boot([
            { kind: 'text', content: 'one' }, { kind: 'text', content: 'two' }, { kind: 'text', content: 'three' },
            { kind: 'overflow' },
            { kind: 'text', content: 'recovered' },
        ]);
        const { transport, events, text } = mockTransport();
        const engine = createBaseEngine({
            providers: { mock: providerFor(s) }, defaultProvider: 'mock', transport, noQA: true, iterationMode: 'auto',
            agents: [{ id: 'a', name: 'A', icon: 'x', description: 'd', systemPrompt: 'be brief', allowedTools: [], delegatesTo: [] }],
            defaultAgent: 'a', workingDir: process.cwd(),
            context: { maxTokens: 1_000_000, strategy: 'drop', keepRecentTurns: 1 },
        });
        await engine.run('first question');
        await engine.run('second question');
        await engine.run('third question');
        const before = s.requests.length;
        await engine.run('fourth question');

        expect(s.requests.length - before).toBe(2);                                    // the rejected call and the retry
        const [rejected, retried] = s.requests.slice(before);
        expect(retried.body.messages.length).toBeLessThan(rejected.body.messages.length);
        expect(events.some(e => e.type === 'error')).toBe(false);
        expect(events.some(e => e.type === 'system' && /context overflow/.test(e.text))).toBe(true);
        expect(text()).toContain('recovered');
    });
});

describe('startMockLlmServer — seeded random mode', () => {
    async function outcomes(seed: number, n: number): Promise<string[]> {
        const s = await startMockLlmServer({ random: { seed, weights: { text: 3, status: 2, reset: 1, cut: 1, corrupt: 1 } } });
        const seen: string[] = [];
        try {
            for (let i = 0; i < n; i++) {
                try {
                    const res = await fetch(`${s.url}/chat/completions`, { method: 'POST', body: JSON.stringify({ stream: true }) });
                    const body = await res.text().catch(() => 'cut');
                    seen.push(`${res.status}:${body.includes('not json') ? 'corrupt' : body.length > 0 ? 'body' : 'empty'}`);
                } catch { seen.push('reset'); }
            }
        } finally { await s.close(); }
        return seen;
    }

    it('the same seed plays the same behaviours, a different seed does not', async () => {
        const a = await outcomes(7, 14);
        const b = await outcomes(7, 14);
        const c = await outcomes(99, 14);
        expect(a).toEqual(b);
        expect(c).not.toEqual(a);
        expect(new Set(a).size).toBeGreaterThan(1);
    });
});
