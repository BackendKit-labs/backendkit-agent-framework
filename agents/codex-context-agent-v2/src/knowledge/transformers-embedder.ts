import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export interface EmbedderProgress {
    status: 'initiate' | 'downloading' | 'done' | 'ready' | string;
    file?: string;
    progress?: number;
    loaded?: number;
    total?: number;
}

interface WorkerReply {
    id?: number;
    type?: string;
    ok?: boolean;
    error?: string;
    embeddings?: number[][];
    info?: EmbedderProgress;
}

/**
 * Embedder backed by a worker thread (see embedder-worker.ts). The transformers.js
 * model inference is CPU-bound and single-threaded; running it off the main thread
 * keeps the MCP server responsive to search_vault while a reindex embeds in background.
 */
export class TransformersEmbedder {
    readonly model: string;
    private readonly quantized = true;
    private worker: Worker | null = null;
    private seq = 0;
    private readonly pending = new Map<number, { resolve: (r: WorkerReply) => void; reject: (e: Error) => void }>();
    private progressCb?: (info: EmbedderProgress) => void;

    constructor(modelId = 'Xenova/nomic-embed-text-v1') {
        this.model = modelId;
    }

    private getWorker(): Worker {
        if (!this.worker) {
            const workerPath = fileURLToPath(new URL('./embedder-worker.js', import.meta.url));
            const worker = new Worker(workerPath);
            worker.on('message', (msg: WorkerReply) => {
                if (msg.type === 'progress') {
                    if (msg.info) this.progressCb?.(msg.info);
                    return;
                }
                if (typeof msg.id !== 'number') return;
                const p = this.pending.get(msg.id);
                if (!p) return;
                this.pending.delete(msg.id);
                this.updateRef();
                if (msg.ok) p.resolve(msg);
                else p.reject(new Error(msg.error ?? 'embedder worker error'));
            });
            worker.on('error', (err) => {
                for (const p of this.pending.values()) p.reject(err);
                this.pending.clear();
                this.worker = null;
            });
            worker.on('exit', (code) => {
                if (code !== 0) {
                    const err = new Error(`embedder worker exited with code ${code}`);
                    for (const p of this.pending.values()) p.reject(err);
                    this.pending.clear();
                }
                this.worker = null;
            });
            // Idle worker should not keep the process alive on its own; we ref() it only
            // while requests are in flight (see updateRef) so embeds never get cut off.
            worker.unref();
            this.worker = worker;
        }
        return this.worker;
    }

    /** Keep the process alive while embeds are in flight, release it when idle. */
    private updateRef(): void {
        if (!this.worker) return;
        if (this.pending.size > 0) this.worker.ref();
        else this.worker.unref();
    }

    private request(payload: { type: 'init' | 'embed'; texts?: string[] }): Promise<WorkerReply> {
        const id = ++this.seq;
        const worker = this.getWorker();
        return new Promise<WorkerReply>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.updateRef();
            worker.postMessage({ id, model: this.model, quantized: this.quantized, ...payload });
        });
    }

    async init(onProgress?: (info: EmbedderProgress) => void): Promise<{ alreadyCached: boolean }> {
        const alreadyCached = this.worker !== null;
        this.progressCb = onProgress;
        try {
            await this.request({ type: 'init' });
        } finally {
            this.progressCb = undefined;
        }
        return { alreadyCached };
    }

    async embed(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];
        const reply = await this.request({ type: 'embed', texts });
        return reply.embeddings ?? [];
    }

    async embedOne(text: string): Promise<number[]> {
        const results = await this.embed([text]);
        return results[0] ?? [];
    }
}
