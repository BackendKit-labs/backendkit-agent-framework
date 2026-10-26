import { ORCHESTRATOR_PROVIDERS, PROVIDER_DEFAULTS, PROVIDER_ENV } from '../scaffold';
import type { ProviderId } from '../prompts';

const providers = Object.keys(PROVIDER_DEFAULTS) as ProviderId[];

describe('provider tables share one source for model and endpoint', () => {
    it('covers the same providers everywhere', () => {
        expect(Object.keys(PROVIDER_ENV).sort()).toEqual([...providers].sort());
        expect(Object.keys(ORCHESTRATOR_PROVIDERS).sort()).toEqual([...providers].sort());
    });

    it.each(providers)('%s: the project .env and the orchestrator.yaml agree on the model', (id) => {
        expect(PROVIDER_ENV[id].model).toBe(PROVIDER_DEFAULTS[id].model);
        expect(ORCHESTRATOR_PROVIDERS[id].model).toBe(PROVIDER_DEFAULTS[id].model);
    });

    it.each(providers.filter(p => p !== 'ollama'))('%s: ...and on the base URL', (id) => {
        expect(PROVIDER_ENV[id].baseUrl).toBe(PROVIDER_DEFAULTS[id].baseUrl);
        expect(ORCHESTRATOR_PROVIDERS[id].baseUrl).toBe(PROVIDER_DEFAULTS[id].baseUrl);
    });

    it('ollama is the one deliberate difference: the orchestrator names the endpoint, a project reads OLLAMA_BASE_URL', () => {
        expect(PROVIDER_ENV.ollama.baseUrl).toBeUndefined();
        expect(PROVIDER_ENV.ollama.varName).toBe('OLLAMA_BASE_URL');
        expect(ORCHESTRATOR_PROVIDERS.ollama.baseUrl).toBe('http://localhost:11434');
    });

    it('keeps each target\'s own env var names (they differ on purpose for DeepSeek)', () => {
        expect(PROVIDER_ENV.deepseek.varName).toBe('LLM_API_KEY');
        expect(ORCHESTRATOR_PROVIDERS.deepseek.keyVar).toBe('DEEPSEEK_API_KEY');
        expect(ORCHESTRATOR_PROVIDERS.ollama.keyVar).toBe('');
    });

    it('the generated values are the same as before the refactor', () => {
        expect(PROVIDER_ENV).toEqual({
            anthropic: { varName: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-...', model: 'claude-sonnet-4-6' },
            openai:    { varName: 'OPENAI_API_KEY', placeholder: 'sk-...', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
            deepseek:  { varName: 'LLM_API_KEY', placeholder: 'sk-...', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
            ollama:    { varName: 'OLLAMA_BASE_URL', placeholder: 'http://localhost:11434', model: 'llama3.2' },
        });
        expect(ORCHESTRATOR_PROVIDERS).toEqual({
            deepseek:  { id: 'deepseek',  keyVar: 'DEEPSEEK_API_KEY',  model: 'deepseek-chat',    baseUrl: 'https://api.deepseek.com/v1' },
            anthropic: { id: 'anthropic', keyVar: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-6' },
            openai:    { id: 'openai',    keyVar: 'OPENAI_API_KEY',    model: 'gpt-4o',           baseUrl: 'https://api.openai.com/v1' },
            ollama:    { id: 'ollama',    keyVar: '',                  model: 'llama3.2',         baseUrl: 'http://localhost:11434' },
        });
    });
});
