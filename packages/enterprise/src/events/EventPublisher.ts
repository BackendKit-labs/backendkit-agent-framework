import { randomUUID } from 'crypto';
import { VaultWriter } from '../rag/VaultWriter';
import type { EventEnvelope, EventSchema, PublishOptions } from './types';

// ── QueueLike ─────────────────────────────────────────────────────────────────

/**
 * Minimal subset of the BullMQ Queue API required by EventPublisher.
 * Satisfied by a real BullMQ Queue without importing bullmq at build time.
 */
export interface QueueLike {
    name: string;
    add(
        jobName: string,
        data: unknown,
        opts?: {
            attempts?: number;
            backoff?: { type: string; delay: number };
            removeOnComplete?: boolean | { count: number };
            removeOnFail?: boolean | { count: number };
            jobId?: string;
        },
    ): Promise<{ id?: string | undefined }>;
}

// ── EventPublisher ────────────────────────────────────────────────────────────

export interface EventPublisherOptions {
    /** BullMQ Queue (or any QueueLike). Must target the right queue name. */
    queue: QueueLike;
    /** Absolute path to the shared vault. Events are written to {vaultPath}/eventos/. */
    vaultPath: string;
    /** Publisher identity (agentId, system name) written into the envelope and vault note. */
    source: string;
    /**
     * How many finished jobs the queue keeps. Default 1 000 completed and 5 000 failed (those are the ones looked into).
     * Reconciliation reads the vault notes, not the queue, so keeping every job only made Redis grow for good (audit C-10).
     */
    retainJobs?: { completed?: number; failed?: number };
}

/**
 * Publishes a typed, validated event in a single atomic call:
 *   1. Validates payload against the EventSchema's Zod schema.
 *   2. Creates an EventEnvelope with a UUID and ISO timestamp.
 *   3. Adds the job to the BullMQ queue (retry config; finished jobs kept up to `retainJobs`).
 *   4. Writes a canonical vault note to /eventos/ so the event is auditable and RAG-queryable.
 */
export class EventPublisher {
    private readonly vaultWriter: VaultWriter;

    constructor(private readonly opts: EventPublisherOptions) {
        this.vaultWriter = new VaultWriter({
            vaultPath: opts.vaultPath,
            agentFolder: 'eventos',
        });
    }

    async publish<T>(
        schema: EventSchema<T>,
        payload: T,
        options?: PublishOptions,
    ): Promise<EventEnvelope<T>> {
        // Validate — throws ZodError if payload doesn't match the schema
        schema.schema.parse(payload);

        const envelope: EventEnvelope<T> = {
            id: randomUUID(),
            type: schema.type,
            occurredAt: new Date().toISOString(),
            source: this.opts.source,
            version: schema.version,
            payload,
        };

        const jobId = options?.jobId ?? envelope.id;

        await this.opts.queue.add(schema.type, envelope, {
            attempts: options?.attempts ?? 3,
            backoff: { type: 'exponential', delay: options?.backoffDelay ?? 1000 },
            removeOnComplete: { count: this.opts.retainJobs?.completed ?? 1_000 },
            removeOnFail: { count: this.opts.retainJobs?.failed ?? 5_000 },
            jobId,
        });

        await this.writeEventNote(envelope);

        return envelope;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async writeEventNote<T>(envelope: EventEnvelope<T>): Promise<void> {
        const payloadJson = JSON.stringify(envelope.payload, null, 2);

        const content = [
            `## Event: ${envelope.type}`,
            '',
            '| Field | Value |',
            '|-------|-------|',
            `| ID | \`${envelope.id}\` |`,
            `| Type | \`${envelope.type}\` |`,
            `| Occurred | ${envelope.occurredAt} |`,
            `| Source | \`${envelope.source}\` |`,
            `| Version | ${envelope.version} |`,
            '',
            '### Payload',
            '',
            '```json',
            payloadJson,
            '```',
        ].join('\n');

        await this.vaultWriter.writeNote({
            title: `Event: ${envelope.type} (${envelope.id})`,
            content,
            agentId: envelope.source,
            tags: ['evento', `tipo/${envelope.type}`],
            description: `Published event — type: ${envelope.type}, source: ${envelope.source}`,
        });
    }
}
