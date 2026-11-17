import { PROVIDER_DEFAULTS, PROVIDER_ENV } from '../scaffold';
import type { ProviderId } from '../prompts';

const providers = Object.keys(PROVIDER_DEFAULTS) as ProviderId[];

describe('provider tables share one source for model and endpoint', () => {
    it('covers the same providers everywhere', () => {
        expect(Object.keys(PROVIDER_ENV).sort()).toEqual([...providers].sort());
    });

    it.each(providers)('%s: the project .env agrees on the model', (id) => {
        expect(PROVIDER_ENV[id].model).toBe(PROVIDER_DEFAULTS[id].model);
    });

    it.each(providers.filter(p => p !== 'ollama'))('%s: ...and on the base URL', (id) => {
        expect(PROVIDER_ENV[id].baseUrl).toBe(PROVIDER_DEFAULTS[id].baseUrl);
    });

    it('ollama has no base URL: a project reads OLLAMA_BASE_URL', () => {
        expect(PROVIDER_ENV.ollama.baseUrl).toBeUndefined();
        expect(PROVIDER_ENV.ollama.varName).toBe('OLLAMA_BASE_URL');
    });

    it('keeps the DeepSeek env var name', () => {
        expect(PROVIDER_ENV.deepseek.varName).toBe('LLM_API_KEY');
    });

    it('the generated values are the same as before the refactor', () => {
        expect(PROVIDER_ENV).toEqual({
            anthropic: { varName: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-...', model: 'claude-sonnet-4-6' },
            openai:    { varName: 'OPENAI_API_KEY', placeholder: 'sk-...', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
            deepseek:  { varName: 'LLM_API_KEY', placeholder: 'sk-...', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
            ollama:    { varName: 'OLLAMA_BASE_URL', placeholder: 'http://localhost:11434', model: 'llama3.2' },
        });
    });
});
