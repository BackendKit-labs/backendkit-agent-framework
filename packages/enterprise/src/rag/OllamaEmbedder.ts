export const OLLAMA_EMBED_DEFAULT_MODEL = 'nomic-embed-text';
export const OLLAMA_EMBED_DEFAULT_HOST  = 'http://localhost:11434';

const DEFAULT_TIMEOUT_MS  = 30_000;
const MAX_RETRIES         = 3;
const BACKOFF_BASE_MS     = 500;

export interface OllamaEmbedderOptions {
    host?:       string;
    model?:      string;
    timeoutMs?:  number;  // per-request timeout (default 30s)
    maxRetries?: number;  // retries on transient errors (default 3)
}

interface EmbedResponse {
    embeddings: number[][];
}

export class OllamaEmbedder {
    private readonly host:       string;
    private readonly timeoutMs:  number;
    private readonly maxRetries: number;
    readonly model: string;

    constructor(opts: OllamaEmbedderOptions = {}) {
        this.host       = (opts.host ?? OLLAMA_EMBED_DEFAULT_HOST).replace(/\/$/, '');
        this.model      = opts.model      ?? OLLAMA_EMBED_DEFAULT_MODEL;
        this.timeoutMs  = opts.timeoutMs  ?? DEFAULT_TIMEOUT_MS;
        this.maxRetries = opts.maxRetries ?? MAX_RETRIES;
    }

    async embed(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];
        return this.withRetry(() => this.fetchEmbeddings(texts));
    }

    async embedOne(text: string): Promise<number[]> {
        const results = await this.embed([text]);
        return results[0] ?? [];
    }

    async checkConnection(): Promise<void> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(`${this.host}/api/tags`, { signal: controller.signal });
            if (!res.ok) throw new Error(`Status ${res.status}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
                `No se puede conectar a Ollama en ${this.host}: ${msg}\n` +
                `Asegúrate de que Ollama esté corriendo con: ollama serve`,
            );
        } finally {
            clearTimeout(timer);
        }
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async fetchEmbeddings(texts: string[]): Promise<number[][]> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const res = await fetch(`${this.host}/api/embed`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ model: this.model, input: texts }),
                signal:  controller.signal,
            });

            if (!res.ok) {
                const body = await res.text().catch(() => '');
                if (res.status === 404) {
                    throw new Error(
                        `Modelo de embeddings '${this.model}' no encontrado en Ollama. ` +
                        `Descárgalo con: ollama pull ${this.model}`,
                    );
                }
                // 5xx → retryable; 4xx (except 404) → not retryable
                const err = new Error(`Ollama /api/embed error ${res.status}: ${body}`);
                (err as NodeJS.ErrnoException).code = res.status >= 500 ? 'RETRYABLE' : 'FATAL';
                throw err;
            }

            const data = await res.json() as EmbedResponse;
            return data.embeddings;
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                const timeout = new Error(
                    `Ollama embed timed out after ${this.timeoutMs}ms. ` +
                    `El modelo puede estar cargando — reintentando.`,
                );
                (timeout as NodeJS.ErrnoException).code = 'RETRYABLE';
                throw timeout;
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
        let lastErr: Error = new Error('unknown');
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastErr = err instanceof Error ? err : new Error(String(err));
                const code = (lastErr as NodeJS.ErrnoException).code;
                // Non-retryable errors (bad model name, 4xx) bubble immediately
                if (code === 'FATAL') throw lastErr;
                if (attempt < this.maxRetries - 1) {
                    const delay = BACKOFF_BASE_MS * 2 ** attempt;
                    await sleep(delay);
                }
            }
        }
        throw lastErr;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
