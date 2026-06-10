import { OllamaEmbedder } from '../../rag/OllamaEmbedder';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBEDDING_MODEL ?? 'nomic-embed-text';

async function ollamaAvailable(): Promise<boolean> {
    try {
        const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
            signal: AbortSignal.timeout(3000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function modelAvailable(model: string): Promise<boolean> {
    try {
        const res = await fetch(`${OLLAMA_HOST}/api/tags`);
        const data = await res.json() as { models?: Array<{ name: string }> };
        return (data.models ?? []).some(m => m.name.startsWith(model));
    } catch {
        return false;
    }
}

describe('OllamaEmbedder — integración', () => {
    let available = false;

    beforeAll(async () => {
        available = await ollamaAvailable() && await modelAvailable(EMBED_MODEL);
        if (!available) {
            console.warn(
                `\n⚠  OllamaEmbedder tests saltados — Ollama no disponible en ${OLLAMA_HOST} ` +
                `o modelo '${EMBED_MODEL}' no descargado.\n` +
                `   Para ejecutarlos: ollama serve && ollama pull ${EMBED_MODEL}\n`
            );
        }
    });

    test('checkConnection no lanza si Ollama está corriendo', async () => {
        if (!available) return;
        const embedder = new OllamaEmbedder({ host: OLLAMA_HOST, model: EMBED_MODEL });
        await expect(embedder.checkConnection()).resolves.not.toThrow();
    });

    test('embedOne devuelve un vector de la dimensión correcta (768 para nomic-embed-text)', async () => {
        if (!available) return;
        const embedder = new OllamaEmbedder({ host: OLLAMA_HOST, model: EMBED_MODEL });
        const vec = await embedder.embedOne('Hola mundo');
        expect(Array.isArray(vec)).toBe(true);
        expect(vec.length).toBeGreaterThan(0);
        // nomic-embed-text produce vectores de 768 dimensiones
        if (EMBED_MODEL === 'nomic-embed-text') {
            expect(vec.length).toBe(768);
        }
    });

    test('embed([]) devuelve array vacío sin llamar a Ollama', async () => {
        // Este test no requiere Ollama — verifica el early-return
        const embedder = new OllamaEmbedder({ host: OLLAMA_HOST, model: EMBED_MODEL });
        const result = await embedder.embed([]);
        expect(result).toEqual([]);
    });

    test('embed de un batch devuelve tantos vectores como textos', async () => {
        if (!available) return;
        const embedder = new OllamaEmbedder({ host: OLLAMA_HOST, model: EMBED_MODEL });
        const texts = ['primer texto', 'segundo texto', 'tercer texto'];
        const vecs = await embedder.embed(texts);
        expect(vecs).toHaveLength(3);
        for (const v of vecs) {
            expect(v.length).toBeGreaterThan(0);
        }
    });

    test('textos similares tienen mayor similitud coseno que textos no relacionados', async () => {
        if (!available) return;
        const embedder = new OllamaEmbedder({ host: OLLAMA_HOST, model: EMBED_MODEL });

        const [vBase, vSimilar, vUnrelated] = await embedder.embed([
            'orquestación de agentes IA',
            'coordinación de múltiples agentes inteligentes',
            'receta de paella valenciana',
        ]);

        const cosine = (a: number[], b: number[]): number => {
            let dot = 0, na = 0, nb = 0;
            for (let i = 0; i < a.length; i++) {
                dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2;
            }
            return dot / (Math.sqrt(na) * Math.sqrt(nb));
        };

        const simSimilar   = cosine(vBase, vSimilar);
        const simUnrelated = cosine(vBase, vUnrelated);

        expect(simSimilar).toBeGreaterThan(simUnrelated);
    });

    test('lanza error descriptivo si el modelo no existe', async () => {
        if (!available) return;
        const embedder = new OllamaEmbedder({ host: OLLAMA_HOST, model: 'modelo-inexistente-xyz' });
        await expect(embedder.embedOne('test')).rejects.toThrow(/modelo-inexistente-xyz/i);
    });
});
