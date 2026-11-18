import type { AgentEngine, RunResult } from '@backendkit-labs/agent-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Evaluations of agents (SPEC-0021): cases as data, graders that read a `RunResult`, repetitions, a JSON report and a
 * comparison of two configurations. Nothing here calls a model: the engine a case runs on is the one `build` returns, so a
 * scripted or replayed provider makes a suite free and repeatable.
 */

export interface GraderResult { pass: boolean; score?: number; note?: string }

/** Reads what a run did. `ctx.setup` is what the case's `setup` returned. */
export type Grader = ((result: RunResult, ctx: { setup: unknown }) => GraderResult | Promise<GraderResult>) & { graderName?: string };

export interface EvalCase {
    id: string;
    input: string;
    /** Prepares the world of the case before each run (files, state...) and returns what `expect` needs. */
    setup?: () => Promise<unknown> | unknown;
    expect: Grader[];
    tags?: string[];
}

export interface EvalRunInfo {
    /** 1-based number of the repetition of this case. */
    repetition: number;
    /** `seed + repetition - 1`: the suite hands it out, `build` decides what to seed with it (a simulated market, say). */
    seed: number;
    /** What the case's `setup` returned. */
    setup: unknown;
}

export interface EvalSuiteOptions {
    name: string;
    cases: EvalCase[];
    /** The engine for one run of one case: the caller picks the provider (real, scripted or replayed) and the modules. */
    build: (c: EvalCase, run: EvalRunInfo) => AgentEngine | Promise<AgentEngine>;
    /** Runs of each case. Default 1. A real model is not deterministic: one run is not evidence. */
    repeat?: number;
    /** First seed. Default 1. */
    seed?: number;
    /** Only the cases with one of these tags. */
    tags?: string[];
    /** Stop when a run reports `budgetExceeded`, and say so in the report. Default true. */
    stopOnBudget?: boolean;
    /** Adds `startedAt` and `durationMs` to the report. Off by default so that the same suite gives the same report. */
    includeTiming?: boolean;
}

export interface GraderOutcome { name: string; pass: boolean; score?: number; note?: string }

export interface EvalRunReport {
    repetition: number;
    seed: number;
    passed: boolean;
    graders: GraderOutcome[];
    /** Set when the run threw: no grader ran. */
    error?: string;
    /** Kept to review a failure. It can carry `preview` text and, with `recordArgs`, arguments: treat the report as sensitive data. */
    result?: RunResult;
    durationMs?: number;
}

export interface EvalCaseReport {
    id: string;
    tags: string[];
    runs: EvalRunReport[];
    passes: number;
    passRate: number;
}

export interface EvalReport {
    /** The version of this shape. */
    schema: 1;
    name: string;
    repeat: number;
    seed: number;
    totalRuns: number;
    passes: number;
    passRate: number;
    /** The suite stopped before running everything, and why. */
    stoppedEarly?: 'budget';
    cases: EvalCaseReport[];
    startedAt?: string;
}

// ── Graders ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Names a grader of your own for the report. */
export function grader(name: string, fn: (result: RunResult, ctx: { setup: unknown }) => GraderResult | Promise<GraderResult>): Grader {
    const g = ((r, ctx) => fn(r, ctx)) as Grader;
    g.graderName = name;
    return g;
}

export interface ToolCalledOptions {
    /** The number of calls it must have: exactly this many. Default: at least one. */
    times?: number;
    /** Checks the arguments of a call. Needs `recordArgs` in the engine; without them, no call matches. */
    with?: (args: Record<string, unknown>) => boolean;
}

/** The tool was called (optionally exactly `times`, optionally with arguments that pass `with`). */
export function toolCalled(name: string, options: ToolCalledOptions = {}): Grader {
    return grader(`toolCalled(${name})`, r => {
        const calls = r.toolCalls.filter(t => t.name === name);
        const matching = options.with ? calls.filter(t => t.args !== undefined && options.with!(t.args)) : calls;
        const pass = options.times !== undefined ? matching.length === options.times : matching.length > 0;
        const note = options.with && calls.length > 0 && calls.every(t => t.args === undefined) ? 'the calls carry no args: turn on recordArgs' : `${matching.length} matching of ${calls.length} calls`;
        return { pass, note };
    });
}

/** The tool was never called. */
export function toolNotCalled(name: string): Grader {
    return grader(`toolNotCalled(${name})`, r => {
        const n = r.toolCalls.filter(t => t.name === name).length;
        return { pass: n === 0, note: `${n} calls` };
    });
}

/** No tool call failed. */
export function noToolErrors(): Grader {
    return grader('noToolErrors', r => {
        const failed = r.toolCalls.filter(t => !t.success).map(t => t.name);
        return { pass: failed.length === 0, ...(failed.length ? { note: `failed: ${failed.join(', ')}` } : {}) };
    });
}

/** A call failed with this error code (of the tool `tool`, when given). */
export function errorCode(code: string, tool?: string): Grader {
    return grader(`errorCode(${code}${tool ? `, ${tool}` : ''})`, r => ({
        pass: r.toolCalls.some(t => t.errorCode === code && (tool === undefined || t.name === tool)),
    }));
}

/** The final text matches (a string is searched for, a regular expression is tested). */
export function textMatches(pattern: string | RegExp): Grader {
    return grader(`textMatches(${String(pattern)})`, r => ({ pass: typeof pattern === 'string' ? r.text.includes(pattern) : pattern.test(r.text) }));
}

/** The run did not go over the engine's cost budget and was not aborted. */
export function withinBudget(): Grader {
    return grader('withinBudget', r => ({ pass: !r.budgetExceeded && !r.aborted }));
}

/** At most `n` tool calls in the run. */
export function maxToolCalls(n: number): Grader {
    return grader(`maxToolCalls(${n})`, r => ({ pass: r.toolCalls.length <= n, note: `${r.toolCalls.length} calls` }));
}

// ── The suite ─────────────────────────────────────────────────────────────────────────────────────────────────────

const rate = (passes: number, total: number): number => (total === 0 ? 0 : Math.round((passes / total) * 10_000) / 10_000);

/** Runs every case `repeat` times and returns the report. Sequential: cases may share a world. */
export async function evalSuite(options: EvalSuiteOptions): Promise<EvalReport> {
    const repeat = Math.max(1, options.repeat ?? 1);
    const seed = options.seed ?? 1;
    const stopOnBudget = options.stopOnBudget ?? true;
    const started = Date.now();
    const cases = options.tags && options.tags.length > 0
        ? options.cases.filter(c => (c.tags ?? []).some(t => options.tags!.includes(t)))
        : options.cases;

    const reports: EvalCaseReport[] = [];
    let stoppedEarly: EvalReport['stoppedEarly'];

    outer: for (const c of cases) {
        const runs: EvalRunReport[] = [];
        reports.push({ id: c.id, tags: c.tags ?? [], runs, passes: 0, passRate: 0 });
        for (let repetition = 1; repetition <= repeat; repetition++) {
            const runSeed = seed + repetition - 1;
            const t0 = Date.now();
            const base: EvalRunReport = { repetition, seed: runSeed, passed: false, graders: [] };
            try {
                const setup = c.setup ? await c.setup() : undefined;
                const engine = await options.build(c, { repetition, seed: runSeed, setup });
                // The run id is made from the suite, the case and the repetition: the same suite gives the same ids (and the same report),
                // and the audit events and spans of a run can be found by it (core 0.47.1 and later; an older engine ignores it).
                const result = await engine.run(c.input, { runId: `${options.name}/${c.id}/${repetition}` });
                base.result = result;
                for (let i = 0; i < c.expect.length; i++) {
                    const g = c.expect[i];
                    const out = await g(result, { setup });
                    base.graders.push({ name: g.graderName ?? (g.name || `grader#${i + 1}`), pass: out.pass, ...(out.score !== undefined ? { score: out.score } : {}), ...(out.note ? { note: out.note } : {}) });
                }
                base.passed = base.graders.every(g => g.pass);
            } catch (e) {
                base.error = e instanceof Error ? e.message : String(e);
            }
            if (options.includeTiming) base.durationMs = Date.now() - t0;
            runs.push(base);
            if (stopOnBudget && base.result?.budgetExceeded) { stoppedEarly = 'budget'; break outer; }
        }
    }

    for (const cr of reports) {
        cr.passes = cr.runs.filter(r => r.passed).length;
        cr.passRate = rate(cr.passes, cr.runs.length);
    }
    const totalRuns = reports.reduce((n, c) => n + c.runs.length, 0);
    const passes = reports.reduce((n, c) => n + c.passes, 0);
    return {
        schema: 1, name: options.name, repeat, seed, totalRuns, passes, passRate: rate(passes, totalRuns),
        ...(stoppedEarly ? { stoppedEarly } : {}),
        cases: reports,
        ...(options.includeTiming ? { startedAt: new Date(started).toISOString() } : {}),
    };
}

// ── Comparison and summary ────────────────────────────────────────────────────────────────────────────────────────

export interface CaseComparison {
    id: string;
    aRate: number; bRate: number;
    /** `bRate - aRate`: positive when B passes more often. */
    delta: number;
    aRuns: number; bRuns: number;
}

export interface Comparison {
    a: string; b: string;
    aRate: number; bRate: number; delta: number;
    aRuns: number; bRuns: number;
    cases: CaseComparison[];
    /** Cases only one of the two reports has: they are not compared. */
    onlyInA: string[];
    onlyInB: string[];
}

/** The difference of two reports, case by case and in total, with the number of runs each rate rests on. */
export function compare(a: EvalReport, b: EvalReport): Comparison {
    const bById = new Map(b.cases.map(c => [c.id, c]));
    const aIds = new Set(a.cases.map(c => c.id));
    const cases: CaseComparison[] = [];
    const onlyInA: string[] = [];
    for (const ca of a.cases) {
        const cb = bById.get(ca.id);
        if (!cb) { onlyInA.push(ca.id); continue; }
        cases.push({ id: ca.id, aRate: ca.passRate, bRate: cb.passRate, delta: Math.round((cb.passRate - ca.passRate) * 10_000) / 10_000, aRuns: ca.runs.length, bRuns: cb.runs.length });
    }
    const onlyInB = b.cases.filter(c => !aIds.has(c.id)).map(c => c.id);
    // The totals count only the cases both reports have, so the two rates rest on the same cases.
    const both = new Set(cases.map(c => c.id));
    const sum = (r: EvalReport) => r.cases.filter(c => both.has(c.id)).reduce((s, c) => ({ passes: s.passes + c.passes, runs: s.runs + c.runs.length }), { passes: 0, runs: 0 });
    const sa = sum(a); const sb = sum(b);
    const aRate = rate(sa.passes, sa.runs); const bRate = rate(sb.passes, sb.runs);
    return { a: a.name, b: b.name, aRate, bRate, delta: Math.round((bRate - aRate) * 10_000) / 10_000, aRuns: sa.runs, bRuns: sb.runs, cases, onlyInA, onlyInB };
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** A text summary for the console. The JSON is the report; this is for a person. */
export function formatReport(report: EvalReport): string {
    const lines = [`${report.name}: ${report.passes}/${report.totalRuns} runs passed (${pct(report.passRate)}), ${report.cases.length} cases x ${report.repeat}`];
    if (report.stoppedEarly) lines.push(`STOPPED EARLY: ${report.stoppedEarly} exceeded, not every run was made`);
    for (const c of report.cases) {
        lines.push(`  ${c.passes === c.runs.length ? 'ok  ' : 'FAIL'} ${c.id}: ${c.passes}/${c.runs.length}`);
        const failed = c.runs.find(r => !r.passed);
        if (failed) {
            if (failed.error) lines.push(`       run ${failed.repetition} threw: ${failed.error}`);
            for (const g of failed.graders.filter(x => !x.pass)) lines.push(`       run ${failed.repetition}: ${g.name} failed${g.note ? ` (${g.note})` : ''}`);
        }
    }
    return lines.join('\n');
}

/** A text summary of a comparison. */
export function formatComparison(c: Comparison): string {
    const lines = [`${c.a} vs ${c.b}: ${pct(c.aRate)} (${c.aRuns} runs) -> ${pct(c.bRate)} (${c.bRuns} runs), ${c.delta >= 0 ? '+' : ''}${pct(c.delta)}`];
    for (const k of c.cases.filter(x => x.delta !== 0)) lines.push(`  ${k.delta > 0 ? 'better' : 'worse '} ${k.id}: ${pct(k.aRate)} -> ${pct(k.bRate)}`);
    if (c.onlyInA.length) lines.push(`  only in ${c.a}: ${c.onlyInA.join(', ')}`);
    if (c.onlyInB.length) lines.push(`  only in ${c.b}: ${c.onlyInB.join(', ')}`);
    return lines.join('\n');
}

// ── Saving a report ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Writes a report as JSON, so a later run can `compare` against it. The file is `0o600` (only its owner reads it): it keeps the
 * `RunResult` of each run, with text and, with `recordArgs`, arguments. Creates the folder if it is missing.
 */
export async function writeReport(report: EvalReport, file: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

/** Reads a report written by `writeReport`. Throws when the file is not a report of a version this one understands. */
export async function readReport(file: string): Promise<EvalReport> {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<EvalReport>;
    if (parsed.schema !== 1 || !Array.isArray(parsed.cases) || typeof parsed.name !== 'string') {
        throw new Error(`${file} is not an evaluation report this version understands (schema ${String(parsed.schema)})`);
    }
    return parsed as EvalReport;
}
