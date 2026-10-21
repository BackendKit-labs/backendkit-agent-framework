import type { ZodType, ZodTypeAny } from 'zod';
import { zodToParameters } from '../tools/defineTool';
import type { ChatOptions, LLMMessage, LLMProvider, LLMStreamCallbacks, StructuredOutputSupport } from '../types';

/**
 * Thrown when the model never produced an answer that matches the schema.
 * `raw` is the last response text; `issues` the last validation problem (zod issues or a parse error).
 */
export class StructuredOutputError extends Error {
    constructor(message: string, readonly raw: string, readonly issues: unknown) {
        super(message);
        this.name = 'StructuredOutputError';
    }
}

export interface GenerateObjectOptions {
    /** Extra attempts after an invalid answer, each one told what was wrong. Default 1. */
    retries?: number;
    /** Per-call model override. */
    model?: string;
    /** Name of the schema for providers that need one. Default `response`. */
    name?: string;
    system?: string;
    signal?: AbortSignal;
    /** Receives the token usage of every attempt, so callers can account for the cost. */
    onMetrics?: LLMStreamCallbacks['onMetrics'];
}

/** Anything that turns messages into response text; lets non-provider clients reuse `generateObjectWith`. */
export type StructuredChat = (messages: LLMMessage[], options: ChatOptions) => Promise<string>;

/**
 * Asks `provider` for an object matching `schema`, validates it with zod and returns it typed.
 * An invalid answer is retried (once by default) with the problem described to the model; if it
 * is still invalid a `StructuredOutputError` is thrown. Provider failures are rethrown as they are.
 */
export function generateObject<T>(
    provider: LLMProvider,
    prompt: string,
    schema: ZodType<T>,
    opts: GenerateObjectOptions = {},
): Promise<T> {
    return generateObjectWith(
        providerChat(provider, opts),
        prompt,
        schema,
        opts,
        provider.capabilities?.structuredOutput,
    );
}

/** Same as `generateObject` over any chat function. `capability` tells how firmly the backend enforces the schema. */
export async function generateObjectWith<T>(
    chat: StructuredChat,
    prompt: string,
    schema: ZodType<T>,
    opts: GenerateObjectOptions = {},
    capability?: StructuredOutputSupport,
): Promise<T> {
    const jsonSchema = zodToParameters(schema as ZodTypeAny);
    // Unless the API enforces the schema, the model has to see it in the prompt.
    const userPrompt = capability === 'native'
        ? prompt
        : `${prompt}\n\nRespond with JSON only, matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`;

    const messages: LLMMessage[] = [
        ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
        { role: 'user', content: userPrompt },
    ];
    const options: ChatOptions = {
        responseFormat: { type: 'json_schema', name: opts.name ?? 'response', schema: jsonSchema, strict: true },
    };

    const attempts = 1 + Math.max(0, opts.retries ?? 1);
    let raw = '';
    let issues: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
        raw = await chat(messages, options);

        const parsed = parseJson(raw);
        if (parsed.ok) {
            const checked = schema.safeParse(parsed.value);
            if (checked.success) return checked.data;
            issues = checked.error.issues;
        } else {
            issues = parsed.error;
        }

        messages.push(
            { role: 'assistant', content: raw },
            { role: 'user', content: `That answer is not valid: ${describe(issues)}. Reply again with only the corrected JSON.` },
        );
    }

    throw new StructuredOutputError(
        `Model did not return a valid object after ${attempts} attempt(s): ${describe(issues)}`,
        raw,
        issues,
    );
}

// ── Internals ─────────────────────────────────────────────────────────────────

function providerChat(provider: LLMProvider, opts: GenerateObjectOptions): StructuredChat {
    return async (messages, options) => {
        let text = '';
        let failure: Error | undefined;
        let finalContent: string | null = null;
        await provider.chat(messages, [], {
            onChunk: (delta) => { text += delta; },
            onDone: (message) => { finalContent = message.content; },
            onError: (err) => { failure = err; },
            onMetrics: opts.onMetrics,
            signal: opts.signal,
            model: opts.model,
        }, options);
        if (failure) throw failure;
        return text || finalContent || '';
    };
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

/** JSON.parse that also tolerates a Markdown fence or chatter around the object. */
function parseJson(text: string): Parsed {
    const trimmed = text.trim();
    const candidates = [trimmed];

    const fence = trimmed.indexOf('```');
    if (fence !== -1) {
        const start = trimmed.indexOf('\n', fence);
        const end = trimmed.indexOf('```', start + 1);
        if (start !== -1 && end !== -1) candidates.push(trimmed.slice(start + 1, end).trim());
    }
    const open = trimmed.indexOf('{');
    const close = trimmed.lastIndexOf('}');
    if (open !== -1 && close > open) candidates.push(trimmed.slice(open, close + 1));

    let lastError = 'empty response';
    for (const candidate of candidates) {
        if (!candidate) continue;
        try { return { ok: true, value: JSON.parse(candidate) }; }
        catch (err) { lastError = `not valid JSON (${(err as Error).message})`; }
    }
    return { ok: false, error: lastError };
}

function describe(issues: unknown): string {
    if (typeof issues === 'string') return issues;
    if (Array.isArray(issues)) {
        return issues
            .map((i: { path?: Array<string | number>; message?: string }) =>
                `${i.path?.length ? i.path.join('.') : 'root'}: ${i.message ?? 'invalid'}`)
            .join('; ');
    }
    return String(issues);
}
