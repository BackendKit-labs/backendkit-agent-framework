import { z } from 'zod';
import { generateObject, generateObjectWith, StructuredOutputError } from '../generateObject';
import type { ChatOptions, LLMMessage, LLMProvider, StructuredOutputSupport } from '../../types';

/** SPEC-0001 §5 (ADR-0003): validated structured output with one corrective retry. */

const schema = z.object({ title: z.string(), score: z.number().int() });

interface Call { messages: LLMMessage[]; options?: ChatOptions; model?: string }

/** Provider double: each call answers with the next script entry (a string, or an Error to fail). */
function scripted(script: Array<string | Error>, capability?: StructuredOutputSupport) {
    const calls: Call[] = [];
    let i = 0;
    const provider: LLMProvider = {
        ...(capability ? { capabilities: { structuredOutput: capability } } : {}),
        async chat(messages, _tools, callbacks, options) {
            calls.push({ messages: messages.map(m => ({ ...m })), options, model: callbacks.model });
            const step = script[Math.min(i++, script.length - 1)];
            if (step instanceof Error) { callbacks.onError(step); return; }
            callbacks.onMetrics?.(7, 3);
            callbacks.onChunk?.(step);
            callbacks.onDone({ role: 'assistant', content: step });
        },
    };
    return { provider, calls };
}

describe('generateObject', () => {
    it('returns the validated, typed object', async () => {
        const { provider } = scripted(['{"title":"a","score":3}']);
        const out = await generateObject(provider, 'make one', schema);
        expect(out).toEqual({ title: 'a', score: 3 });
    });

    it('asks for json_schema with the zod schema converted', async () => {
        const { provider, calls } = scripted(['{"title":"a","score":3}']);
        await generateObject(provider, 'make one', schema, { name: 'item' });
        const fmt = calls[0].options!.responseFormat!;
        expect(fmt).toMatchObject({ type: 'json_schema', name: 'item', strict: true });
        expect(fmt.schema).toMatchObject({ type: 'object', required: ['title', 'score'] });
        expect(fmt.schema).not.toHaveProperty('$schema');
    });

    it('retries once on an invalid answer, telling the model what was wrong', async () => {
        const { provider, calls } = scripted(['{"title":"a","score":"high"}', '{"title":"a","score":3}']);
        const out = await generateObject(provider, 'make one', schema);
        expect(out.score).toBe(3);
        expect(calls).toHaveLength(2);
        const second = calls[1].messages;
        expect(second.slice(-2).map(m => m.role)).toEqual(['assistant', 'user']);
        expect(second[second.length - 2].content).toBe('{"title":"a","score":"high"}');
        expect(second[second.length - 1].content).toContain('score: Expected number');
    });

    it('retries on text that is not JSON', async () => {
        const { provider, calls } = scripted(['sorry, I cannot', '{"title":"a","score":1}']);
        await expect(generateObject(provider, 'p', schema)).resolves.toEqual({ title: 'a', score: 1 });
        expect(calls[1].messages[calls[1].messages.length - 1].content).toContain('not valid JSON');
    });

    it('throws StructuredOutputError with the raw text after two invalid answers', async () => {
        const { provider, calls } = scripted(['nope', '{"title":1}']);
        const err = await generateObject(provider, 'p', schema).catch(e => e);
        expect(err).toBeInstanceOf(StructuredOutputError);
        expect((err as StructuredOutputError).raw).toBe('{"title":1}');
        expect(Array.isArray((err as StructuredOutputError).issues)).toBe(true);
        expect(calls).toHaveLength(2);
    });

    it('retries: 0 makes a single attempt', async () => {
        const { provider, calls } = scripted(['bad']);
        await expect(generateObject(provider, 'p', schema, { retries: 0 })).rejects.toBeInstanceOf(StructuredOutputError);
        expect(calls).toHaveLength(1);
    });

    it('tolerates a Markdown fence or chatter around the object', async () => {
        const fenced = scripted(['```json\n{"title":"a","score":2}\n```']);
        await expect(generateObject(fenced.provider, 'p', schema)).resolves.toEqual({ title: 'a', score: 2 });
        const chatter = scripted(['Sure! Here you go: {"title":"b","score":4} Hope it helps.']);
        await expect(generateObject(chatter.provider, 'p', schema)).resolves.toEqual({ title: 'b', score: 4 });
    });

    it('rethrows provider failures untouched and does not retry them', async () => {
        const boom = new Error('rate limited');
        const { provider, calls } = scripted([boom]);
        await expect(generateObject(provider, 'p', schema)).rejects.toBe(boom);
        expect(calls).toHaveLength(1);
    });

    it('puts the schema in the prompt unless the provider enforces it natively', async () => {
        const native = scripted(['{"title":"a","score":1}'], 'native');
        await generateObject(native.provider, 'make one', schema);
        expect(native.calls[0].messages[0].content).toBe('make one');

        for (const cap of ['json_object', 'none', undefined] as const) {
            const other = scripted(['{"title":"a","score":1}'], cap);
            await generateObject(other.provider, 'make one', schema);
            expect(other.calls[0].messages[0].content).toContain('JSON Schema');
            expect(other.calls[0].messages[0].content).toContain('"title"');
        }
    });

    it('works with a provider that ignores options (validation still applies)', async () => {
        const ignoring: LLMProvider = {
            async chat(_m, _t, cb) { cb.onChunk?.('{"title":"x","score":9}'); cb.onDone({ role: 'assistant', content: null }); },
        };
        await expect(generateObject(ignoring, 'p', schema)).resolves.toEqual({ title: 'x', score: 9 });
    });

    it('falls back to the final message when nothing streamed', async () => {
        const silent: LLMProvider = {
            async chat(_m, _t, cb) { cb.onDone({ role: 'assistant', content: '{"title":"s","score":0}' }); },
        };
        await expect(generateObject(silent, 'p', schema)).resolves.toEqual({ title: 's', score: 0 });
    });

    it('forwards model, system prompt and usage', async () => {
        const { provider, calls } = scripted(['{"title":"a","score":1}']);
        const usage: Array<[number, number]> = [];
        await generateObject(provider, 'p', schema, { model: 'm-1', system: 'be brief', onMetrics: (i, o) => { usage.push([i, o]); } });
        expect(calls[0].model).toBe('m-1');
        expect(calls[0].messages[0]).toEqual({ role: 'system', content: 'be brief' });
        expect(usage).toEqual([[7, 3]]);
    });
});

describe('generateObjectWith', () => {
    it('works over any chat function', async () => {
        const answers = ['{"n":1}'];
        const out = await generateObjectWith(async () => answers.shift()!, 'p', z.object({ n: z.number() }));
        expect(out).toEqual({ n: 1 });
    });
});
