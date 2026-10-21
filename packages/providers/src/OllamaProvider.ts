import { OpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from './OpenAICompatibleProvider';
import { httpStatus, isNetworkError } from './retry';

export const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';
export const OLLAMA_DEFAULT_MODEL = 'llama3.2';

export interface OllamaProviderOptions
    extends Omit<OpenAICompatibleProviderOptions, 'apiKey' | 'baseUrl' | 'model' | 'maxRetries' | 'thinking'> {
    /** Ollama host. Default: http://localhost:11434 */
    host?: string;
    /** Model loaded in Ollama (e.g. 'llama3.2', 'phi3-mini', 'mistral'). Default: llama3.2 */
    model?: string;
    /**
     * @deprecated Use `maxAttempts`. Counts *retries* (total attempts = maxRetries + 1), as before.
     * Default: 2 retries, i.e. 3 attempts.
     */
    maxRetries?: number;
}

/** Local Ollama through its OpenAI-compatible endpoint: short backoff, helpful connection errors. */
export class OllamaProvider extends OpenAICompatibleProvider {
    private readonly host: string;

    constructor(opts: OllamaProviderOptions = {}) {
        const host = (opts.host ?? OLLAMA_DEFAULT_HOST).replace(/\/$/, '');
        super({
            ...opts,
            apiKey: 'ollama',
            baseUrl: `${host}/v1`,
            model: opts.model ?? OLLAMA_DEFAULT_MODEL,
            maxTokens: opts.maxTokens === undefined ? 4096 : opts.maxTokens,
            maxAttempts: opts.maxAttempts ?? (opts.maxRetries !== undefined ? opts.maxRetries + 1 : undefined),
            maxRetries: undefined,
        }, { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 4000 });
        this.host = host;
    }

    /** Verifica que Ollama esté corriendo. Lanza error con instrucciones si no está disponible. */
    async checkConnection(): Promise<void> {
        try {
            const res = await fetch(`${this.host}/api/tags`);
            if (!res.ok) throw new Error(`Ollama respondió con status ${res.status}`);
        } catch (err) {
            if (isNetworkError(err)) {
                throw new Error(
                    `No se puede conectar a Ollama en ${this.host}.\n` +
                    `Asegúrate de que Ollama esté corriendo con: ollama serve\n` +
                    `Si usas un host distinto, configura OLLAMA_HOST en tu .env`
                );
            }
            throw err;
        }
    }

    protected toError(err: unknown): Error {
        if (isNetworkError(err)) {
            return new Error(`Ollama no está disponible en ${this.host}. Ejecuta: ollama serve`);
        }
        if (httpStatus(err) === 404) {
            return new Error(`Modelo '${this.model}' no encontrado en Ollama. Descárgalo con: ollama pull ${this.model}`);
        }
        return super.toError(err);
    }
}
