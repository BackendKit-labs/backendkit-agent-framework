import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAICompatibleProvider } from '@backendkit-labs/agent-providers';
import { createBaseEngine, defineTool, isContextOverflowError, z, type LLMMessage, type LLMProvider } from '@backendkit-labs/agent-core';
import {
    RecordingProvider, ReplayProvider, readRecording, scriptedProvider, startMockLlmServer, mockTransport,
    type MockLlmServer, type RecordedCall,
} from '../index';

let dir: string;
let server: MockLlmServer | undefined;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bk-replay-')); });
afterEach(async () => { await server?.close(); server = undefined; rmSync(dir, { recursive: true, force: true }); });

const USER: LLMMessage[] = [{ role: 'user', content: 'hi' }];

interface Seen { chunks: string[]; tools: string[]; metrics: Array<[number, number]>; done?: LLMMessage; error?: Error }
async function call(p: LLMProvider, messages = USER, signal?: AbortSignal): Promise<Seen> {
    const seen: Seen = { chunks: [], tools: [], metrics: [] };
    await p.chat(messages, [], {
        onChunk: d => seen.chunks.push(d),
        onToolCall: (n, a, id) => seen.tools.push(`${id}:${n}${a}`),
        onMetrics: (i, o) => seen.metrics.push([i, o]),
        onDone: m => { seen.done = m; },
        onError: e => { seen.error = e; },
        signal,
    });
    return seen;
}

describe('RecordingProvider', () => {
    it('writes one JSON line per call with the request, the events and the timings', async () => {
        const file = join(dir, 'nested', 'run.jsonl');
        const p = new RecordingProvider(scriptedProvider([{ content: 'hello', metrics: { inputTokens: 4, outputTokens: 2 } }, { tool_calls: [{ id: 't1', name: 'x', args: { a: 1 } }] }]), file);
        await call(p);
        await call(p, [{ role: 'user', content: 'again' }]);

        const calls = readRecording(file);
        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatchObject({ v: 1, index: 0, request: { messages: USER, tools: [] } });
        expect(calls[0].events.map(e => e.type)).toEqual(['metrics', 'chunk', 'done']);
        expect(calls[1].index).toBe(1);
        expect(calls[1].events.map(e => e.type)).toEqual(['tool_call', 'done']);
        expect(calls[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('is transparent: the caller sees the same events, and capabilities / modelId pass through', async () => {
        const inner = Object.assign(scriptedProvider([{ content: 'same' }]), { capabilities: { structuredOutput: 'json_object' as const }, modelId: 'm-1' });
        const p = new RecordingProvider(inner, () => undefined);
        expect(p.capabilities).toEqual({ structuredOutput: 'json_object' });
        expect(p.modelId).toBe('m-1');
        const seen = await call(p);
        expect(seen.chunks).toEqual(['same']);
        expect(seen.done?.content).toBe('same');
    });

    it('accepts a function sink, applies redact, and keeps the per-call model', async () => {
        const got: RecordedCall[] = [];
        const p = new RecordingProvider(scriptedProvider([{ content: 'secret answer' }]), c => got.push(c), {
            redact: c => ({ ...c, request: { ...c.request, messages: c.request.messages.map(m => ({ ...m, content: '[redacted]' })) } }),
        });
        await p.chat(USER, [], { onDone: () => undefined, onError: () => undefined, model: 'special' });
        expect(got[0].request.messages[0].content).toBe('[redacted]');
        expect(got[0].model).toBe('special');
    });

    it('records a provider that throws instead of calling onError, and rethrows', async () => {
        const got: RecordedCall[] = [];
        const boom: LLMProvider = { chat: async () => { throw Object.assign(new Error('kaput'), { status: 502 }); } };
        const p = new RecordingProvider(boom, c => got.push(c));
        await expect(call(p)).rejects.toThrow('kaput');
        expect(got[0].events).toEqual([expect.objectContaining({ type: 'error', error: expect.objectContaining({ message: 'kaput', status: 502 }) })]);
    });

    it('readRecording names the line of a corrupt file', () => {
        const file = join(dir, 'bad.jsonl');
        writeFileSync(file, '{"v":1}\n\n{not json\n');
        expect(() => readRecording(file)).toThrow(/line 3/);
    });
});

describe('ReplayProvider', () => {
    async function recorded(): Promise<{ file: string }> {
        const file = join(dir, 'rec.jsonl');
        const p = new RecordingProvider(scriptedProvider([
            { content: 'first', metrics: { inputTokens: 5, outputTokens: 1 } },
            { tool_calls: [{ id: 'c9', name: 'lookup', args: { q: 1 } }] },
        ]), file);
        await call(p);
        await call(p, [{ role: 'user', content: 'second' }]);
        return { file };
    }

    it('plays the recorded calls in order, event for event', async () => {
        const { file } = await recorded();
        const r = new ReplayProvider(file);
        const a = await call(r);
        expect(a.chunks).toEqual(['first']);
        expect(a.metrics).toEqual([[5, 1]]);
        expect(a.done?.content).toBe('first');
        const b = await call(r, [{ role: 'user', content: 'second' }]);
        expect(b.tools).toEqual(['c9:lookup{"q":1}']);
        expect(r.remaining()).toBe(0);
        expect(r.requests).toHaveLength(2);
        expect(r.requests[1].messages[0].content).toBe('second');
    });

    it('reports an error when the code asks for more calls than were recorded', async () => {
        const { file } = await recorded();
        const r = new ReplayProvider(file);
        await call(r); await call(r);
        const extra = await call(r);
        expect(extra.error?.message).toMatch(/invocation 3 has no recorded call/);
    });

    it('verifyRequests catches a request that drifted from the recording', async () => {
        const { file } = await recorded();
        const ok = new ReplayProvider(file, { verifyRequests: true });
        expect((await call(ok)).error).toBeUndefined();
        const drifted = new ReplayProvider(file, { verifyRequests: true });
        const seen = await call(drifted, [{ role: 'user', content: 'something else' }]);
        expect(seen.error?.message).toMatch(/does not match recorded call 0: message 0 \(user\) differs/);
        expect(new ReplayProvider(file, { verifyRequests: true }).remaining()).toBe(2);
        const longer = await call(new ReplayProvider(file, { verifyRequests: true }), [...USER, ...USER]);
        expect(longer.error?.message).toMatch(/2 messages sent, 1 recorded/);
    });

    it('with timing "recorded" waits roughly the original time between events', async () => {
        const calls: RecordedCall[] = [{ v: 1, index: 0, startedAt: 0, durationMs: 90, request: { messages: USER, tools: [] }, events: [
            { t: 0, type: 'chunk', delta: 'a' }, { t: 80, type: 'chunk', delta: 'b' }, { t: 90, type: 'done', message: { role: 'assistant', content: 'ab' } },
        ] }];
        const t0 = Date.now();
        const seen = await call(new ReplayProvider(calls, { timing: 'recorded' }));
        expect(seen.chunks).toEqual(['a', 'b']);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
    });

    it('stops replaying when the call is aborted', async () => {
        const calls: RecordedCall[] = [{ v: 1, index: 0, startedAt: 0, durationMs: 0, request: { messages: USER, tools: [] }, events: [
            { t: 0, type: 'chunk', delta: 'a' }, { t: 0, type: 'done', message: { role: 'assistant', content: 'a' } },
        ] }];
        const controller = new AbortController();
        controller.abort();
        const seen = await call(new ReplayProvider(calls), USER, controller.signal);
        expect(seen.error?.name).toBe('AbortError');
        expect(seen.done).toBeUndefined();
    });

    it('reconstructs recorded errors with their status and code', async () => {
        const server2 = await startMockLlmServer({ script: [{ kind: 'overflow' }] });
        server = server2;
        const file = join(dir, 'overflow.jsonl');
        const real = new OpenAICompatibleProvider({ apiKey: 'k', baseUrl: server2.url, model: 'm', maxAttempts: 1 });
        await call(new RecordingProvider(real, file));
        const replayed = await call(new ReplayProvider(file));
        expect((replayed.error as any).status).toBe(400);
        expect(isContextOverflowError(replayed.error)).toBe(true);
    });
});

describe('ReplayProvider — overrides', () => {
    const recordedOnce = (): RecordedCall[] => [{ v: 1, index: 0, startedAt: 0, durationMs: 0, request: { messages: USER, tools: [] }, events: [
        { t: 0, type: 'chunk', delta: 'real answer' }, { t: 0, type: 'done', message: { role: 'assistant', content: 'real answer' } },
    ] }];

    it('an injected error fails that invocation only; the next one gets the recorded call', async () => {
        const r = new ReplayProvider(recordedOnce(), { overrides: { inject: { '1': { error: { message: 'Too Many Requests', status: 429, name: 'RateLimitError' } } } } });
        const first = await call(r);
        expect((first.error as any).status).toBe(429);
        expect(first.error?.name).toBe('RateLimitError');
        expect(first.chunks).toEqual([]);
        expect(r.remaining()).toBe(1);
        const second = await call(r);
        expect(second.done?.content).toBe('real answer');
    });

    it('cancel ends the call with an AbortError', async () => {
        const r = new ReplayProvider(recordedOnce(), { overrides: { inject: { '1': { cancel: true } } } });
        expect((await call(r)).error?.name).toBe('AbortError');
    });

    it('hang waits for the signal and then aborts; without a signal it refuses to hang forever', async () => {
        const r = new ReplayProvider(recordedOnce(), { overrides: { inject: { '1': { hang: true }, '2': { hang: true } } } });
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 40);
        const t0 = Date.now();
        const seen = await call(r, USER, controller.signal);
        expect(seen.error?.name).toBe('AbortError');
        expect(Date.now() - t0).toBeGreaterThanOrEqual(30);
        await expect(call(r)).rejects.toThrow(/needs the call to carry a signal/);
        const done = new AbortController(); done.abort();
        expect((await call(new ReplayProvider(recordedOnce(), { overrides: { inject: { '1': { hang: true } } } }), USER, done.signal)).error?.name).toBe('AbortError');
    });

    it('loads overrides from a path, and from the sidecar next to the recording', async () => {
        const file = join(dir, 'case.jsonl');
        writeFileSync(file, recordedOnce().map(c => JSON.stringify(c)).join('\n') + '\n');
        writeFileSync(join(dir, 'case.override.json'), JSON.stringify({ inject: { '1': { error: { message: 'sidecar fault', status: 503 } } } }));
        expect((await call(new ReplayProvider(file))).error?.message).toBe('sidecar fault');

        const other = join(dir, 'custom.json');
        writeFileSync(other, JSON.stringify({ inject: { '1': { cancel: true } } }));
        expect((await call(new ReplayProvider(file, { overrides: other }))).error?.name).toBe('AbortError');
        expect((await call(new ReplayProvider(file, { overrides: {} }))).done?.content).toBe('real answer');
    });
});

describe('record → replay (SPEC-0007 A.4)', () => {
    const readTool = defineTool({
        name: 'read_note', description: 'reads a note', input: z.object({ id: z.number() }),
        execute: async ({ id }) => `note ${id}: remember the milk`,
    });
    const agent = { id: 'a', name: 'A', icon: 'x', description: 'd', systemPrompt: 'be brief', allowedTools: ['read_note'], delegatesTo: [] };

    function engineWith(provider: LLMProvider, historyPath: string) {
        const t = mockTransport();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { p: provider }, defaultProvider: 'p', agents: [agent], defaultAgent: 'a', tools: [readTool],
            transport: t.transport, workingDir: dir, iterationMode: 'auto', historyPath,
        });
        return { engine, t };
    }

    it('a run recorded against the mock server replays into the same final history', async () => {
        server = await startMockLlmServer({ script: [
            { kind: 'tool_call', name: 'read_note', args: { id: 7 } },
            { kind: 'text', content: 'Your note says: remember the milk.', usage: { promptTokens: 30, completionTokens: 9 } },
        ] });
        const file = join(dir, 'session.jsonl');
        const live = new RecordingProvider(new OpenAICompatibleProvider({ apiKey: 'k', baseUrl: server.url, model: 'm', maxAttempts: 1 }), file);
        const first = engineWith(live, join(dir, 'history-live.json'));
        await first.engine.run('what is in note 7?');

        const replay = new ReplayProvider(file, { verifyRequests: true });
        const second = engineWith(replay, join(dir, 'history-replay.json'));
        await second.engine.run('what is in note 7?');

        expect(replay.remaining()).toBe(0);
        expect(second.t.text()).toBe(first.t.text());
        expect(second.t.eventsOf('tool_result').map(e => e.success)).toEqual([true]);
        expect(JSON.parse(readFileSync(join(dir, 'history-replay.json'), 'utf8'))).toEqual(JSON.parse(readFileSync(join(dir, 'history-live.json'), 'utf8')));
        expect(second.t.eventsOf('error')).toEqual([]);
    });

    it('an injected context overflow makes the engine compact and finish the run with the recorded answer', async () => {
        const calls: RecordedCall[] = ['one', 'two', 'three', 'four'].map((word, i) => ({
            v: 1, index: i, startedAt: 0, durationMs: 0, request: { messages: USER, tools: [] },
            events: [{ t: 0, type: 'chunk', delta: word }, { t: 0, type: 'done', message: { role: 'assistant', content: word } }],
        }));
        const replay = new ReplayProvider(calls, { overrides: { inject: { '4': { error: {
            message: "400 This model's maximum context length is 1048576 tokens. However, you requested 2416416 tokens",
            status: 400, code: 'invalid_request_error',
        } } } } });
        const t = mockTransport();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { p: replay }, defaultProvider: 'p', agents: [{ ...agent, allowedTools: [] }], defaultAgent: 'a',
            transport: t.transport, workingDir: dir, iterationMode: 'auto',
            context: { maxTokens: 1_000_000, strategy: 'drop', keepRecentTurns: 1 },
        });
        await engine.run('q1'); await engine.run('q2'); await engine.run('q3');
        t.clear();
        await engine.run('q4');
        expect(t.eventsOf('error')).toEqual([]);
        expect(t.eventsOf('system').some(e => /context overflow/.test(e.text))).toBe(true);
        expect(t.text()).toBe('four');
        expect(replay.requests[4].messages.length).toBeLessThan(replay.requests[3].messages.length);
    });
});
