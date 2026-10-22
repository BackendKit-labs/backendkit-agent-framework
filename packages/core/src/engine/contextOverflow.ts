const OVERFLOW_PATTERNS: RegExp[] = [
    /maximum context length/i,
    /context[_ ]length/i,
    /prompt is too long/i,
    /too many tokens/i,
    /exceeds? the (model|context) (limit|window)/i,
    /reduce the length/i,
    /input is too long/i,
];

function statusOf(err: unknown): number | undefined {
    if (typeof err !== 'object' || err === null) return undefined;
    const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
    for (const v of [e.status, e.statusCode, e.response?.status]) {
        if (typeof v === 'number') return v;
    }
    return undefined;
}

/**
 * True when a provider rejected the request because it did not fit the model's context window
 * (OpenAI-compatible incl. DeepSeek, Anthropic, Ollama). Rate limits, 5xx and unrelated 400s are not overflow.
 * Providers that wrap the failure in a plain `Error` (no status) are matched on the message alone.
 */
export function isContextOverflowError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : (err as { message?: unknown } | null)?.message;
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 'context_length_exceeded') return true;
    if (typeof message !== 'string') return false;
    const status = statusOf(err);
    if (status !== undefined && status !== 400 && status !== 413) return false;
    return OVERFLOW_PATTERNS.some(p => p.test(message));
}
