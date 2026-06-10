import OpenAI from 'openai';
import type { LLMProvider, LLMMessage, LLMStreamCallbacks, ToolDefinition } from '@backendkit-labs/agent-core';

export const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';
export const OLLAMA_DEFAULT_MODEL = 'llama3.2';

export interface OllamaProviderOptions {
    /** Ollama host. Default: http://localhost:11434 */
    host?: string;
    /** Model loaded in Ollama (e.g. 'llama3.2', 'phi3-mini', 'mistral'). Default: llama3.2 */
    model?: string;
    maxTokens?: number;
    temperature?: number;
    /** Max retry attempts on connection errors. Default: 2. */
    maxRetries?: number;
}

function isConnectionError(err: unknown): boolean {
    if (err && typeof err === 'object') {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND') return true;
        const msg = (err as Error).message ?? '';
        if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('connect')) return true;
    }
    return false;
}

function isRetryableHttpError(err: unknown): boolean {
    if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status: number }).status;
        return status >= 500;
    }
    return false;
}

function backoffMs(attempt: number): number {
    return Math.min(500 * Math.pow(2, attempt), 4_000);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class OllamaProvider implements LLMProvider {
    private readonly client: OpenAI;
    private readonly model: string;
    private readonly maxTokens: number;
    private readonly temperature: number;
    private readonly maxRetries: number;
    private readonly host: string;

    constructor(opts: OllamaProviderOptions = {}) {
        this.host = (opts.host ?? OLLAMA_DEFAULT_HOST).replace(/\/$/, '');
        this.model = opts.model ?? OLLAMA_DEFAULT_MODEL;
        this.maxTokens = opts.maxTokens ?? 4096;
        this.temperature = opts.temperature ?? 0.0;
        this.maxRetries = opts.maxRetries ?? 2;

        this.client = new OpenAI({
            apiKey: 'ollama',
            baseURL: `${this.host}/v1`,
            maxRetries: 0,
        });
    }

    /** Verifica que Ollama esté corriendo. Lanza error con instrucciones si no está disponible. */
    async checkConnection(): Promise<void> {
        try {
            const res = await fetch(`${this.host}/api/tags`);
            if (!res.ok) throw new Error(`Ollama respondió con status ${res.status}`);
        } catch (err) {
            if (isConnectionError(err)) {
                throw new Error(
                    `No se puede conectar a Ollama en ${this.host}.\n` +
                    `Asegúrate de que Ollama esté corriendo con: ollama serve\n` +
                    `Si usas un host distinto, configura OLLAMA_HOST en tu .env`
                );
            }
            throw err;
        }
    }

    async chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks): Promise<void> {
        const openaiTools = tools.map(t => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
        }));

        let attempt = 0;
        let contentEmitted = false;

        while (attempt <= this.maxRetries) {
            attempt++;
            try {
                await this.stream(messages, openaiTools, {
                    ...callbacks,
                    onChunk: (delta) => {
                        contentEmitted = true;
                        callbacks.onChunk?.(delta);
                    },
                });
                return;
            } catch (err) {
                const retryable = !contentEmitted && (isConnectionError(err) || isRetryableHttpError(err));
                if (!retryable || attempt > this.maxRetries) {
                    const error = this.enrichError(err);
                    callbacks.onError(error);
                    return;
                }
                await sleep(backoffMs(attempt));
            }
        }
    }

    private async stream(
        messages: LLMMessage[],
        openaiTools: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>,
        callbacks: LLMStreamCallbacks,
    ): Promise<void> {
        const hasTools = openaiTools.length > 0;
        const stream = await this.client.chat.completions.create({
            model: callbacks.model ?? this.model,
            messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
            tools: hasTools ? openaiTools as OpenAI.Chat.ChatCompletionTool[] : undefined,
            tool_choice: hasTools ? 'auto' : undefined,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
            stream: true,
        }, { signal: callbacks.signal });

        let contentBuffer = '';
        const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

        for await (const chunk of stream) {
            if (chunk.usage) {
                callbacks.onMetrics?.(chunk.usage.prompt_tokens, chunk.usage.completion_tokens);
            }

            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
                contentBuffer += delta.content;
                callbacks.onChunk?.(delta.content);
            }

            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (!toolCallBuffers.has(tc.index)) {
                        toolCallBuffers.set(tc.index, { id: tc.id ?? '', name: '', args: '' });
                    }
                    const buf = toolCallBuffers.get(tc.index)!;
                    if (tc.id) buf.id = tc.id;
                    if (tc.function?.name) buf.name += tc.function.name;
                    if (tc.function?.arguments) buf.args += tc.function.arguments;
                }
            }
        }

        const toolCalls = Array.from(toolCallBuffers.entries())
            .sort(([a], [b]) => a - b)
            .map(([, buf]) => ({
                id: buf.id,
                type: 'function' as const,
                function: { name: buf.name, arguments: buf.args },
            }));

        for (const tc of toolCalls) {
            callbacks.onToolCall?.(tc.function.name, tc.function.arguments, tc.id);
        }

        callbacks.onDone({
            role: 'assistant',
            content: contentBuffer || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        });
    }

    private enrichError(err: unknown): Error {
        if (isConnectionError(err)) {
            return new Error(
                `Ollama no está disponible en ${this.host}. ` +
                `Ejecuta: ollama serve`
            );
        }
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
            return new Error(
                `Modelo '${this.model}' no encontrado en Ollama. ` +
                `Descárgalo con: ollama pull ${this.model}`
            );
        }
        return err instanceof Error ? err : new Error(String(err));
    }
}
