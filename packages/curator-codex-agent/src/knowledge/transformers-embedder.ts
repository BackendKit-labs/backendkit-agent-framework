import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';

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

interface PendingRequest {
    resolve: (r: WorkerReply) => void;
    reject: (e: Error) => void;
}

interface BatchEntry {
    texts: string[];
    resolve: (embeddings: number[][]) => void;
    reject: (e: Error) => void;
}

const DEFAULT_POOL_SIZE = 2;
// Don't split a batch into more chunks than this would leave per chunk — below this,
// the fixed per-call overhead (worker round-trip, tokenizer setup) stops being worth
// paying for the extra parallelism. Benchmarked against a small-pool workload; revisit
// if CODEX_EMBED_WORKERS is tuned for a much larger concurrent load.
const MIN_TEXTS_PER_CHUNK = 8;
// How long to hold a batch open waiting for more concurrent embed() calls to join it,
// measured from the first call in the batch (not reset on each new arrival — a steady
// stream of calls would otherwise starve the flush indefinitely). setImmediate only
// catches calls issued in the exact same tick; real bursts (e.g. curate_path walking a
// directory) tend to arrive a few ms apart, missing that window entirely. Every call
// pays this as fixed added latency, so keep it small.
const DEFAULT_BATCH_WINDOW_MS = 8;

/** One worker thread plus its own in-flight request table — the pool's unit of dispatch. */
class WorkerSlot {
    readonly pending = new Map<number, PendingRequest>();

    constructor(readonly worker: Worker) {}

    get inFlight(): number {
        return this.pending.size;
    }
}

/**
 * Embedder backed by a pool of worker threads (see embedder-worker.ts). The
 * transformers.js model inference is CPU-bound and single-threaded per worker;
 * running it off the main thread keeps the MCP server responsive to search_vault
 * while a reindex embeds in background.
 *
 * Two things that matter under concurrent load from multiple callers:
 * - **Pool, not one worker.** A single worker serializes every embed() behind
 *   one CPU-bound thread — concurrent callers just queue. A bounded pool
 *   (CODEX_EMBED_WORKERS, default 2, capped at os.cpus().length) lets that many
 *   embed batches actually run in parallel instead.
 * - **Micro-batching.** embed() calls made within a short window (CODEX_EMBED_BATCH_MS,
 *   default 8ms — not just the same event-loop tick) are merged and split across the
 *   pool (see flushBatch()), amortizing the model's fixed per-call overhead across
 *   calls that arrive close together but not perfectly simultaneously.
 */
export class TransformersEmbedder {
    readonly model: string;
    private readonly quantized = true;
    private readonly poolSize: number;
    private readonly batchWindowMs: number;
    private slots: WorkerSlot[] = [];
    private seq = 0;
    private progressCb?: (info: EmbedderProgress) => void;

    private batchQueue: BatchEntry[] = [];
    private batchScheduled = false;

    constructor(modelId = 'Xenova/nomic-embed-text-v1', poolSize?: number, batchWindowMs?: number) {
        this.model = modelId;
        const envSize = parseInt(process.env.CODEX_EMBED_WORKERS ?? '', 10);
        const requested = poolSize ?? (Number.isFinite(envSize) && envSize > 0 ? envSize : DEFAULT_POOL_SIZE);
        this.poolSize = Math.max(1, Math.min(requested, os.cpus().length));

        const envWindow = parseInt(process.env.CODEX_EMBED_BATCH_MS ?? '', 10);
        this.batchWindowMs = batchWindowMs
            ?? (Number.isFinite(envWindow) && envWindow >= 0 ? envWindow : DEFAULT_BATCH_WINDOW_MS);
    }

    // ── Pool management ──────────────────────────────────────────────────────

    private ensurePool(): WorkerSlot[] {
        if (this.slots.length === 0) {
            for (let i = 0; i < this.poolSize; i++) {
                this.slots.push(this.spawnWorker());
            }
        }
        return this.slots;
    }

    private spawnWorker(): WorkerSlot {
        const workerPath = fileURLToPath(new URL('./embedder-worker.js', import.meta.url));
        const worker = new Worker(workerPath);
        const slot = new WorkerSlot(worker);

        worker.on('message', (msg: WorkerReply) => {
            if (msg.type === 'progress') {
                if (msg.info) this.progressCb?.(msg.info);
                return;
            }
            if (typeof msg.id !== 'number') return;
            const p = slot.pending.get(msg.id);
            if (!p) return;
            slot.pending.delete(msg.id);
            this.updateRef(slot);
            if (msg.ok) p.resolve(msg);
            else p.reject(new Error(msg.error ?? 'embedder worker error'));
        });
        worker.on('error', (err) => {
            for (const p of slot.pending.values()) p.reject(err);
            slot.pending.clear();
        });
        worker.on('exit', (code) => {
            if (code !== 0) {
                const err = new Error(`embedder worker exited with code ${code}`);
                for (const p of slot.pending.values()) p.reject(err);
                slot.pending.clear();
            }
            this.slots = this.slots.filter(s => s !== slot);
        });
        // Idle worker should not keep the process alive on its own; ref() only
        // while it has requests in flight (see updateRef) so embeds never get cut off.
        worker.unref();
        return slot;
    }

    /** Keep the process alive while this worker has requests in flight, release it when idle. */
    private updateRef(slot: WorkerSlot): void {
        if (slot.inFlight > 0) slot.worker.ref();
        else slot.worker.unref();
    }

    /** Least-busy routing — picks the slot with the fewest in-flight requests. */
    private pickSlot(): WorkerSlot {
        const slots = this.ensurePool();
        return slots.reduce((best, s) => (s.inFlight < best.inFlight ? s : best), slots[0]!);
    }

    private request(slot: WorkerSlot, payload: { type: 'init' | 'embed'; texts?: string[] }): Promise<WorkerReply> {
        const id = ++this.seq;
        return new Promise<WorkerReply>((resolve, reject) => {
            slot.pending.set(id, { resolve, reject });
            this.updateRef(slot);
            slot.worker.postMessage({ id, model: this.model, quantized: this.quantized, ...payload });
        });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Warms up every worker in the pool so the first real embed() isn't the one
     * paying model-load cost. The first worker inits alone (it may need to
     * download the model); once cached to disk, the rest init in parallel since
     * loading a cached model is fast and safe to parallelize.
     */
    async init(onProgress?: (info: EmbedderProgress) => void): Promise<{ alreadyCached: boolean }> {
        const alreadyCached = this.slots.length > 0;
        const slots = this.ensurePool();
        this.progressCb = onProgress;
        try {
            await this.request(slots[0]!, { type: 'init' });
            this.progressCb = undefined;
            if (slots.length > 1) {
                await Promise.all(slots.slice(1).map(s => this.request(s, { type: 'init' })));
            }
        } finally {
            this.progressCb = undefined;
        }
        return { alreadyCached };
    }

    /**
     * Embeds a batch of texts. Calls made within batchWindowMs of each other are
     * merged into shared worker requests — see flushBatch().
     */
    async embed(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];
        return new Promise<number[][]>((resolve, reject) => {
            this.batchQueue.push({ texts, resolve, reject });
            if (!this.batchScheduled) {
                this.batchScheduled = true;
                setTimeout(() => this.flushBatch(), this.batchWindowMs);
            }
        });
    }

    async embedOne(text: string): Promise<number[]> {
        const results = await this.embed([text]);
        return results[0] ?? [];
    }

    // ── Batching ──────────────────────────────────────────────────────────────

    private async flushBatch(): Promise<void> {
        const batch = this.batchQueue;
        this.batchQueue = [];
        this.batchScheduled = false;
        if (batch.length === 0) return;

        // Split the batch across up to poolSize workers instead of sending it all to
        // one — otherwise a pool of N idle workers buys nothing (everything still
        // funnels through a single inference call) while still paying N times the
        // model-load cost at init(). Also never split below MIN_TEXTS_PER_CHUNK texts
        // per chunk — a pool sized for a bigger burst shouldn't over-shard a small batch.
        const totalTexts = batch.reduce((n, e) => n + e.texts.length, 0);
        const maxChunksByWork = Math.max(1, Math.floor(totalTexts / MIN_TEXTS_PER_CHUNK));
        const chunkCount = Math.min(this.ensurePool().length, batch.length, maxChunksByWork);
        const chunks = this.splitIntoChunks(batch, chunkCount);

        await Promise.all(chunks.map(chunk => this.runChunk(chunk)));
    }

    private splitIntoChunks(batch: BatchEntry[], chunkCount: number): BatchEntry[][] {
        const chunks: BatchEntry[][] = Array.from({ length: chunkCount }, () => []);
        batch.forEach((entry, i) => chunks[i % chunkCount]!.push(entry));
        return chunks;
    }

    private async runChunk(chunk: BatchEntry[]): Promise<void> {
        if (chunk.length === 0) return;
        const allTexts = chunk.flatMap(e => e.texts);
        // Picked per chunk, after earlier chunks in this same flush have already
        // claimed a slot — inFlight is updated synchronously inside request(), so
        // concurrent chunks land on different workers instead of piling onto one.
        const slot = this.pickSlot();

        try {
            const reply = await this.request(slot, { type: 'embed', texts: allTexts });
            const embeddings = reply.embeddings ?? [];
            let offset = 0;
            for (const entry of chunk) {
                entry.resolve(embeddings.slice(offset, offset + entry.texts.length));
                offset += entry.texts.length;
            }
        } catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            for (const entry of chunk) entry.reject(e);
        }
    }
}
