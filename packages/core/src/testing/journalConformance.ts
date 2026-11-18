import assert from 'node:assert/strict';
import type { RunJournal } from '../flow/journal';

/**
 * A battery every `RunJournal` must pass (SPEC-0028 F0). It exercises the contract directly, with no flow engine: what
 * `begin`, `step`, `update`, `claim`, `get` and `list` promise, so a new journal (SQL, a cloud store) is implemented against
 * this and not against the quirks of another journal.
 *
 * The cases throw plain errors (`node:assert`), so they work under any test runner. `journalConformance` registers them with
 * the global `describe` and `it` (jest, vitest with globals); `journalConformanceCases` returns them for any other runner.
 */
export interface JournalConformanceOptions {
    /**
     * A journal over the storage under test. Called many times: for journals that persist (file, ndjson, redis, sql) every call
     * must return an object over the SAME storage, and `shared` must be true. Cases never reuse a run id, flow or tenant, so one
     * storage serves the whole battery; the caller cleans it up.
     */
    make(): RunJournal | Promise<RunJournal>;
    /** Two journals from `make()` see each other's runs (anything but an in-memory journal). Default true. */
    shared?: boolean;
    /** A claim that is not renewed expires after its TTL. False for a journal that frees a claim when its holder is gone (ndjson). Default true. */
    expiresByTtl?: boolean;
    /**
     * One journal object owns the writes of a run: another object that writes to it after the first one wrote gets a
     * `JournalConflict` (SPEC-0024, SPEC-0028 D5) instead of both appending. True for ndjson and for the SQL journals.
     * Whatever a journal does, an acknowledged write is never lost. Default false.
     */
    exclusiveWriter?: boolean;
    /** Ids that are not safe as a file or key name (`../escape`) are rejected. Default false. */
    rejectsUnsafeIds?: boolean;
}

export interface JournalConformanceCase { name: string; run(): Promise<void> }

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export function journalConformanceCases(opts: JournalConformanceOptions): JournalConformanceCase[] {
    const shared = opts.shared ?? true;
    const expiresByTtl = opts.expiresByTtl ?? true;
    let n = 0;
    // Unique per case and per call: runs of other cases never show up in a `list` filtered by this flow or tenant.
    const uid = (what: string): string => `${what}-${Date.now().toString(36)}-${(n++).toString(36)}`;
    const fresh = async () => ({ journal: await opts.make(), runId: uid('run'), flow: uid('flow'), tenantId: uid('tenant') });

    const cases: JournalConformanceCase[] = [
        {
            name: 'get of a run that does not exist is undefined',
            async run() {
                const { journal, runId } = await fresh();
                assert.equal(await journal.get(runId), undefined);
            },
        },
        {
            name: 'begin creates a running run with its flow, preview and tenant',
            async run() {
                const { journal, runId, flow, tenantId } = await fresh();
                await journal.begin({ runId, flow, inputPreview: 'the input', tenantId });
                const run = await journal.get(runId);
                assert.ok(run, 'the run exists after begin');
                assert.equal(run.runId, runId);
                assert.equal(run.flow, flow);
                assert.equal(run.tenantId, tenantId);
                assert.equal(run.inputPreview, 'the input');
                assert.equal(run.status, 'running');
                assert.deepEqual(run.steps, {});
                assert.deepEqual(run.transitions, []);
                assert.ok(run.startedAt && run.updatedAt, 'startedAt and updatedAt are set');
                assert.equal(run.finishedAt, undefined);
            },
        },
        {
            name: 'begin of an id that already exists fails and leaves the run as it was',
            async run() {
                const { journal, runId, flow } = await fresh();
                await journal.begin({ runId, flow, inputPreview: 'first' });
                await assert.rejects(journal.begin({ runId, flow, inputPreview: 'second' }));
                assert.equal((await journal.get(runId))!.inputPreview, 'first');
            },
        },
        {
            name: 'step and update on a run that does not exist fail and create nothing',
            async run() {
                const { journal, runId } = await fresh();
                await assert.rejects(journal.step(runId, 'a', { status: 'running', attempt: 1 }));
                await assert.rejects(journal.update(runId, { status: 'failed' }));
                assert.equal(await journal.get(runId), undefined);
            },
        },
        {
            name: 'step patches merge: a later patch changes only the fields it names',
            async run() {
                const { journal, runId, flow } = await fresh();
                await journal.begin({ runId, flow, inputPreview: '' });
                await journal.step(runId, 'a', { status: 'running', attempt: 1 });
                await journal.step(runId, 'a', { status: 'done', output: 'out-a', costUsd: 0.25 });
                const a = (await journal.get(runId))!.steps.a;
                assert.equal(a.status, 'done');
                assert.equal(a.output, 'out-a');
                assert.equal(a.attempt, 1, 'attempt survives a patch that does not name it');
                assert.equal(a.costUsd, 0.25);
                assert.ok(a.at);
                await journal.step(runId, 'a', { status: 'failed', error: 'boom', attempt: 2 });
                const again = (await journal.get(runId))!.steps.a;
                assert.equal(again.status, 'failed');
                assert.equal(again.error, 'boom');
                assert.equal(again.attempt, 2);
                assert.equal(again.output, 'out-a', 'output survives a patch that does not name it');
            },
        },
        {
            name: 'transitions accumulate in the order they were written, across steps and updates',
            async run() {
                const { journal, runId, flow } = await fresh();
                await journal.begin({ runId, flow, inputPreview: '' });
                const t = (stepId: string, event: 'started' | 'completed') => ({ at: new Date().toISOString(), stepId, event });
                await journal.step(runId, 'a', { status: 'running', attempt: 1, transitions: [t('a', 'started')] });
                await journal.step(runId, 'b', { status: 'running', attempt: 1, transitions: [t('b', 'started')] });
                await journal.update(runId, { transitions: [t('a', 'completed')] });
                const run = (await journal.get(runId))!;
                assert.deepEqual(run.transitions.map(x => `${x.stepId}:${x.event}`), ['a:started', 'b:started', 'a:completed']);
            },
        },
        {
            name: 'update sets the status; only a terminal status sets finishedAt',
            async run() {
                const { journal, runId, flow } = await fresh();
                await journal.begin({ runId, flow, inputPreview: '' });
                await journal.update(runId, { status: 'paused' });
                let run = (await journal.get(runId))!;
                assert.equal(run.status, 'paused');
                assert.equal(run.finishedAt, undefined);
                await journal.update(runId, { status: 'failed', error: 'down', costUsd: 1.5 });
                run = (await journal.get(runId))!;
                assert.equal(run.status, 'failed');
                assert.equal(run.error, 'down');
                assert.equal(run.costUsd, 1.5);
                assert.ok(run.finishedAt, 'a terminal status sets finishedAt');
            },
        },
        {
            name: 'waiting is set by an update and cleared by null',
            async run() {
                const { journal, runId, flow } = await fresh();
                await journal.begin({ runId, flow, inputPreview: '' });
                await journal.update(runId, { status: 'awaiting_approval', waiting: { stepId: 'pay', approvalId: 'ap-1', criteria: ['amount'] } });
                assert.deepEqual((await journal.get(runId))!.waiting, { stepId: 'pay', approvalId: 'ap-1', criteria: ['amount'] });
                await journal.update(runId, { status: 'running', waiting: null });
                assert.equal((await journal.get(runId))!.waiting, undefined);
            },
        },
        {
            name: 'list filters by status, flow and tenant, and combines the filters',
            async run() {
                const { journal, flow, tenantId } = await fresh();
                const other = uid('tenant');
                const a = uid('run'); const b = uid('run'); const c = uid('run');
                await journal.begin({ runId: a, flow, inputPreview: '', tenantId });
                await journal.begin({ runId: b, flow, inputPreview: '', tenantId });
                await journal.begin({ runId: c, flow, inputPreview: '', tenantId: other });
                await journal.update(b, { status: 'done' });
                const ids = async (f: Parameters<RunJournal['list']>[0]) => (await journal.list(f)).map(r => r.runId).sort();
                assert.deepEqual(await ids({ flow }), [a, b, c].sort());
                assert.deepEqual(await ids({ flow, tenantId }), [a, b].sort());
                assert.deepEqual(await ids({ flow, tenantId: other }), [c]);
                assert.deepEqual(await ids({ flow, status: ['done'] }), [b]);
                assert.deepEqual(await ids({ flow, status: ['done', 'running'], tenantId }), [a, b].sort());
                assert.deepEqual(await ids({ flow, status: ['failed'] }), []);
                assert.deepEqual(await ids({ flow: uid('flow') }), []);
            },
        },
        {
            name: 'list returns the runs oldest first',
            async run() {
                const { journal, flow } = await fresh();
                const ids = [uid('run'), uid('run'), uid('run')];
                for (const runId of ids) { await journal.begin({ runId, flow, inputPreview: '' }); await sleep(5); }
                assert.deepEqual((await journal.list({ flow })).map(r => r.runId), ids);
            },
        },
        {
            name: 'writers that run at the same time never lose an event',
            async run() {
                const { journal, runId, flow } = await fresh();
                await journal.begin({ runId, flow, inputPreview: '' });
                await Promise.all(Array.from({ length: 20 }, (_, i) => journal.step(runId, `s${i}`, { status: 'done', attempt: 1 })));
                assert.equal(Object.keys((await journal.get(runId))!.steps).length, 20);
            },
        },
        {
            name: 'claim is exclusive while valid, the same owner can take it again, and release frees it',
            async run() {
                const { journal, runId, flow } = await fresh();
                await journal.begin({ runId, flow, inputPreview: '' });
                const first = await journal.claim(runId, 'a', 60_000);
                assert.ok(first, 'a free run can be claimed');
                assert.equal(await journal.claim(runId, 'b', 60_000), null, 'another owner is refused while the claim is valid');
                const renewed = await journal.claim(runId, 'a', 60_000);
                assert.ok(renewed, 'the owner can renew its own claim');
                await renewed();
                const second = await journal.claim(runId, 'b', 60_000);
                assert.ok(second, 'after the release another owner takes it');
                await second();
            },
        },
        {
            name: 'a release from a holder that no longer holds the claim does not free the new one',
            async run() {
                const { journal, runId, flow } = await fresh();
                await journal.begin({ runId, flow, inputPreview: '' });
                const stale = await journal.claim(runId, 'a', 60_000);
                assert.ok(stale);
                await stale();
                const current = await journal.claim(runId, 'b', 60_000);
                assert.ok(current);
                await stale(); // already released: must not take b's claim away
                assert.equal(await journal.claim(runId, 'c', 60_000), null, 'b still holds it');
                await current();
            },
        },
    ];

    if (expiresByTtl) {
        cases.push({
            name: 'a claim that is not renewed expires after its TTL',
            async run() {
                const { journal, runId, flow } = await fresh();
                await journal.begin({ runId, flow, inputPreview: '' });
                assert.ok(await journal.claim(runId, 'a', 25));
                assert.equal(await journal.claim(runId, 'b', 60_000), null);
                await sleep(80);
                const taken = await journal.claim(runId, 'b', 60_000);
                assert.ok(taken, 'the expired claim is free');
                await taken();
            },
        });
    }

    if (shared) {
        cases.push(
            {
                name: 'a run written through one journal object is read through another over the same storage',
                async run() {
                    const { journal, runId, flow } = await fresh();
                    await journal.begin({ runId, flow, inputPreview: 'p' });
                    await journal.step(runId, 'a', { status: 'done', output: 'out', attempt: 1 });
                    const other = await opts.make();
                    const run = await other.get(runId);
                    assert.equal(run?.steps.a?.output, 'out');
                    assert.ok((await other.list({ flow })).some(r => r.runId === runId));
                },
            },
            {
                name: 'journal objects over the same storage race for a claim: exactly one wins',
                async run() {
                    const { journal, runId, flow } = await fresh();
                    await journal.begin({ runId, flow, inputPreview: '' });
                    const journals = await Promise.all(Array.from({ length: 8 }, () => opts.make()));
                    const claims = await Promise.all(journals.map((j, i) => j.claim(runId, `p${i}`, 60_000)));
                    const won = claims.filter((c): c is () => Promise<void> => c !== null);
                    assert.equal(won.length, 1);
                    await won[0]();
                },
            },
            {
                name: opts.exclusiveWriter
                    ? 'journal objects over the same storage that write at the same time: a write is acknowledged or refused with JournalConflict, and an acknowledged write is never lost'
                    : 'journal objects over the same storage that write at the same time never lose an event',
                async run() {
                    const { journal, runId, flow } = await fresh();
                    await journal.begin({ runId, flow, inputPreview: '' });
                    const journals = await Promise.all(Array.from({ length: 4 }, () => opts.make()));
                    const results = await Promise.allSettled(
                        Array.from({ length: 20 }, (_, i) => journals[i % 4].step(runId, `s${i}`, { status: 'done', attempt: 1 })),
                    );
                    const written = (await journal.get(runId))!.steps;
                    results.forEach((r, i) => {
                        if (r.status === 'fulfilled') {
                            assert.ok(written[`s${i}`], `s${i} was acknowledged and is missing`);
                        } else {
                            assert.ok(opts.exclusiveWriter, `a concurrent write was refused: ${String(r.reason)}`);
                            assert.equal((r.reason as Error).name, 'JournalConflict', `refused with something other than JournalConflict: ${String(r.reason)}`);
                        }
                    });
                    assert.ok(results.some(r => r.status === 'fulfilled'), 'at least one write is acknowledged');
                },
            },
        );
    }

    if (opts.rejectsUnsafeIds) {
        cases.push({
            name: 'an id that is not safe as a file or key name is rejected, not written',
            async run() {
                const { journal, flow } = await fresh();
                await assert.rejects(journal.begin({ runId: '../escape', flow, inputPreview: '' }));
                await assert.rejects(journal.get('../escape'));
            },
        });
    }

    return cases;
}

/** Registers the battery with the global `describe` and `it` (jest, vitest with globals). */
export function journalConformance(name: string, opts: JournalConformanceOptions): void {
    describe(`${name}: RunJournal conformance`, () => {
        for (const c of journalConformanceCases(opts)) it(c.name, c.run);
    });
}
