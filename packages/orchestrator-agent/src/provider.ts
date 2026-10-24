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

/** Longest a one-shot call may take before the run gives up on it. ORCHESTRATOR_LLM_TIMEOUT_MS overrides it. */
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;

export function llmTimeoutMs(env: Record<string, string | undefined> = process.env): number {
    const parsed = Number(env['ORCHESTRATOR_LLM_TIMEOUT_MS']);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LLM_TIMEOUT_MS;
}

/**
 * A provider that stalls mid-stream, or one whose chat() rejects without calling onError, used to leave this promise
 * pending forever: the run (or the worker) hung with it. Now the call is bounded, the request is cancelled through
 * the callbacks' AbortSignal, and a rejection of chat() itself fails the call.
 */
export async function callLLM(
    provider: LLMProvider,
    system: string,
    user: string,
    opts: { timeoutMs?: number } = {},
): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? llmTimeoutMs();
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        let result = '';
        const timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`LLM call timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const settle = (finish: () => void) => { clearTimeout(timer); finish(); };

        provider.chat(
            [
                { role: 'system',    content: system },
                { role: 'user',      content: user   },
            ],
            [],
            {
                onChunk:  (d)   => { result += d; },
                onDone:   ()    => settle(() => resolve(result)),
                onError:  (err) => settle(() => reject(err)),
                signal:   controller.signal,
            },
        ).catch((err: unknown) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))));
    });
}
