/**
 * From a task to a validated design, with one model call and at most one repair (SPEC-0040 F1). The model is a function you pass
 * in, so this runs the same in the browser (a `fetch` to the provider with the visitor's key), in a test (a fake) and in a live check.
 *
 * What it promises: whatever comes out of here as `ok` has passed the schema and the validation, and its document and skeleton
 * come from the templates, not from the model. What it does not promise: that the design is good. That is for a person, and the
 * document says so.
 */
import { initialMessages, repairMessages, MAX_TASK_CHARS, type Message } from './prompt.ts';
import { validateDesign, type Issue } from './validate.ts';
import { renderFullDocument, renderSkeleton, type GeneratedFile } from './render.ts';
import type { DesignSpec } from './schema.ts';

export interface Usage { inputTokens: number; outputTokens: number }
export type Completion = string | { text: string; usage?: Usage };
/** Asks the model. Throw a {@link ProviderError} when the provider fails: it is shown as it is, never retried behind the visitor's back. */
export type Complete = (messages: Message[]) => Promise<Completion>;

export class ProviderError extends Error {
    readonly status: number | undefined;
    constructor(message: string, status?: number) { super(message); this.name = 'ProviderError'; this.status = status; }
}

export type Generated =
    | {
        ok: true;
        spec: DesignSpec;
        warnings: Issue[];
        /** The document: the design, what a person decides, and the skeleton as an appendix. */
        markdown: string;
        skeleton: GeneratedFile[];
        attempts: 1 | 2;
        usage: Usage;
    }
    | {
        ok: false;
        /** `input`: the task cannot be sent. `provider`: the provider failed. `answer`: the model answered twice with something refused. */
        stage: 'input' | 'provider' | 'answer';
        reason: string;
        /** What was wrong with the last answer, for the stage `answer`. */
        problems?: string[];
        attempts: 0 | 1 | 2;
        usage: Usage;
    };

const MAX_ANSWER_CHARS = 80_000;

/** The JSON object in a model answer: as it is, without code fences, or between the first `{` and the last `}`. */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; problem: string } {
    const trimmed = text.trim();
    if (trimmed.length === 0) return { ok: false, problem: 'the answer is empty' };
    if (trimmed.length > MAX_ANSWER_CHARS) return { ok: false, problem: 'the answer is too long' };
    const candidates = [trimmed];
    const fenced = /^```[a-z]*\s*\n([\s\S]*?)\n```\s*$/i.exec(trimmed);
    if (fenced) candidates.push(fenced[1]!);
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
    let message = 'it is not JSON';
    for (const c of candidates) {
        try { return { ok: true, value: JSON.parse(c) }; } catch (err) { message = err instanceof Error ? err.message : String(err); }
    }
    return { ok: false, problem: `the answer is not valid JSON (${message}). Answer with the JSON object only` };
}

const asProblems = (issues: Issue[]): string[] => issues.map(i => `${i.code}${i.path ? ` at ${i.path}` : ''}: ${i.message}`);

function add(total: Usage, c: Completion): { text: string } {
    if (typeof c === 'string') return { text: c };
    if (c.usage) { total.inputTokens += c.usage.inputTokens; total.outputTokens += c.usage.outputTokens; }
    return { text: c.text };
}

export async function generateDesign(task: string, complete: Complete): Promise<Generated> {
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const cleaned = task.trim();
    if (cleaned.length < 10) return { ok: false, stage: 'input', reason: 'Describe the task in a sentence or two, at least 10 characters.', attempts: 0, usage };
    if (cleaned.length > MAX_TASK_CHARS) return { ok: false, stage: 'input', reason: `The task is ${cleaned.length} characters; the limit is ${MAX_TASK_CHARS}. Say it shorter.`, attempts: 0, usage };

    let messages = initialMessages(cleaned);
    let problems: string[] = [];
    for (const attempt of [1, 2] as const) {
        let answer: string;
        try {
            answer = add(usage, await complete(messages)).text;
        } catch (err) {
            return { ok: false, stage: 'provider', reason: err instanceof Error ? err.message : String(err), attempts: attempt === 1 ? 0 : 1, usage };
        }
        const json = extractJson(answer);
        if (!json.ok) {
            problems = [json.problem];
        } else {
            const v = validateDesign(json.value);
            if (v.ok) {
                return { ok: true, spec: v.spec, warnings: v.warnings, markdown: renderFullDocument(v.spec, v.warnings), skeleton: renderSkeleton(v.spec), attempts: attempt, usage };
            }
            problems = asProblems(v.errors);
        }
        if (attempt === 1) messages = repairMessages(messages, answer.slice(0, MAX_ANSWER_CHARS), problems);
    }
    return { ok: false, stage: 'answer', reason: 'The model did not return a design that passes the checks, after one correction.', problems, attempts: 2, usage };
}
