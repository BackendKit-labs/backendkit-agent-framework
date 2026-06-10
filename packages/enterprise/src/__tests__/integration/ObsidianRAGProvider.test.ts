import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ObsidianRAGProvider } from '../../rag/ObsidianRAGProvider';

const OLLAMA_HOST   = process.env.OLLAMA_HOST    ?? 'http://localhost:11434';
const EMBED_MODEL   = process.env.EMBEDDING_MODEL ?? 'nomic-embed-text';

// ── Vault de fixtures ─────────────────────────────────────────────────────────

const FIXTURES: Record<string, string> = {
    'agentes-orquestacion.md': `---
title: Orquestación de Agentes IA
tags: [área/arquitectura, stack/typescript]
description: Patrones para coordinar múltiples agentes especializados
---

## Patrón orquestador-especialista

El orquestador recibe la tarea del usuario y la descompone en subtareas.
Cada subtarea se delega a un agente especialista a través del tool ask_agent.
Los especialistas devuelven su resultado al orquestador, que sintetiza la respuesta final.

## Delegación paralela

Cuando las subtareas son independientes entre sí, el orquestador puede lanzar
múltiples ask_agent en el mismo turno. El engine ejecuta todas las delegaciones
en paralelo, limitado por el bulkhead de 6 slots concurrentes.
`,

    'rag-vectorial.md': `---
title: RAG con Vector Store Local
tags: [área/ia, stack/typescript]
description: Implementación de Retrieval Augmented Generation sin dependencias externas
---

## Embeddings con Ollama

Los embeddings se generan usando el modelo nomic-embed-text de Ollama.
La API es POST /api/embed con el texto y el nombre del modelo.
El resultado es un vector de 768 dimensiones para nomic-embed-text.

## Similitud coseno

La búsqueda semántica compara el embedding de la consulta con los embeddings
almacenados usando similitud coseno. El resultado más cercano a 1.0 es el más relevante.

## Indexación incremental

El VectorStore guarda el mtime de cada archivo. En el siguiente índice,
solo se re-embeden los archivos nuevos o modificados.
`,

    'typescript-patterns.md': `---
title: Patrones TypeScript en el Framework
tags: [stack/typescript, área/arquitectura]
description: Convenciones de código usadas en el proyecto
---

## Tipos estrictos

El proyecto usa strict mode de TypeScript. Todos los parámetros opcionales
deben declararse explícitamente. No se permite any sin justificación.

## Inyección de dependencias

Los providers se registran en ProviderRegistry y se resuelven por nombre.
Esto permite intercambiar OllamaProvider por otros providers en tests.
`,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ollamaAvailable(): Promise<boolean> {
    try {
        const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return false;
        const data = await res.json() as { models?: Array<{ name: string }> };
        return (data.models ?? []).some(m => m.name.startsWith(EMBED_MODEL));
    } catch {
        return false;
    }
}

async function createFixtureVault(dir: string): Promise<void> {
    for (const [name, content] of Object.entries(FIXTURES)) {
        await fs.writeFile(path.join(dir, name), content, 'utf-8');
    }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ObsidianRAGProvider — integración', () => {
    let available = false;
    let vaultDir: string;
    let indexDir: string;

    beforeAll(async () => {
        available = await ollamaAvailable();
        if (!available) {
            console.warn(
                `\n⚠  ObsidianRAGProvider tests saltados — Ollama no disponible en ${OLLAMA_HOST} ` +
                `o modelo '${EMBED_MODEL}' no descargado.\n` +
                `   Para ejecutarlos: ollama serve && ollama pull ${EMBED_MODEL}\n`
            );
            return;
        }
        const base = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-rag-e2e-'));
        vaultDir = path.join(base, 'vault');
        indexDir = path.join(base, 'index');
        await fs.mkdir(vaultDir);
        await fs.mkdir(indexDir);
        await createFixtureVault(vaultDir);
    });

    afterAll(async () => {
        if (vaultDir) {
            await fs.rm(path.dirname(vaultDir), { recursive: true, force: true });
        }
    });

    test('index() indexa todos los archivos del vault fixture', async () => {
        if (!available) return;
        const rag = new ObsidianRAGProvider({
            vaultPath:      vaultDir,
            indexPath:      path.join(indexDir, 'index.json'),
            ollamaHost:     OLLAMA_HOST,
            embeddingModel: EMBED_MODEL,
        });

        const { indexed, removed } = await rag.index({ verbose: false });

        expect(indexed).toBeGreaterThan(0);    // al menos un chunk por archivo
        expect(removed).toBe(0);
        expect(rag.chunkCount).toBeGreaterThan(0);
    });

    test('index() incremental no re-indexa archivos sin cambios', async () => {
        if (!available) return;
        const indexPath = path.join(indexDir, 'incremental.json');
        const rag = new ObsidianRAGProvider({
            vaultPath: vaultDir, indexPath, ollamaHost: OLLAMA_HOST, embeddingModel: EMBED_MODEL,
        });

        await rag.index(); // primera pasada — indexa todo

        const rag2 = new ObsidianRAGProvider({
            vaultPath: vaultDir, indexPath, ollamaHost: OLLAMA_HOST, embeddingModel: EMBED_MODEL,
        });
        const { indexed } = await rag2.index(); // segunda pasada — nada cambió

        expect(indexed).toBe(0);
    });

    test('search devuelve el chunk más relevante para "orquestador"', async () => {
        if (!available) return;
        const rag = new ObsidianRAGProvider({
            vaultPath: vaultDir,
            indexPath: path.join(indexDir, 'search-test.json'),
            ollamaHost: OLLAMA_HOST,
            embeddingModel: EMBED_MODEL,
            topK: 3,
            minScore: 0.1,
        });

        const result = await rag.search('patrón orquestador especialista delegación');

        expect(result).toContain('orquestaci'); // título o contenido del archivo relevante
        expect(result).not.toBe('No se encontró información relevante en la base de conocimiento para esa consulta.');
    });

    test('search devuelve mensaje de no-resultados para consulta sin match', async () => {
        if (!available) return;
        const rag = new ObsidianRAGProvider({
            vaultPath: vaultDir,
            indexPath: path.join(indexDir, 'no-match.json'),
            ollamaHost: OLLAMA_HOST,
            embeddingModel: EMBED_MODEL,
            minScore: 0.99, // umbral imposible de alcanzar
        });

        const result = await rag.search('xyzabcnonexistent987');
        expect(result).toContain('No se encontró información relevante');
    });

    test('búsquedas sobre temas distintos devuelven fuentes distintas', async () => {
        if (!available) return;
        const rag = new ObsidianRAGProvider({
            vaultPath: vaultDir,
            indexPath: path.join(indexDir, 'multi-topic.json'),
            ollamaHost: OLLAMA_HOST,
            embeddingModel: EMBED_MODEL,
            topK: 1,
            minScore: 0.1,
        });

        const resultOrq = await rag.search('orquestador y delegación de agentes');
        const resultTS  = await rag.search('strict mode TypeScript inyección dependencias');

        // Los resultados top deben venir de archivos distintos
        const titleOrq = resultOrq.match(/Fuente: ([^\n]+)/)?.[1] ?? '';
        const titleTS  = resultTS.match(/Fuente: ([^\n]+)/)?.[1] ?? '';
        expect(titleOrq).not.toBe(titleTS);
    });

    test('createTool devuelve un ToolDefinition ejecutable', async () => {
        if (!available) return;
        const rag = new ObsidianRAGProvider({
            vaultPath: vaultDir,
            indexPath: path.join(indexDir, 'tool-test.json'),
            ollamaHost: OLLAMA_HOST,
            embeddingModel: EMBED_MODEL,
        });

        const tool = rag.createTool();
        expect(tool.name).toBe('search_knowledge');
        expect(typeof tool.execute).toBe('function');

        const result = await tool.execute(
            { query: 'embeddings vectoriales' },
            {} as never, // ExecutionContext — no usado por esta tool
        );
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });
});
