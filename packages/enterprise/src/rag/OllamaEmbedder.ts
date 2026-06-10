export const OLLAMA_EMBED_DEFAULT_MODEL = 'nomic-embed-text';
export const OLLAMA_EMBED_DEFAULT_HOST = 'http://localhost:11434';

export interface OllamaEmbedderOptions {
    host?: string;
    model?: string;
}

interface EmbedResponse {
    embeddings: number[][];
}

export class OllamaEmbedder {
    private readonly host: string;
    readonly model: string;

    constructor(opts: OllamaEmbedderOptions = {}) {
        this.host = (opts.host ?? OLLAMA_EMBED_DEFAULT_HOST).replace(/\/$/, '');
        this.model = opts.model ?? OLLAMA_EMBED_DEFAULT_MODEL;
    }

    async embed(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        const res = await fetch(`${this.host}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: this.model, input: texts }),
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            if (res.status === 404) {
                throw new Error(
                    `Modelo de embeddings '${this.model}' no encontrado en Ollama. ` +
                    `Descárgalo con: ollama pull ${this.model}`
                );
            }
            throw new Error(`Ollama /api/embed error ${res.status}: ${body}`);
        }

        const data = await res.json() as EmbedResponse;
        return data.embeddings;
    }

    async embedOne(text: string): Promise<number[]> {
        const results = await this.embed([text]);
        return results[0] ?? [];
    }

    async checkConnection(): Promise<void> {
        try {
            const res = await fetch(`${this.host}/api/tags`);
            if (!res.ok) throw new Error(`Status ${res.status}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
                `No se puede conectar a Ollama en ${this.host}: ${msg}\n` +
                `Asegúrate de que Ollama esté corriendo con: ollama serve`
            );
        }
    }
}
