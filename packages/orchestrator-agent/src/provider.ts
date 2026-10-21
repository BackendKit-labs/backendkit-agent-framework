import { OpenAICompatibleProvider as BaseProvider } from '@backendkit-labs/agent-providers';
import type { LLMProvider } from '@backendkit-labs/agent-core';
import type { ProviderConfig } from './config.js';

// OpenAI-compatible provider — covers DeepSeek, Ollama, and OpenAI.
// DeepSeek: base_url=https://api.deepseek.com
// Ollama:   base_url=http://localhost:11434/v1, api_key=ollama
// OpenAI:   base_url omitted (default)
//
// The implementation lives in @backendkit-labs/agent-providers; this adapter only maps the
// orchestrator's snake_case config and keeps its two behaviours: no `max_tokens` in the request
// and temperature 1 for "reasoner" models.

export class OpenAICompatibleProvider extends BaseProvider {
    constructor(cfg: ProviderConfig, maxAttempts = 3) {
        super({
            apiKey: cfg.api_key ?? 'no-key',
            baseUrl: cfg.base_url,
            model: cfg.model,
            maxAttempts,
            maxTokens: null,
            temperature: (model) => (model.includes('reasoner') ? 1 : 0),
        });
    }
}

// ── Simple one-shot LLM call (no tools, no streaming, returns full text) ─────

export async function callLLM(
    provider: LLMProvider,
    system: string,
    user: string,
): Promise<string> {
    return new Promise((resolve, reject) => {
        let result = '';
        provider.chat(
            [
                { role: 'system',    content: system },
                { role: 'user',      content: user   },
            ],
            [],
            {
                onChunk:  (d)   => { result += d; },
                onDone:   ()    => { resolve(result); },
                onError:  (err) => { reject(err); },
            },
        );
    });
}
