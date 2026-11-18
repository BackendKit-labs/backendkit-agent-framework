import type { LLMMessage, ToolDefinition } from '@backendkit-labs/agent-core';
import { AiSdkProvider, fromAiSdk, toPrompt } from '../AiSdkProvider';
import type { AiSdkModelLike } from '../AiSdkProvider';
import { httpError, recorder, userMsg } from './helpers';

type Part = Record<string, unknown>;

/** A model of the AI SDK that plays a script: each `doStream` call takes the next entry (an Error makes `doStream` throw; a part that is an Error is thrown mid-stream). */
function model(script: Array<Error | Array<Part | Error>>, version = 'v4') {
    let i = 0;
    const calls: Array<Record<string, unknown>> = [];
    const m: AiSdkModelLike = {
        specificationVersion: version,
        provider: 'test',
        modelId: 'test-model',
        doStream: async (options: never) => {
            calls.push(options as Record<string, unknown>);
            const step = script[Math.min(i++, script.length - 1)];
            if (step instanceof Error) throw step;
            return {
                stream: new ReadableStream({
                    start(controller) {
                        for (const p of step) {
                            if (p instanceof Error) { controller.error(p); return; }
                            controller.enqueue(p);
                        }
                        controller.close();
                    },
                }),
            };
        },
    };
    return { m, calls };
}

const text = (delta: string): Part => ({ type: 'text-delta', id: '1', delta });
const finish = (usage: unknown = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } }): Part =>
    ({ type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } });
const fast = { retryBaseDelayMs: 1, retryMaxDelayMs: 2 };

const tool: ToolDefinition = {
    name: 'get_weather', description: 'Weather of a city',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    execute: async () => '18C',
};

describe('fromAiSdk', () => {
    it('streams text to onChunk and ends with the assembled message', async () => {
        const { m } = model([[{ type: 'stream-start', warnings: [] }, text('Hel'), text('lo'), { type: 'ping' }, finish()]]);
        const r = recorder();
        await fromAiSdk(m).chat([userMsg('hi')], [], r.callbacks);
        expect(r.chunks).toEqual(['Hel', 'lo']);
        expect(r.done).toEqual({ role: 'assistant', content: 'Hello', tool_calls: undefined });
        expect(r.error).toBeUndefined();
    });

    it('reports the model id and defaults structuredOutput to none, unless the integrator declares it', () => {
        const { m } = model([[]]);
        expect(fromAiSdk(m).modelId).toBe('test-model');
        expect(fromAiSdk(m).capabilities).toEqual({ structuredOutput: 'none' });
        expect(fromAiSdk(m, { structuredOutput: 'native' }).capabilities).toEqual({ structuredOutput: 'native' });
    });

    it('a tool call arrives whole (the tool-input parts are progress only) and ends in tool_calls and onToolCall', async () => {
        const { m, calls } = model([[
            { type: 'tool-input-start', id: 'c1', toolName: 'get_weather' },
            { type: 'tool-input-delta', id: 'c1', delta: '{"city"' },
            { type: 'tool-input-end', id: 'c1' },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'get_weather', input: '{"city":"Lima"}' },
            finish(),
        ]]);
        const r = recorder();
        await fromAiSdk(m).chat([userMsg('weather?')], [tool], r.callbacks, { toolChoice: 'required' });
        expect(r.tools).toEqual([{ name: 'get_weather', args: '{"city":"Lima"}', id: 'c1' }]);
        expect(r.done!.tool_calls).toEqual([{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Lima"}' } }]);
        // The tool goes out as a function without `execute`: the engine runs it, not the SDK.
        expect(calls[0].tools).toEqual([{ type: 'function', name: 'get_weather', description: 'Weather of a city', inputSchema: tool.parameters }]);
        expect(calls[0].toolChoice).toEqual({ type: 'required' });
    });

    it('a call whose input is already an object is turned into JSON', async () => {
        const { m } = model([[{ type: 'tool-call', toolCallId: 'c1', toolName: 'get_weather', input: { city: 'Lima' } }, finish()]]);
        const r = recorder();
        await fromAiSdk(m).chat([userMsg('x')], [tool], r.callbacks);
        expect(r.tools[0].args).toBe('{"city":"Lima"}');
    });

    it('sends the tool loop in the prompt: the call as a tool-call part, its result matched by id', async () => {
        const { m, calls } = model([[text('done'), finish()]]);
        const history: LLMMessage[] = [
            { role: 'system', content: 'be brief' },
            userMsg('weather?'),
            { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Lima"}' } }] },
            { role: 'tool', content: '18C', tool_call_id: 'c1' },
        ];
        await fromAiSdk(m).chat(history, [tool], recorder().callbacks);
        expect(calls[0].prompt).toEqual([
            { role: 'system', content: 'be brief' },
            { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
            { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'get_weather', input: { city: 'Lima' } }] },
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'get_weather', output: { type: 'text', value: '18C' } }] },
        ]);
    });

    it('arguments that are not JSON go out as an empty object instead of breaking the call', () => {
        const p = toPrompt([{ role: 'assistant', content: 'x', tool_calls: [{ id: 'c', type: 'function', function: { name: 'n', arguments: '{oops' } }] }]);
        expect(p[0]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'x' }, { type: 'tool-call', toolCallId: 'c', toolName: 'n', input: {} }] });
    });

    it('maps toolChoice for a named tool, responseFormat, sampling options and providerOptions; sends no toolChoice without tools', async () => {
        const { m, calls } = model([[finish()], [finish()]]);
        const p = fromAiSdk(m, { temperature: 0.2, maxOutputTokens: 100, providerOptions: { google: { x: 1 } } });
        await p.chat([userMsg('x')], [tool], recorder().callbacks, {
            toolChoice: { name: 'get_weather' },
            responseFormat: { type: 'json_schema', name: 'out', schema: { type: 'object' } },
        });
        expect(calls[0]).toMatchObject({
            toolChoice: { type: 'tool', toolName: 'get_weather' },
            responseFormat: { type: 'json', name: 'out', schema: { type: 'object' } },
            temperature: 0.2, maxOutputTokens: 100, providerOptions: { google: { x: 1 } },
        });
        await p.chat([userMsg('x')], [], recorder().callbacks, { toolChoice: 'auto' });
        expect(calls[1]).not.toHaveProperty('tools');
        expect(calls[1]).not.toHaveProperty('toolChoice');
    });

    it('reports usage, with cache tokens when the model gives them (interface v4)', async () => {
        const { m } = model([[finish({ inputTokens: { total: 100, noCache: 20, cacheRead: 70, cacheWrite: 10 }, outputTokens: { total: 5 } })]]);
        const seen: unknown[] = [];
        await fromAiSdk(m).chat([userMsg('x')], [], recorder({ onMetrics: (i, o, d) => { seen.push([i, o, d]); } }).callbacks);
        expect(seen).toEqual([[100, 5, { cacheReadTokens: 70, cacheWriteTokens: 10 }]]);
    });

    it('understands the flat usage of interface v2 and its text-delta of that era', async () => {
        const { m } = model([[{ type: 'text-delta', id: '1', delta: 'a' }, { type: 'finish', usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10, cachedInputTokens: 2 }, finishReason: 'stop' }]], 'v2');
        const seen: unknown[] = [];
        await fromAiSdk(m).chat([userMsg('x')], [], recorder({ onMetrics: (i, o, d) => { seen.push([i, o, d]); } }).callbacks);
        expect(seen).toEqual([[7, 3, { cacheReadTokens: 2, cacheWriteTokens: undefined }]]);
    });

    it('streams reasoning to onReasoning, apart from the answer', async () => {
        const { m } = model([[{ type: 'reasoning-start', id: 'r' }, { type: 'reasoning-delta', id: 'r', delta: 'think' }, { type: 'reasoning-end', id: 'r' }, text('ok'), finish()]]);
        const reasoning: string[] = [];
        const r = recorder({ onReasoning: d => { reasoning.push(d); } });
        await fromAiSdk(m).chat([userMsg('x')], [], r.callbacks);
        expect(reasoning).toEqual(['think']);
        expect(r.chunks).toEqual(['ok']);
    });

    it('passes the abort signal to the model', async () => {
        const { m, calls } = model([[finish()]]);
        const ctrl = new AbortController();
        await fromAiSdk(m).chat([userMsg('x')], [], recorder({ signal: ctrl.signal }).callbacks);
        expect(calls[0].abortSignal).toBe(ctrl.signal);
    });

    describe('errors', () => {
        it('retries a transient failure once, before any output, and then succeeds', async () => {
            const { m, calls } = model([httpError(503), [text('ok'), finish()]]);
            const r = recorder();
            await fromAiSdk(m, fast).chat([userMsg('x')], [], r.callbacks);
            expect(calls).toHaveLength(2);
            expect(r.chunks).toEqual(['ok']);
            expect(r.error).toBeUndefined();
        });

        it('a permanent failure goes to onError without a retry', async () => {
            const { m, calls } = model([httpError(401, 'bad key')]);
            const r = recorder();
            await fromAiSdk(m, fast).chat([userMsg('x')], [], r.callbacks);
            expect(calls).toHaveLength(1);
            expect(r.error!.message).toBe('bad key');
            expect(r.done).toBeUndefined();
        });

        it('an error part in the stream is an error of the call, and after output it is not retried', async () => {
            const { m, calls } = model([[text('par'), { type: 'error', error: httpError(500, 'cut') }]]);
            const r = recorder();
            await fromAiSdk(m, fast).chat([userMsg('x')], [], r.callbacks);
            expect(calls).toHaveLength(1);
            expect(r.error!.message).toBe('cut');
        });

        it('an error part that is not an Error object becomes one', async () => {
            const { m } = model([[{ type: 'error', error: { message: 'x' } }]]);
            const r = recorder();
            await fromAiSdk(m).chat([userMsg('x')], [], r.callbacks);
            expect(r.error).toBeInstanceOf(Error);
        });

        it('refuses a model id string and an unknown interface version, with a clear message', () => {
            expect(() => new AiSdkProvider('google/gemini' as never)).toThrow(/model object/);
            expect(() => new AiSdkProvider(model([[]], 'v9').m)).toThrow(/v9/);
        });
    });
});
