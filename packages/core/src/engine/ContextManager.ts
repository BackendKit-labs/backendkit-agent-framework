import type { LLMMessage } from '../types';
import type { HistoryManager } from './HistoryManager';

/**
 * Token-aware context control. Replaces the message-count cap (`maxContextMessages`) when
 * `context` is configured on the engine; both can coexist.
 */
export interface ContextOptions {
    /** Token budget for the conversation history (the system prompt and tool schemas are not counted). */
    maxTokens: number;
    /**
     * `summarize` (default) folds the oldest turns into one summary message; `drop` just discards them.
     * A failing summarizer falls back to `drop`.
     */
    strategy?: 'drop' | 'summarize';
    /** Last user turns that are never summarized or truncated. Default 4. */
    keepRecentTurns?: number;
    /** Older tool results longer than this are cut (head + tail). Default 8000 characters. */
    toolResultMaxChars?: number;
    /**
     * When one long turn (a tool loop) is over budget by itself, its newest tool results are kept whole and the
     * bulky ones before them are cut like the older turns'. Default 4.
     */
    keepRecentToolResults?: number;
    /** Compaction starts above `threshold * maxTokens` and stops at 70 % of it. Default threshold 0.85. */
    threshold?: number;
    /** Provider/model used to write summaries. Default: the engine's default provider and model. */
    summarizer?: { provider?: string; model?: string };
    /** Custom token estimator for one message. Default: ~4 characters per token. */
    estimateTokens?: (message: LLMMessage) => number;
    /**
     * When the provider rejects a request for exceeding the context window, force a compaction and retry
     * (at most twice per run) instead of failing. Default true.
     */
    overflowRetry?: boolean;
}

export interface CompactionReport {
    truncatedToolResults: number;
    summarizedMessages: number;
    droppedMessages: number;
    tokensBefore: number;
    tokensAfter: number;
}

export interface ContextManagerDeps {
    history: HistoryManager;
    /** Writes a summary of `transcript`, extending `previousSummary` when there is one. */
    summarize: (transcript: string, previousSummary?: string) => Promise<string>;
    emit: (event: { type: 'compacting'; label: string; phase: 'start' | 'done' | 'fail' } | { type: 'system'; level: 'info' | 'warn' | 'error'; text: string }) => void;
}

export const SUMMARY_OPEN = '<conversation_summary>';
export const SUMMARY_CLOSE = '</conversation_summary>';
const TARGET_RATIO = 0.7;
const DEFAULT_KEEP_TURNS = 4;
const DEFAULT_TOOL_RESULT_MAX = 8000;
const DEFAULT_KEEP_TOOL_RESULTS = 4;
const DEFAULT_THRESHOLD = 0.85;
const MESSAGE_OVERHEAD_TOKENS = 4;
const TRANSCRIPT_MESSAGE_MAX = 2000;
const TRANSCRIPT_TOTAL_MAX = 120_000;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.5;
const OVERFLOW_BUDGET_FACTOR = 0.7;
const OVERFLOW_BUDGET_MIN = 0.3;
const FORCED_TARGET_RATIO = 0.5;

export function defaultEstimateTokens(message: LLMMessage): number {
    let chars = message.content?.length ?? 0;
    if (message.tool_calls?.length) {
        for (const call of message.tool_calls) chars += call.function.name.length + call.function.arguments.length;
    }
    return Math.ceil(chars / 4) + MESSAGE_OVERHEAD_TOKENS;
}

/** First summary found in a user message, or undefined. */
export function extractSummary(message: LLMMessage): string | undefined {
    if (message.role !== 'user' || !message.content?.startsWith(SUMMARY_OPEN)) return undefined;
    const end = message.content.indexOf(SUMMARY_CLOSE);
    if (end === -1) return undefined;
    return message.content.slice(SUMMARY_OPEN.length, end).trim();
}

/** The user's own text of a turn that carries a summary prefix. */
function stripSummary(content: string): string {
    const end = content.indexOf(SUMMARY_CLOSE);
    return end === -1 ? content : content.slice(end + SUMMARY_CLOSE.length).trimStart();
}

function truncateMiddle(text: string, max: number): string {
    if (text.length <= max) return text;
    const head = Math.floor(max * 0.6);
    const tail = Math.floor(max * 0.3);
    const cut = text.length - head - tail;
    return `${text.slice(0, head)}\n[... ${cut} characters truncated by context manager ...]\n${text.slice(text.length - tail)}`;
}

function renderTranscript(messages: LLMMessage[]): string {
    const lines: string[] = [];
    for (const m of messages) {
        if (m.role === 'assistant' && m.tool_calls?.length) {
            const calls = m.tool_calls.map(c => `${c.function.name}(${c.function.arguments.slice(0, 200)})`).join(', ');
            if (m.content) lines.push(`assistant: ${truncateMiddle(m.content, TRANSCRIPT_MESSAGE_MAX)}`);
            lines.push(`assistant called tools: ${calls}`);
        } else if (m.role === 'tool') {
            lines.push(`tool result: ${truncateMiddle(m.content ?? '', TRANSCRIPT_MESSAGE_MAX)}`);
        } else {
            lines.push(`${m.role}: ${truncateMiddle(m.content ?? '', TRANSCRIPT_MESSAGE_MAX)}`);
        }
    }
    const joined = lines.join('\n');
    return joined.length > TRANSCRIPT_TOTAL_MAX ? joined.slice(joined.length - TRANSCRIPT_TOTAL_MAX) : joined;
}

export class ContextManager {
    private scale = 1;
    /** Share of `maxTokens` still trusted after provider-reported overflows. */
    private budgetFactor = 1;
    private readonly estimate: (m: LLMMessage) => number;
    private readonly keepTurns: number;
    private readonly toolMax: number;
    private readonly threshold: number;
    private readonly strategy: 'drop' | 'summarize';
    private readonly keepToolResults: number;

    constructor(private readonly opts: ContextOptions, private readonly deps: ContextManagerDeps) {
        this.estimate = opts.estimateTokens ?? defaultEstimateTokens;
        this.keepTurns = Math.max(1, opts.keepRecentTurns ?? DEFAULT_KEEP_TURNS);
        this.toolMax = opts.toolResultMaxChars ?? DEFAULT_TOOL_RESULT_MAX;
        this.threshold = opts.threshold ?? DEFAULT_THRESHOLD;
        this.strategy = opts.strategy ?? 'summarize';
        this.keepToolResults = Math.max(1, opts.keepRecentToolResults ?? DEFAULT_KEEP_TOOL_RESULTS);
    }

    /** Estimated tokens of `messages`, corrected by the ratio learned from real provider usage. */
    tokens(messages: LLMMessage[]): number {
        let sum = 0;
        for (const m of messages) sum += this.estimate(m);
        return Math.ceil(sum * this.scale);
    }

    /** Uncalibrated estimate of `messages`; pair it with `observeUsage`. */
    estimateRaw(messages: LLMMessage[]): number {
        let sum = 0;
        for (const m of messages) sum += this.estimate(m);
        return sum;
    }

    /** Raw (uncalibrated) estimate for text outside the history, e.g. the system prompt or tool schemas. */
    estimateText(text: string): number {
        return Math.ceil(text.length / 4);
    }

    /**
     * Learns from a real provider answer: `actualInputTokens` is what the provider billed as input for a
     * request whose uncalibrated estimate was `estimatedRaw`. Smoothed and clamped so one odd response
     * (e.g. cached tokens reported separately) cannot wreck the estimate.
     */
    observeUsage(actualInputTokens: number, estimatedRaw: number): void {
        if (actualInputTokens <= 0 || estimatedRaw <= 0) return;
        const ratio = Math.min(SCALE_MAX, Math.max(SCALE_MIN, actualInputTokens / estimatedRaw));
        this.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, this.scale * 0.5 + ratio * 0.5));
    }

    get calibration(): number {
        return this.scale;
    }

    /** Token budget in force: `maxTokens` shrunk by every overflow the provider has reported. */
    get effectiveMaxTokens(): number {
        return Math.floor(this.opts.maxTokens * this.budgetFactor);
    }

    /** The provider rejected a request as too large: trust the budget less from now on (floor 30 %). */
    noteOverflow(): void {
        this.budgetFactor = Math.max(OVERFLOW_BUDGET_MIN, this.budgetFactor * OVERFLOW_BUDGET_FACTOR);
    }

    /**
     * Brings the history under budget. Never throws: a failing summarizer degrades to dropping.
     * `force` skips the threshold check (used after a provider overflow); its target is a share of the
     * budget and also of the current estimate, so it still shrinks when the estimate was too low.
     */
    async compact(opts: { force?: boolean; targetRatio?: number } = {}): Promise<CompactionReport | null> {
        const { history } = this.deps;
        const before = this.tokens(history.getAll());
        const max = this.effectiveMaxTokens;
        if (!opts.force && before <= max * this.threshold) return null;

        const ratio = opts.targetRatio ?? (opts.force ? FORCED_TARGET_RATIO : TARGET_RATIO);
        const target = opts.force ? Math.min(max * ratio, before * ratio) : max * ratio;
        const report: CompactionReport = {
            truncatedToolResults: 0, summarizedMessages: 0, droppedMessages: 0,
            tokensBefore: before, tokensAfter: before,
        };

        // Step 1 — cut bulky old tool results (cheap, loses the least).
        const boundary = this.recentBoundary(history.getAll(), this.keepTurns);
        const truncated = this.truncateOldToolResults(history.getAll(), boundary);
        if (truncated.count > 0) {
            history.replaceAll(truncated.messages);
            report.truncatedToolResults = truncated.count;
        }
        if (this.tokens(history.getAll()) <= target) {
            report.tokensAfter = this.tokens(history.getAll());
            return report;
        }

        // Step 2 — fold the oldest turns, keeping the most recent ones. Fewer kept turns as a last resort.
        for (let keep = this.keepTurns; keep >= 1; keep--) {
            const messages = history.getAll();
            const cutAt = this.recentBoundary(messages, keep);
            if (cutAt <= 0) continue;
            await this.foldPrefix(messages, cutAt, report);
            if (this.tokens(history.getAll()) <= target) break;
        }

        // Step 3 — a single long turn (an agent's tool loop) can exceed the budget on its own, and folding turns
        // cannot touch it: cut the bulky results of all but the newest few tool calls inside it.
        if (this.tokens(history.getAll()) > target) {
            const messages = history.getAll();
            const toolAt = messages.flatMap((m, i) => (m.role === 'tool' ? [i] : []));
            const protectFrom = toolAt.length > this.keepToolResults ? toolAt[toolAt.length - this.keepToolResults] : 0;
            const cut = this.truncateOldToolResults(messages, protectFrom);
            if (cut.count > 0) {
                history.replaceAll(cut.messages);
                report.truncatedToolResults += cut.count;
            }
        }

        report.tokensAfter = this.tokens(history.getAll());
        if (report.tokensAfter > max) {
            this.deps.emit({
                type: 'system', level: 'warn',
                text: `[Context] History still above budget after compaction (~${report.tokensAfter} > ${max} tokens): the most recent turns alone exceed it.`,
            });
        }
        return report;
    }

    /** Index of the user message that starts the last `keep` turns (0 when there are not enough turns). */
    private recentBoundary(messages: LLMMessage[], keep: number): number {
        const starts: number[] = [];
        messages.forEach((m, i) => { if (m.role === 'user') starts.push(i); });
        if (starts.length <= keep) return 0;
        return starts[starts.length - keep];
    }

    private truncateOldToolResults(messages: LLMMessage[], boundary: number): { messages: LLMMessage[]; count: number } {
        let count = 0;
        const out = messages.map((m, i) => {
            if (i >= boundary || m.role !== 'tool' || !m.content || m.content.length <= this.toolMax) return m;
            count++;
            return { ...m, content: truncateMiddle(m.content, this.toolMax) };
        });
        return { messages: out, count };
    }

    /** Replaces messages [0, cutAt) with one summary (or nothing), merged into the user turn at `cutAt`. */
    private async foldPrefix(messages: LLMMessage[], cutAt: number, report: CompactionReport): Promise<void> {
        const prefix = messages.slice(0, cutAt);
        const rest = messages.slice(cutAt);
        // An earlier compaction left its summary at the start of the first user turn: take it out so it is
        // extended instead of nested, but keep the turn's own text so it gets summarized with the rest.
        let previousSummary: string | undefined;
        const body: LLMMessage[] = [];
        for (const m of prefix) {
            const s = extractSummary(m);
            if (s === undefined) { body.push(m); continue; }
            previousSummary = s;
            body.push({ ...m, content: stripSummary(m.content ?? '') });
        }

        let summary: string | undefined;
        if (this.strategy === 'summarize') {
            this.deps.emit({ type: 'compacting', label: `Summarizing ${body.length} messages`, phase: 'start' });
            try {
                summary = (await this.deps.summarize(renderTranscript(body), previousSummary)).trim();
                if (!summary) throw new Error('empty summary');
                this.deps.emit({ type: 'compacting', label: 'Context summarized', phase: 'done' });
            } catch (err) {
                summary = undefined;
                this.deps.emit({ type: 'compacting', label: 'Summary failed, dropping old messages', phase: 'fail' });
                this.deps.emit({
                    type: 'system', level: 'warn',
                    text: `[Context] Summarizer failed (${err instanceof Error ? err.message : String(err)}); dropped ${body.length} old messages instead.`,
                });
            }
        }

        const keepSummary = summary ?? previousSummary;
        let nextRest = rest;
        if (keepSummary && rest.length > 0 && rest[0].role === 'user') {
            nextRest = [
                { ...rest[0], content: `${SUMMARY_OPEN}\n${keepSummary}\n${SUMMARY_CLOSE}\n\n${rest[0].content ?? ''}` },
                ...rest.slice(1),
            ];
        }
        if (summary) report.summarizedMessages += body.length; else report.droppedMessages += body.length;
        this.deps.history.replaceAll(nextRest);
    }
}

export const SUMMARY_SYSTEM_PROMPT =
    'You compress conversations between a user and an AI agent into a faithful working summary. ' +
    'Use ONLY facts present in the transcript; never invent. Keep: the user\'s goal, decisions made and why, ' +
    'files/ids/names/values that were touched or discovered, results of tool calls that matter, errors and how they ' +
    'were resolved, and what is still pending. Omit pleasantries and raw tool output. Reply with the summary only, ' +
    'as concise bullet points.';

export function buildSummaryPrompt(transcript: string, previousSummary?: string): string {
    return (previousSummary
        ? `Existing summary of the earlier part of the conversation:\n${previousSummary}\n\nNew transcript to merge into it:\n`
        : 'Transcript to summarize:\n') + transcript;
}
