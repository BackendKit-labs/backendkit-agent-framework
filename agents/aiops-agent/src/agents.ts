import { retry } from '@backendkit-labs/retry';
import type { LLMProvider, LLMMessage } from '@backendkit-labs/agent-core';
import type { z } from '@backendkit-labs/agent-core';
import {
    CLASSIFIER_SYSTEM, DECIDER_SYSTEM, RETRY_FEEDBACK, classifierUser, deciderUser, type DeciderContext,
} from './prompts';
import { ClassificationSchema, DecisionSchema, type Classification, type Decision } from './types';

/** Single-turn text completion. Implemented over an LLMProvider; tests inject scripted stubs. */
export interface LLMClient {
    complete(system: string, user: string): Promise<string>;
}

/** LLMClient backed by any framework LLMProvider (OllamaProvider in production). */
export class ProviderLLM implements LLMClient {
    constructor(private readonly provider: LLMProvider, private readonly timeoutMs = 120_000) {}

    async complete(system: string, user: string): Promise<string> {
        const messages: LLMMessage[] = [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ];
        const attempt = (): Promise<string> => new Promise<string>((resolve, reject) => {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                controller.abort();
                reject(new Error(`LLM timeout tras ${this.timeoutMs} ms`));
            }, this.timeoutMs);
            this.provider.chat(messages, [], {
                signal: controller.signal,
                onDone: m => { clearTimeout(timer); resolve(m.content ?? ''); },
                onError: e => { clearTimeout(timer); reject(e); },
            }).catch(e => { clearTimeout(timer); reject(e); });
        });
        const res = await retry(attempt, {
            maxAttempts: 2,
            backoff: { type: 'exponential', baseDelay: 500 },
            retryIf: () => true,
        });
        if (res.ok) return res.value;
        throw new Error(`LLM no disponible: ${res.error.message}`);
    }
}

export class AgentError extends Error {
    constructor(readonly agent: string, message: string) {
        super(message);
        this.name = 'AgentError';
    }
}

/** Extract the first JSON object from a model reply (tolerates code fences / prose). */
export function extractJson(raw: string): unknown {
    const cleaned = raw.replace(/```(?:json)?/gi, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('no se encontró un objeto JSON');
    return JSON.parse(cleaned.slice(start, end + 1));
}

/** Ask → parse → zod-validate; one retry with error feedback, then AgentError. */
async function askStructured<S extends z.ZodTypeAny>(
    agent: string, llm: LLMClient, system: string, user: string, schema: S,
): Promise<z.infer<S>> {
    let lastErr = '';
    for (let i = 0; i < 2; i++) {
        const prompt = i === 0 ? user : `${user}\n\n${RETRY_FEEDBACK(lastErr)}`;
        const raw = await llm.complete(system, prompt);
        try {
            const parsed = schema.safeParse(extractJson(raw));
            if (parsed.success) return parsed.data as z.infer<S>;
            lastErr = parsed.error.issues.map(x => `${x.path.join('.') || 'root'}: ${x.message}`).join('; ');
        } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e);
        }
    }
    throw new AgentError(agent, `salida inválida del modelo tras 2 intentos: ${lastErr}`);
}

export class ClassifierAgent {
    readonly name = 'classifier';
    constructor(private readonly llm: LLMClient) {}

    classify(alertText: string): Promise<Classification> {
        return askStructured(this.name, this.llm, CLASSIFIER_SYSTEM, classifierUser(alertText), ClassificationSchema);
    }
}

export class DeciderAgent {
    readonly name = 'decider';
    constructor(private readonly llm: LLMClient) {}

    /** Returns a validated Decision. An action outside the enum fails zod → AgentError. */
    decide(ctx: DeciderContext): Promise<Decision> {
        return askStructured(this.name, this.llm, DECIDER_SYSTEM, deciderUser(ctx), DecisionSchema);
    }
}
