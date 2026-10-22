import { generateObject, z } from '@backendkit-labs/agent-core';
import type { ChatOptions } from '@backendkit-labs/agent-core';
import { AnthropicProvider } from '../AnthropicProvider';
import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider';
import { DeepSeekProvider } from '../DeepSeekProvider';
import { OllamaProvider } from '../OllamaProvider';
import { anthropicClient, ev, openaiClient, recorder, text, userMsg } from './helpers';

/** SPEC-0001 §5 (ADR-0003): per-call responseFormat / toolChoice mapped per provider. */

const fast = { retryBaseDelayMs: 1, retryMaxDelayMs: 2 };
const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
const format: NonNullable<ChatOptions['responseFormat']> = { type: 'json_schema', name: 'thing', schema, strict: true };
const tool = { name: 't', description: 'd', parameters: { type: 'object', properties: {} }, execute: async () => '' };

type OaiParams = Record<string, unknown>;
const oaiParams = (c: { mock: { calls: unknown[][] } }) => c.mock.calls[0][0] as OaiParams;

describe('OpenAI-compatible: responseFormat', () => {
    it('native: json_schema with name, schema and strict', async () => {
        const { client, create } = openaiClient([[text('{}')]]);
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, ...fast })
            .chat([userMsg('q')], [], recorder().callbacks, { responseFormat: format });
        expect(oaiParams(create).response_format).toEqual({ type: 'json_schema', json_schema: { name: 'thing', schema, strict: true } });
    });

    it('relaxes strict when the schema has optional fields (OpenAI would answer 400)', async () => {
        const optional = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'], additionalProperties: false };
        const { client, create } = openaiClient([[text('{}')]]);
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, ...fast })
            .chat([userMsg('q')], [], recorder().callbacks, { responseFormat: { ...format, schema: optional } });
        expect((oaiParams(create).response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(false);
    });

    it('relaxes strict for nested objects that allow extra properties', async () => {
        const nested = { type: 'object', properties: { x: { type: 'array', items: { type: 'object', properties: { y: { type: 'string' } }, required: ['y'] } } }, required: ['x'], additionalProperties: false };
        const { client, create } = openaiClient([[text('{}')]]);
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, ...fast })
            .chat([userMsg('q')], [], recorder().callbacks, { responseFormat: { ...format, schema: nested } });
        expect((oaiParams(create).response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(false);
    });

    it('json_object mode (DeepSeek and Ollama presets) sends only json_object', async () => {
        for (const make of [
            (client: ReturnType<typeof openaiClient>['client']) => new DeepSeekProvider({ apiKey: 'k', client, ...fast }),
            (client: ReturnType<typeof openaiClient>['client']) => new OllamaProvider({ client, ...fast }),
        ]) {
            const { client, create } = openaiClient([[text('{}')]]);
            const p = make(client);
            expect(p.capabilities.structuredOutput).toBe('json_object');
            await p.chat([userMsg('q')], [], recorder().callbacks, { responseFormat: format });
            expect(oaiParams(create).response_format).toEqual({ type: 'json_object' });
        }
    });

    it('Ollama can opt in to native', async () => {
        const { client, create } = openaiClient([[text('{}')]]);
        const p = new OllamaProvider({ client, structuredOutput: 'native', ...fast });
        await p.chat([userMsg('q')], [], recorder().callbacks, { responseFormat: format });
        expect((oaiParams(create).response_format as { type: string }).type).toBe('json_schema');
    });

    it('none: the option is ignored; and without the option nothing is added', async () => {
        const a = openaiClient([[text('{}')]]);
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client: a.client, structuredOutput: 'none', ...fast })
            .chat([userMsg('q')], [], recorder().callbacks, { responseFormat: format });
        expect(oaiParams(a.create)).not.toHaveProperty('response_format');

        const b = openaiClient([[text('{}')]]);
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client: b.client, ...fast }).chat([userMsg('q')], [], recorder().callbacks);
        expect(oaiParams(b.create)).not.toHaveProperty('response_format');
    });

    it('maps toolChoice, keeping auto as the default', async () => {
        const choices: Array<[ChatOptions['toolChoice'], unknown]> = [
            [undefined, 'auto'], ['auto', 'auto'], ['none', 'none'], ['required', 'required'],
            [{ name: 't' }, { type: 'function', function: { name: 't' } }],
        ];
        for (const [input, expected] of choices) {
            const { client, create } = openaiClient([[text('{}')]]);
            await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, ...fast })
                .chat([userMsg('q')], [tool], recorder().callbacks, input ? { toolChoice: input } : undefined);
            expect(oaiParams(create).tool_choice).toEqual(expected);
        }
    });
});

describe('Anthropic: responseFormat', () => {
    type Params = Record<string, unknown> & { tools?: Array<Record<string, unknown>> };
    const params = (s: { mock: { calls: unknown[][] } }) => s.mock.calls[0][0] as Params;
    const textDelta = (t: string) => ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });

    it('native: output_config.format with the schema, no extra tool', async () => {
        const { client, stream } = anthropicClient([[textDelta('{}')]]);
        const p = new AnthropicProvider({ apiKey: 'k', client, ...fast });
        expect(p.capabilities.structuredOutput).toBe('native');
        await p.chat([userMsg('q')], [], recorder().callbacks, { responseFormat: format });
        expect(params(stream).output_config).toEqual({ format: { type: 'json_schema', schema } });
        expect(params(stream)).not.toHaveProperty('tools');
        expect(params(stream)).not.toHaveProperty('tool_choice');
    });

    it('tool mode: a single forced respond tool whose input comes back as the answer', async () => {
        const { client, stream } = anthropicClient([[
            ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'r1', name: 'respond' } }),
            ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":' } }),
            ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"hi"}' } }),
        ]]);
        const r = recorder();
        await new AnthropicProvider({ apiKey: 'k', client, structuredOutput: 'tool', ...fast })
            .chat([userMsg('q')], [], r.callbacks, { responseFormat: format });
        const p = params(stream);
        expect(p).not.toHaveProperty('output_config');
        expect(p.tools).toEqual([{ name: 'respond', description: expect.any(String), input_schema: schema }]);
        expect(p.tool_choice).toEqual({ type: 'tool', name: 'respond' });
        expect(r.chunks.join('')).toBe('{"a":"hi"}');
        expect(r.tools).toEqual([]);
        expect(r.done?.content).toBe('{"a":"hi"}');
        expect(r.done?.tool_calls).toBeUndefined();
    });

    it('tool mode cannot be combined with thinking', () => {
        expect(() => new AnthropicProvider({ apiKey: 'k', client: anthropicClient([[]]).client, structuredOutput: 'tool', thinking: { budgetTokens: 2000 } }))
            .toThrow(/cannot be combined with thinking/);
    });

    it('maps toolChoice', async () => {
        const choices: Array<[NonNullable<ChatOptions['toolChoice']>, unknown]> = [
            ['auto', { type: 'auto' }], ['none', { type: 'none' }], ['required', { type: 'any' }],
            [{ name: 't' }, { type: 'tool', name: 't' }],
        ];
        for (const [input, expected] of choices) {
            const { client, stream } = anthropicClient([[textDelta('x')]]);
            await new AnthropicProvider({ apiKey: 'k', client, ...fast }).chat([userMsg('q')], [tool], recorder().callbacks, { toolChoice: input });
            expect(params(stream).tool_choice).toEqual(expected);
        }
    });

    it('without options the request has no tool_choice or output_config', async () => {
        const { client, stream } = anthropicClient([[textDelta('x')]]);
        await new AnthropicProvider({ apiKey: 'k', client, ...fast }).chat([userMsg('q')], [tool], recorder().callbacks);
        expect(params(stream)).not.toHaveProperty('tool_choice');
        expect(params(stream)).not.toHaveProperty('output_config');
    });
});

describe('end to end with generateObject', () => {
    const Thing = z.object({ a: z.string() });

    it('OpenAI-compatible: sends response_format and returns the typed object', async () => {
        const { client, create } = openaiClient([[text('{"a":"x"}')]]);
        const out = await generateObject(new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client, ...fast }), 'make', Thing);
        expect(out).toEqual({ a: 'x' });
        expect(oaiParams(create).response_format).toMatchObject({ type: 'json_schema' });
    });

    it('DeepSeek: schema in the prompt, json_object, corrective retry on a bad answer', async () => {
        const { client, create } = openaiClient([[text('not json')], [text('{"a":"y"}')]]);
        const out = await generateObject(new DeepSeekProvider({ apiKey: 'k', client, ...fast }), 'make', Thing);
        expect(out).toEqual({ a: 'y' });
        expect(create).toHaveBeenCalledTimes(2);
        const first = oaiParams(create);
        expect((first.messages as Array<{ content: string }>)[0].content).toContain('JSON Schema');
        expect(first.response_format).toEqual({ type: 'json_object' });
    });

    it('Anthropic forced-tool mode round-trips through generateObject', async () => {
        const { client } = anthropicClient([[
            ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'r1', name: 'respond' } }),
            ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":"z"}' } }),
        ]]);
        const out = await generateObject(new AnthropicProvider({ apiKey: 'k', client, structuredOutput: 'tool', ...fast }), 'make', Thing);
        expect(out).toEqual({ a: 'z' });
    });
});

describe('forced toolChoice with a thinking-by-default backend (DeepSeek V4)', () => {
    const forced: Array<ChatOptions['toolChoice']> = ['required', { name: 't' }];

    it('DeepSeekProvider sends thinking disabled when a tool is forced', async () => {
        for (const toolChoice of forced) {
            const { client, create } = openaiClient([[text('{}')]]);
            await new DeepSeekProvider({ apiKey: 'k', client, ...fast }).chat([userMsg('q')], [tool], recorder().callbacks, { toolChoice });
            expect(oaiParams(create).thinking).toEqual({ type: 'disabled' });
        }
    });

    it('leaves thinking out for auto / none / no option', async () => {
        for (const options of [undefined, { toolChoice: 'auto' as const }, { toolChoice: 'none' as const }]) {
            const { client, create } = openaiClient([[text('{}')]]);
            await new DeepSeekProvider({ apiKey: 'k', client, ...fast }).chat([userMsg('q')], [tool], recorder().callbacks, options);
            expect(oaiParams(create)).not.toHaveProperty('thinking');
        }
    });

    it('an explicit thinking setting wins', async () => {
        const { client, create } = openaiClient([[text('{}')]]);
        await new DeepSeekProvider({ apiKey: 'k', client, thinking: 'enabled', ...fast })
            .chat([userMsg('q')], [tool], recorder().callbacks, { toolChoice: 'required' });
        expect(oaiParams(create).thinking).toEqual({ type: 'enabled' });
    });

    it('can be switched off, and the generic provider never adds the field', async () => {
        const a = openaiClient([[text('{}')]]);
        await new DeepSeekProvider({ apiKey: 'k', client: a.client, disableThinkingForForcedTools: false, ...fast })
            .chat([userMsg('q')], [tool], recorder().callbacks, { toolChoice: 'required' });
        expect(oaiParams(a.create)).not.toHaveProperty('thinking');

        const b = openaiClient([[text('{}')]]);
        await new OpenAICompatibleProvider({ apiKey: 'k', model: 'm', client: b.client, ...fast })
            .chat([userMsg('q')], [tool], recorder().callbacks, { toolChoice: 'required' });
        expect(oaiParams(b.create)).not.toHaveProperty('thinking');
    });
});
