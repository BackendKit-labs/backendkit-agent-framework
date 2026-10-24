import { AnthropicAdapter, OpenAIAdapter, createProvider } from '../providers/index.js';
import { DEFAULT_COMPLETION_TIMEOUT_MS } from '../providers/types.js';

// the SDK clients keep the timeout they were built with; this is where a stalled request gets cut
const timeoutOf = (adapter: unknown): number => (adapter as { client: { timeout: number } }).client.timeout;

describe('completion timeout', () => {
    it('has an explicit default instead of the SDK one', () => {
        expect(DEFAULT_COMPLETION_TIMEOUT_MS).toBe(300_000);
        expect(timeoutOf(new OpenAIAdapter({ apiKey: 'k', model: 'm' }))).toBe(DEFAULT_COMPLETION_TIMEOUT_MS);
        expect(timeoutOf(new AnthropicAdapter({ apiKey: 'k' }))).toBe(DEFAULT_COMPLETION_TIMEOUT_MS);
    });

    it('can be set per adapter', () => {
        expect(timeoutOf(new OpenAIAdapter({ apiKey: 'k', model: 'm', timeoutMs: 45_000 }))).toBe(45_000);
        expect(timeoutOf(new AnthropicAdapter({ apiKey: 'k', timeoutMs: 45_000 }))).toBe(45_000);
    });

    it('createProvider passes it through to every provider kind', () => {
        for (const provider of ['openai', 'deepseek', 'ollama', 'anthropic'] as const) {
            expect(timeoutOf(createProvider({ provider, apiKey: 'k', timeoutMs: 12_345 }))).toBe(12_345);
            expect(timeoutOf(createProvider({ provider, apiKey: 'k' }))).toBe(DEFAULT_COMPLETION_TIMEOUT_MS);
        }
    });
});
