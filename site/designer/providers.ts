/**
 * Talking to a model provider from the visitor's browser, with the visitor's own key (SPEC-0040 D3). The key goes in one place: the
 * `Authorization` header of the request to the provider. Never in a URL, never to this site, never stored.
 *
 * One provider for now. Its CORS preflight accepts this site (SPEC-0040 §3-bis); the real request is what the first live run checks.
 */
import { ProviderError, type Complete } from './generate.ts';
import type { Message } from './prompt.ts';

export interface ProviderPreset {
    id: string;
    name: string;
    /** The only host the key is sent to. The page says so. */
    host: string;
    endpoint: string;
    model: string;
    /** Extra fields this provider needs in the body. */
    extraBody?: Record<string, unknown>;
    /** Where the visitor gets a key. */
    keyUrl: string;
}

export const DEEPSEEK: ProviderPreset = {
    id: 'deepseek',
    name: 'DeepSeek',
    host: 'api.deepseek.com',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-flash',
    // Thinking is on by default in V4: for a JSON answer it only adds time and cost.
    extraBody: { thinking: { type: 'disabled' } },
    keyUrl: 'https://platform.deepseek.com/api_keys',
};

export const PRESETS: Record<string, ProviderPreset> = { deepseek: DEEPSEEK };

const TIMEOUT_MS = 120_000;
const clip = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n)}...` : s);

/** What the provider said went wrong, in words for the visitor. Never includes the key. */
function describe(preset: ProviderPreset, status: number, body: string): string {
    let detail = '';
    try { const j = JSON.parse(body) as { error?: { message?: string } | string }; detail = typeof j.error === 'string' ? j.error : (j.error?.message ?? ''); } catch { detail = ''; }
    const said = detail ? ` ${preset.name} said: ${clip(detail)}` : '';
    if (status === 401 || status === 403) return `${preset.name} rejected the key (${status}). Check that you pasted the whole key.${said}`;
    if (status === 402) return `${preset.name} says the account has no balance (402).${said}`;
    if (status === 429) return `${preset.name} is limiting requests (429). Wait a moment and try again.${said}`;
    if (status >= 500) return `${preset.name} had an error (${status}). Try again in a moment.${said}`;
    return `${preset.name} refused the request (${status}).${said}`;
}

/**
 * A `Complete` for an OpenAI-compatible chat endpoint. `fetchImpl` is injectable so the request is testable without a key or a network.
 * No retries: a failure is reported once, as it is, so a hidden retry cannot spend the visitor's key.
 */
export function openAiCompatible(preset: ProviderPreset, apiKey: string, fetchImpl: typeof fetch = fetch): Complete {
    return async (messages: Message[]) => {
        if (!apiKey.trim()) throw new ProviderError('Paste your key first.');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let response: Response;
        try {
            response = await fetchImpl(preset.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
                body: JSON.stringify({
                    model: preset.model, messages, temperature: 0.2, max_tokens: 8000, stream: false,
                    response_format: { type: 'json_object' }, ...(preset.extraBody ?? {}),
                }),
                signal: controller.signal,
                // The page is public and the key is the visitor's: send nothing else of the visitor's to the provider.
                credentials: 'omit', referrerPolicy: 'no-referrer',
            });
        } catch (err) {
            if (controller.signal.aborted) throw new ProviderError(`${preset.name} did not answer in ${TIMEOUT_MS / 1000} seconds.`);
            throw new ProviderError(`Could not reach ${preset.host}. Check your connection; if it persists, the provider may be refusing requests from a browser.`);
        } finally {
            clearTimeout(timer);
        }
        const text = await response.text();
        if (!response.ok) throw new ProviderError(describe(preset, response.status, text), response.status);
        let json: { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        try { json = JSON.parse(text); } catch { throw new ProviderError(`${preset.name} answered with something that is not JSON.`); }
        const choice = json.choices?.[0];
        const content = choice?.message?.content;
        if (typeof content !== 'string' || content.length === 0) throw new ProviderError(`${preset.name} answered with no content.`);
        if (choice?.finish_reason === 'length') throw new ProviderError(`${preset.name} stopped before it finished the design (token limit). Ask for something smaller.`);
        return { text: content, usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 } };
    };
}
