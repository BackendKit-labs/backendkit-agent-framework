import { z } from '@backendkit-labs/agent-core';

// ── Event envelope ────────────────────────────────────────────────────────────

/** Typed wrapper around every published event. */
export interface EventEnvelope<T = unknown> {
    id: string;          // UUID — also used as BullMQ jobId for deduplication
    type: string;        // maps to queue name: eventos.{type}
    occurredAt: string;  // ISO timestamp
    source: string;      // publisher identity (agentId, system name, etc.)
    version: number;     // schema version for evolution
    payload: T;
}

// ── Event schema ──────────────────────────────────────────────────────────────

/**
 * Declares a named, versioned event type.
 * The Zod schema is used to validate every payload before publishing.
 */
export interface EventSchema<T = unknown> {
    type: string;
    version: number;
    schema: z.ZodType<T>;
}

// ── Publish options ───────────────────────────────────────────────────────────

export interface PublishOptions {
    /** Number of attempts before the job is moved to failed. Default: 3 */
    attempts?: number;
    /** Exponential backoff base delay in ms. Default: 1000 */
    backoffDelay?: number;
    /**
     * Override the BullMQ job ID (defaults to envelope.id).
     * Useful for idempotent publishes.
     */
    jobId?: string;
}

// ── Reconciliation ────────────────────────────────────────────────────────────

export interface OrphanedEvent {
    eventId: string;
    type: string;
    occurredAt: string;
    source: string;
    /** Absolute path of the /eventos/ note. */
    notePath: string;
}

export interface ReconciliationReport {
    /** Total event notes read from /eventos/. */
    checked: number;
    /** Events that have a corresponding audit note. */
    matched: number;
    /** Events without any matching audit note. */
    orphaned: OrphanedEvent[];
    sweptAt: string;
}
