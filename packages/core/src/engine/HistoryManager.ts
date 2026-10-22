import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { atomicWriteSync } from '../shared/utils/atomic-write';
import type { LLMMessage } from '../types';

export interface HistoryManagerOptions {
    historyPath?: string;
    maxContextMessages?: number;
}

/**
 * Strips assistant→tool chains that are incomplete (missing tool results for
 * one or more declared tool_call IDs). Two cases handled:
 *
 * 1. Trailing incomplete chain — the conversation ends mid-chain (e.g. after
 *    an abort). Walk backwards and remove the dangling assistant message and
 *    any partial tool results.
 *
 * 2. Mid-history incomplete chain — a user/system message follows an open
 *    chain (abort happened during tool execution). Retroactively strip the
 *    incomplete block before the user turn so the provider never sees it.
 */
export function sanitizeMessages(messages: LLMMessage[]): LLMMessage[] {
    const out: LLMMessage[] = [];
    let pendingIds = new Set<string>();

    for (const msg of messages) {
        if (msg.role === 'assistant') {
            pendingIds = new Set<string>();
            if (msg.tool_calls?.length) {
                for (const tc of msg.tool_calls) {
                    if (tc.id) pendingIds.add(tc.id);
                }
            }
            out.push(msg);
        } else if (msg.role === 'tool') {
            if (pendingIds.size === 0) {
                continue; // orphaned result — no open chain, drop it
            }
            if (msg.tool_call_id) pendingIds.delete(msg.tool_call_id);
            out.push(msg);
        } else {
            // user / system — close any open chain.
            // If a chain was left open (mid-abort), retroactively strip it so the
            // incoming user turn doesn't carry an incomplete assistant→tool block.
            if (pendingIds.size > 0) {
                while (out.length > 0) {
                    const last = out[out.length - 1];
                    if (last.role === 'tool') { out.pop(); continue; }
                    if (last.role === 'assistant' && last.tool_calls?.length) { out.pop(); break; }
                    break;
                }
            }
            pendingIds = new Set<string>();
            out.push(msg);
        }
    }

    // Case 1: trailing incomplete chain
    if (pendingIds.size > 0) {
        for (let i = out.length - 1; i >= 0; i--) {
            const m = out[i];
            if (m.role === 'tool') {
                out.splice(i, 1);
            } else if (m.role === 'assistant' && m.tool_calls?.length) {
                out.splice(i, 1);
                break;
            } else {
                break;
            }
        }
    }

    return out;
}

export class HistoryManager {
    private messages: LLMMessage[] = [];

    constructor(private readonly opts: HistoryManagerOptions) {
        if (opts.historyPath && existsSync(opts.historyPath)) {
            try {
                const raw = JSON.parse(readFileSync(opts.historyPath, 'utf-8')) as LLMMessage[];
                this.messages = raw.filter(m => m.role !== 'system');
            } catch { /* corrupt or missing — start fresh */ }
        }
    }

    push(msg: LLMMessage): void {
        this.messages.push(msg);
    }

    pushAll(msgs: LLMMessage[]): void {
        this.messages.push(...msgs);
    }

    /** Returns the live message array (by reference — callers must not mutate). */
    getAll(): LLMMessage[] {
        return this.messages;
    }

    /** Returns a sanitized copy — safe to send to any LLM provider. */
    sanitized(): LLMMessage[] {
        return sanitizeMessages(this.messages);
    }

    /**
     * Blanks the arguments of one tool call already stored in the history (a guardrail refused them), so
     * they are neither re-sent to the provider nor written to `historyPath`. The call itself stays so its
     * result keeps pairing with it.
     */
    redactToolCallArgs(toolCallId: string): void {
        this.messages = this.messages.map(m => {
            if (m.role !== 'assistant' || !m.tool_calls?.some(c => c.id === toolCallId)) return m;
            return {
                ...m,
                tool_calls: m.tool_calls.map(c =>
                    c.id === toolCallId ? { ...c, function: { ...c.function, arguments: '{"redacted":"blocked by guardrail"}' } } : c),
            };
        });
    }

    /** Replaces the whole conversation (used by ContextManager after compaction). */
    replaceAll(msgs: LLMMessage[]): void {
        this.messages = msgs;
    }

    /** Appends a user-role message (used by injectContext). */
    inject(content: string): void {
        this.messages.push({ role: 'user', content });
    }

    /** Resets in-memory history and writes an empty array to disk if historyPath is set. */
    clear(): void {
        this.messages = [];
        if (!this.opts.historyPath) return;
        try { atomicWriteSync(this.opts.historyPath, '[]'); } catch { /* non-fatal */ }
    }

    /** Persists current history to disk (called automatically after each run). */
    save(): void {
        if (!this.opts.historyPath) return;
        const cap = this.opts.maxContextMessages ?? 100;
        const toSave = sanitizeMessages(this.messages.filter(m => m.role !== 'system').slice(-cap));
        try {
            mkdirSync(dirname(this.opts.historyPath), { recursive: true });
            atomicWriteSync(this.opts.historyPath, JSON.stringify(toSave, null, 2));
        } catch { /* non-fatal — history loss is preferable to a crash */ }
    }

    /**
     * Trims oldest messages down to `max`, cutting at a user-turn boundary to
     * avoid orphaning assistant↔tool pairs. Returns the number of messages dropped
     * so the caller can emit an appropriate warning event.
     */
    trim(max: number): number {
        if (!max || this.messages.length <= max) return 0;

        const target = this.messages.length - max;
        let cutAt = target;
        while (cutAt < this.messages.length && this.messages[cutAt].role !== 'user') {
            cutAt++;
        }

        if (cutAt > 0 && cutAt < this.messages.length) {
            this.messages = this.messages.slice(cutAt);
            return cutAt;
        }
        return 0;
    }
}
