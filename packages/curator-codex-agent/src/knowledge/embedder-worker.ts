/**
 * Embedder worker — runs transformers.js feature-extraction off the main thread.
 *
 * The embedding model (nomic-embed-text) is CPU-bound and single-threaded; running it
 * inline blocks the event loop, so a reindex starves concurrent search_vault calls.
 * This worker isolates that CPU work: the main thread stays responsive for searches
 * while curation/reindex embeds in the background.
 *
 * Protocol (parentPort messages):
 *   → { id, type: 'init',  model, quantized }            ← { id, ok }
 *   → { id, type: 'embed', model, quantized, texts }     ← { id, ok, embeddings }
 *   ← { type: 'progress', info }   (model download progress, no id)
 *   ← { id, ok: false, error }     (on failure)
 */
import { parentPort } from 'node:worker_threads';
import * as path from 'node:path';
import * as os from 'node:os';

type ProgressInfo = { status: string; file?: string; progress?: number; loaded?: number; total?: number };

let extractorPromise: Promise<unknown> | null = null;

async function getExtractor(
    model: string,
    quantized: boolean,
    onProgress?: (info: ProgressInfo) => void,
): Promise<(texts: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>> {
    if (!extractorPromise) {
        extractorPromise = (async () => {
            const { pipeline, env } = await import('@xenova/transformers');
            env.cacheDir = path.join(os.homedir(), '.cache', 'codex-context', 'models');
            env.allowRemoteModels = true;
            return pipeline('feature-extraction', model, { quantized, progress_callback: onProgress });
        })();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return extractorPromise as any;
}

if (!parentPort) {
    throw new Error('embedder-worker must be run as a worker thread');
}

const port = parentPort;

port.on('message', async (msg: { id?: number; type: string; model: string; quantized: boolean; texts?: string[] }) => {
    const { id, type } = msg;
    try {
        if (type === 'init') {
            await getExtractor(msg.model, msg.quantized, (info) => port.postMessage({ type: 'progress', info }));
            port.postMessage({ id, ok: true });
        } else if (type === 'embed') {
            const extractor = await getExtractor(msg.model, msg.quantized);
            const output = await extractor(msg.texts ?? [], { pooling: 'mean', normalize: true });
            port.postMessage({ id, ok: true, embeddings: output.tolist() });
        } else {
            port.postMessage({ id, ok: false, error: `Unknown message type: ${type}` });
        }
    } catch (err) {
        port.postMessage({ id, ok: false, error: (err as Error).message });
    }
});
