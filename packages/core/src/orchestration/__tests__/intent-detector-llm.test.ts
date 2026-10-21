import { detectIntent, type LLMChatClient } from '../intent-detector';
import { adaptProviderToLLMClient } from '../llm-client-adapter';
import type { ChatOptions, LLMProvider } from '../../types';

/** SPEC-0001 §5 (ADR-0003): the LLM tie-breaker answers a schema-checked object, no regex. */

// No keyword in the text, so the LLM classifier is the one that decides.
const NO_SIGNAL = 'zzz qqq xxx';

function client(answers: string[]) {
    const calls: Array<{ messages: Array<{ role: string; content: string }>; options?: ChatOptions }> = [];
    const c: LLMChatClient = {
        async chat(messages, _tools, _temperature, options) {
            calls.push({ messages: messages.map(m => ({ ...m })), options });
            return { content: answers.shift() ?? null };
        },
    };
    return { c, calls };
}

describe('intent-detector LLM classification', () => {
    it('reads the action from a JSON object', async () => {
        const { c, calls } = client(['{"action":"design"}']);
        const r = await detectIntent(NO_SIGNAL, c);
        expect(r).toMatchObject({ actionType: 'design', method: 'llm' });
        expect(r.scores.design).toBeGreaterThanOrEqual(3);
        expect(calls[0].options?.responseFormat?.name).toBe('response');
        expect(JSON.stringify(calls[0].options?.responseFormat?.schema)).toContain('design');
    });

    it('does not depend on the exact formatting of the JSON', async () => {
        const { c } = client(['```json\n{ "action" : "implementation" }\n```']);
        expect((await detectIntent(NO_SIGNAL, c)).actionType).toBe('implementation');
    });

    it('a response that is not JSON gets one corrective retry, then falls back to unknown', async () => {
        const { c, calls } = client(['I think this is a design task', 'still not json']);
        const r = await detectIntent(NO_SIGNAL, c);
        expect(r.actionType).toBe('unknown');
        expect(r.method).toBe('llm');
        expect(calls).toHaveLength(2);
    });

    it('recovers when the retry is valid', async () => {
        const { c, calls } = client(['no idea', '{"action":"design"}']);
        expect((await detectIntent(NO_SIGNAL, c)).actionType).toBe('design');
        expect(calls).toHaveLength(2);
    });

    it('an action outside the allowed list is rejected', async () => {
        const { c } = client(['{"action":"banana"}', '{"action":"banana"}']);
        expect((await detectIntent(NO_SIGNAL, c)).actionType).toBe('unknown');
    });

    it('adaptProviderToLLMClient forwards the chat options to the provider', async () => {
        let received: ChatOptions | undefined;
        const provider: LLMProvider = {
            async chat(_m, _t, cb, options) { received = options; cb.onChunk?.('{"action":"design"}'); cb.onDone({ role: 'assistant', content: null }); },
        };
        const r = await detectIntent(NO_SIGNAL, adaptProviderToLLMClient(provider));
        expect(r.actionType).toBe('design');
        expect(received?.responseFormat?.type).toBe('json_schema');
    });
});
