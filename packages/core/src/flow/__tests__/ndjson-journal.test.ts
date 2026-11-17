import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runFlow, FlowClaimError } from '../run';
import type { StepExecutor } from '../run';
import { JournalConflict, JournalCorrupt } from '../journal';
import { NdjsonRunJournal } from '../ndjson-journal';
import { FlowDefinitionSchema } from '../types';

jest.setTimeout(60_000);

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ndjson-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const run = (runId: string, flow = 'f') => ({ runId, flow, inputPreview: '' });
const file = (id: string) => path.join(dir, `${id}.ndjson`);
const lock = (id: string) => path.join(dir, `${id}.lock`);
const lines = (id: string): string[] => fsSync.readFileSync(file(id), 'utf8').split('\n').filter(Boolean);
const rewrite = (id: string, ls: string[]) => fsSync.writeFileSync(file(id), ls.join('\n') + '\n');
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** A pid that is certainly gone: a process that was started and has exited. */
async function deadPid(): Promise<number> {
    const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
    await new Promise(r => child.on('exit', r));
    return child.pid!;
}
function liveProcess(): ChildProcess { return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' }); }

async function seeded(id = 'r1', opts?: ConstructorParameters<typeof NdjsonRunJournal>[1]): Promise<NdjsonRunJournal> {
    const j = new NdjsonRunJournal(dir, opts);
    await j.begin(run(id));
    await j.step(id, 'a', { status: 'running', attempt: 1 });
    await j.step(id, 'a', { status: 'done', attempt: 1, output: 'out-a' });
    await j.step(id, 'b', { status: 'done', attempt: 1, output: 'out-b' });
    await j.update(id, { status: 'done' });
    return j;
}

describe('NdjsonRunJournal: the file', () => {
    it('is one line per event, chained from n = 0, and folds back into the run', async () => {
        const j = await seeded();
        const ls = lines('r1').map(l => JSON.parse(l) as { n: number; event: { kind: string }; mac: string });
        expect(ls.map(l => l.n)).toEqual([0, 1, 2, 3, 4]);
        expect(ls.map(l => l.event.kind)).toEqual(['begin', 'step', 'step', 'step', 'update']);
        expect(new Set(ls.map(l => l.mac)).size).toBe(5);
        const r = await j.get('r1');
        expect(r?.status).toBe('done');
        expect(r?.steps.a.output).toBe('out-a');
        expect(r?.steps.b.status).toBe('done');
    });

    it('is created readable by its owner only', async () => {
        await seeded();
        if (process.platform === 'win32') return; // no POSIX modes there
        expect(fsSync.statSync(file('r1')).mode & 0o777).toBe(0o600);
    });

    it('refuses a second begin, a bad id, and a write to a run that does not exist', async () => {
        const j = await seeded();
        await expect(j.begin(run('r1'))).rejects.toThrow('already exists');
        await expect(j.begin(run('../x'))).rejects.toThrow('invalid run id');
        await expect(j.step('ghost', 's', { status: 'done' })).rejects.toThrow('does not exist');
        expect(await j.get('ghost')).toBeUndefined();
    });

    it('60 steps writing at once lose nothing and keep the chain valid', async () => {
        const j = new NdjsonRunJournal(dir);
        await j.begin(run('wide'));
        await Promise.all(Array.from({ length: 60 }, (_, i) => j.step('wide', `s${i}`, { status: 'done', attempt: 1, output: `o${i}` })));
        expect(Object.keys((await j.get('wide'))!.steps)).toHaveLength(60);
        expect(lines('wide')).toHaveLength(61);
    });

    it('works without fsync (for tests and slow disks)', async () => {
        const j = await seeded('nf', { fsync: 'never' });
        expect((await j.get('nf'))?.status).toBe('done');
    });
});

describe('NdjsonRunJournal: what is not believed', () => {
    const corrupt = async (id: string) => { await expect(new NdjsonRunJournal(dir).get(id)).rejects.toBeInstanceOf(JournalCorrupt); };

    it('a line that was changed', async () => {
        await seeded();
        const ls = lines('r1'); ls[2] = ls[2].replace('out-a', 'out-X'); rewrite('r1', ls);
        await corrupt('r1');
    });

    it('a line that was removed from the middle', async () => {
        await seeded();
        const ls = lines('r1'); ls.splice(2, 1); rewrite('r1', ls);
        await corrupt('r1');
    });

    it('a line that was added', async () => {
        await seeded();
        const ls = lines('r1'); ls.splice(3, 0, ls[2]); rewrite('r1', ls);
        await corrupt('r1');
    });

    it('two lines swapped', async () => {
        await seeded();
        const ls = lines('r1'); [ls[1], ls[2]] = [ls[2], ls[1]]; rewrite('r1', ls);
        await corrupt('r1');
    });

    it('a blank line in the middle, and a line that is not JSON', async () => {
        await seeded();
        const ls = lines('r1');
        fsSync.writeFileSync(file('r1'), [ls[0], '', ...ls.slice(1)].join('\n') + '\n');
        await corrupt('r1');
        rewrite('r1', [ls[0], 'not json at all', ...ls.slice(2)]);
        await corrupt('r1');
    });

    it('the limit, stated: removing the last lines leaves a chain that is still valid (an anchor outside the file would be needed)', async () => {
        await seeded();
        rewrite('r1', lines('r1').slice(0, 3));
        const r = await new NdjsonRunJournal(dir).get('r1');
        expect(r?.steps.b).toBeUndefined();
        expect(r?.status).toBe('running');
    });

    it('with a key, a file rewritten by someone without it is not believed, and neither is a wrong key', async () => {
        const key = Buffer.from('k'.repeat(32));
        await seeded('keyed', { key });
        expect((await new NdjsonRunJournal(dir, { key }).get('keyed'))?.status).toBe('done');
        await expect(new NdjsonRunJournal(dir, { key: Buffer.from('z'.repeat(32)) }).get('keyed')).rejects.toBeInstanceOf(JournalCorrupt);
        await expect(new NdjsonRunJournal(dir).get('keyed')).rejects.toBeInstanceOf(JournalCorrupt); // same file read as if it had no key
    });

    it('without a key the chain still catches damage, but one who rewrites it whole can recompute it (that is what the key is for)', async () => {
        await seeded('plain');
        const ls = lines('plain').map(l => JSON.parse(l) as { n: number; event: { kind: string }; mac: string });
        // someone edits an output and recomputes a plain SHA-256 chain
        const { createHash } = await import('crypto');
        let prev = '0'.repeat(64);
        const forged = ls.map(l => {
            const ev = JSON.stringify(l.event).replace('out-a', 'forged');
            const event = JSON.parse(ev);
            const mac = createHash('sha256').update(`${prev}\n${JSON.stringify({ n: l.n, event })}`).digest('hex');
            prev = mac;
            return JSON.stringify({ n: l.n, event, mac });
        });
        rewrite('plain', forged);
        expect((await new NdjsonRunJournal(dir).get('plain'))?.steps.a.output).toBe('forged'); // not detected: documented
    });
});

describe('NdjsonRunJournal: a write cut in the middle', () => {
    it('a last line with no newline was never acknowledged: it is ignored, and cut off before the next write', async () => {
        await seeded();
        const before = lines('r1').length;
        fsSync.appendFileSync(file('r1'), '{"n":5,"event":{"kind":"step","at":"x","stepId":"c","patch":{"status":"do'); // the process died here
        const fresh = new NdjsonRunJournal(dir);
        expect(Object.keys((await fresh.get('r1'))!.steps).sort()).toEqual(['a', 'b']); // the torn line is not an event
        await fresh.step('r1', 'c', { status: 'done', attempt: 1, output: 'out-c' }); // first write: cuts it off
        expect(lines('r1')).toHaveLength(before + 1);
        expect((await new NdjsonRunJournal(dir).get('r1'))?.steps.c.output).toBe('out-c'); // and the chain is valid
    });

    it('a complete-looking last line without its newline is also dropped: one write carries both', async () => {
        await seeded();
        const last = lines('r1').pop()!;
        fsSync.writeFileSync(file('r1'), lines('r1').slice(0, -1).join('\n') + '\n' + last); // the final newline did not make it
        expect((await new NdjsonRunJournal(dir).get('r1'))?.status).toBe('running'); // the "done" update was not acknowledged
    });

    it('a file with nothing acknowledged is not a run: it is not listed, and the id can begin again', async () => {
        fsSync.writeFileSync(file('empty'), '{"n":0,"event":{"kind":"begin"');
        const j = new NdjsonRunJournal(dir);
        expect(await j.get('empty')).toBeUndefined();
        expect((await j.list()).map(r => r.runId)).toEqual([]);
        await j.begin(run('empty'));
        expect((await j.get('empty'))?.runId).toBe('empty');
    });
});

describe('NdjsonRunJournal: list', () => {
    it('lists the runs, oldest first, with filters; a corrupt one is set aside and reported, not hiding the others', async () => {
        const j = new NdjsonRunJournal(dir);
        await j.begin(run('a', 'one')); await sleep(5);
        await j.begin(run('b', 'two')); await j.update('b', { status: 'failed' });
        await seeded('c');
        const ls = lines('c'); ls[1] = ls[1].replace('"running"', '"done"'); rewrite('c', ls);
        expect((await j.list()).map(r => r.runId)).toEqual(['a', 'b']);
        expect([...j.problems.keys()]).toEqual(['c']);
        expect(j.problems.get('c')).toMatch(/altered/);
        expect((await j.list({ flow: 'two' })).map(r => r.runId)).toEqual(['b']);
        expect((await j.list({ status: ['failed'] })).map(r => r.runId)).toEqual(['b']);
    });

    it('sees a run that grew (the cache is by size)', async () => {
        const j = new NdjsonRunJournal(dir);
        await j.begin(run('g'));
        expect((await j.list())[0].status).toBe('running');
        await j.update('g', { status: 'done' });
        expect((await j.list())[0].status).toBe('done');
    });
});

describe('NdjsonRunJournal: one writer', () => {
    it('a new journal object picks up where the last left off (a restart), and the old writer finds out it is not the one any more', async () => {
        const first = await seeded();
        const second = new NdjsonRunJournal(dir);
        await second.step('r1', 'c', { status: 'done', attempt: 1, output: 'out-c' }); // reads and verifies the file, then writes
        expect((await second.get('r1'))?.steps.c.output).toBe('out-c');
        await expect(first.step('r1', 'd', { status: 'done', attempt: 1 })).rejects.toBeInstanceOf(JournalConflict);
        expect((await second.get('r1'))?.steps.d).toBeUndefined(); // the old writer wrote nothing
    });

    it('a write that fails does not stop the ones queued behind it', async () => {
        const j = new NdjsonRunJournal(dir);
        await j.begin(run('q'));
        const results = await Promise.allSettled([
            j.step('q', 'a', { status: 'done', attempt: 1 }),
            j.step('ghost', 'x', { status: 'done' }),
            j.step('q', 'b', { status: 'done', attempt: 1 }),
        ]);
        expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
        expect(Object.keys((await j.get('q'))!.steps).sort()).toEqual(['a', 'b']);
    });
});

describe('NdjsonRunJournal: the claim is a lock whose holder can be asked if it is alive', () => {
    it('is exclusive; the same owner asking again holds it; releasing is for its owner only', async () => {
        const j = new NdjsonRunJournal(dir);
        const a = await j.claim('c1', 'a', 1);
        expect(a).not.toBeNull();
        expect(await j.claim('c1', 'b', 60_000)).toBeNull();
        const again = await j.claim('c1', 'a', 1);
        expect(again).not.toBeNull();
        expect(fsSync.existsSync(lock('c1'))).toBe(true);
        await a!();
        expect(fsSync.existsSync(lock('c1'))).toBe(false);
        expect(await j.claim('c1', 'b', 60_000)).not.toBeNull();
    });

    it('a holder that was relieved (it stalled and another process took over) does not delete the lock of the new one when it finally releases', async () => {
        const j = new NdjsonRunJournal(dir);
        const old = await j.claim('relieved', 'old', 1);
        // another process took the run over: its lock is in the file now
        fsSync.writeFileSync(lock('relieved'), JSON.stringify({ owner: 'new', pid: process.pid, token: 'the-token-of-the-new-process' }));
        await old!();
        expect(fsSync.existsSync(lock('relieved'))).toBe(true);
        expect(JSON.parse(fsSync.readFileSync(lock('relieved'), 'utf8')).owner).toBe('new');
    });

    it('a holder that is gone is relieved at once, whatever the TTL', async () => {
        fsSync.writeFileSync(lock('dead'), JSON.stringify({ owner: 'old', pid: await deadPid(), token: 'a-process-that-is-gone' }));
        const j = new NdjsonRunJournal(dir);
        expect(await j.claim('dead', 'new', 3_600_000)).not.toBeNull();
        expect(JSON.parse(fsSync.readFileSync(lock('dead'), 'utf8')).owner).toBe('new');
    });

    it('the same pid with another token is the process that ran before this one (a restarted container): gone', async () => {
        fsSync.writeFileSync(lock('same-pid'), JSON.stringify({ owner: 'old', pid: process.pid, token: 'the-token-of-the-previous-process' }));
        expect(await new NdjsonRunJournal(dir).claim('same-pid', 'new', 60_000)).not.toBeNull();
    });

    it('a lock nobody can read is not held by anybody', async () => {
        fsSync.writeFileSync(lock('garbage'), 'not json');
        expect(await new NdjsonRunJournal(dir).claim('garbage', 'new', 60_000)).not.toBeNull();
        fsSync.writeFileSync(lock('nopid'), JSON.stringify({ owner: 'x' }));
        expect(await new NdjsonRunJournal(dir).claim('nopid', 'new', 60_000)).not.toBeNull();
    });

    it('a holder that is alive is respected however long it takes; once it dies the run is free', async () => {
        const child = liveProcess();
        try {
            await sleep(300);
            fsSync.writeFileSync(lock('alive'), JSON.stringify({ owner: 'slow', pid: child.pid, token: 'another-process' }));
            const j = new NdjsonRunJournal(dir);
            expect(await j.claim('alive', 'impatient', 1)).toBeNull(); // a TTL of 1 ms changes nothing
            child.kill('SIGKILL');
            await new Promise(r => child.on('exit', r));
            expect(await j.claim('alive', 'impatient', 1)).not.toBeNull();
        } finally { child.kill('SIGKILL'); }
    });

    it('of many journal objects racing for a claim, exactly one wins', async () => {
        const got = await Promise.all(Array.from({ length: 20 }, (_, i) => new NdjsonRunJournal(dir).claim('race', `o${i}`, 1)));
        expect(got.filter(Boolean)).toHaveLength(1);
    });
});

describe('NdjsonRunJournal with runFlow', () => {
    const wide = (n: number) => {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        return FlowDefinitionSchema.parse({
            flow: 'wide', trigger: { type: 'manual' },
            steps: [...ids.map(id => ({ id, agent: 'a', prompt: 'x' })), { id: 'end', agent: 'a', prompt: 'y', after: ids }],
        });
    };
    const two = FlowDefinitionSchema.parse({ flow: 'two', trigger: { type: 'manual' }, steps: [{ id: 'a', agent: 'x', prompt: 'p' }, { id: 'b', agent: 'x', prompt: 'p', after: ['a'] }] });

    it('a flow with 60 parallel steps completes, and the file is a valid chain', async () => {
        const executor: StepExecutor = { run: async s => ({ content: `out-${s.id}` }) };
        const journal = new NdjsonRunJournal(dir);
        const r = await runFlow(wide(60), { executor, journal, runId: 'wide-1', maxConcurrency: 60 });
        expect(r.status).toBe('completed');
        expect((await new NdjsonRunJournal(dir).get('wide-1'))?.status).toBe('done');
        expect(fsSync.existsSync(lock('wide-1'))).toBe(false); // released
    });

    it('the process that was running it died: another one takes the run at once and does not repeat what was done', async () => {
        // what the dead process left: a begun run, step a done, and its lock
        const dead = new NdjsonRunJournal(dir);
        await dead.begin(run('crash', 'two'));
        await dead.step('crash', 'a', { status: 'running', attempt: 1 });
        await dead.step('crash', 'a', { status: 'done', attempt: 1, output: 'out-a' });
        await dead.step('crash', 'b', { status: 'running', attempt: 1 });
        fsSync.writeFileSync(lock('crash'), JSON.stringify({ owner: 'old', pid: await deadPid(), token: 'gone' }));

        const calls: string[] = [];
        const executor: StepExecutor = { run: async (s, i) => { calls.push(`${s.id}:${i.idempotencyKey}`); return { content: `out-${s.id}` }; } };
        const t0 = Date.now();
        const r = await runFlow(two, { executor, journal: new NdjsonRunJournal(dir), runId: 'crash', claimTtlMs: 3_600_000 });
        expect(Date.now() - t0).toBeLessThan(2000); // no TTL to wait for
        expect(r.status).toBe('completed');
        expect(calls).toEqual(['b:crash:b:2']); // a is not run again; b was running when the process died: its second attempt
    });

    it('a live process holding the run is respected: the second runner gets FlowClaimError', async () => {
        let release!: () => void;
        const hold = new Promise<void>(r => { release = r; });
        const slow: StepExecutor = { run: async () => { await hold; return { content: 'x' }; } };
        const first = runFlow(two, { executor: slow, journal: new NdjsonRunJournal(dir), runId: 'busy', owner: 'p1' });
        await sleep(50);
        await expect(runFlow(two, { executor: slow, journal: new NdjsonRunJournal(dir), runId: 'busy', owner: 'p2', claimTtlMs: 1 })).rejects.toBeInstanceOf(FlowClaimError);
        release();
        expect((await first).status).toBe('completed');
    });

    it('fencing: if someone else writes to the run, this runner stops and writes nothing more, even for a step still in flight', async () => {
        let aborted = false;
        const intruder = new NdjsonRunJournal(dir);
        const executor: StepExecutor = {
            run: async (s, i) => {
                i.signal.addEventListener('abort', () => { aborted = true; });
                if (s.id === 'a') await intruder.step('fenced', 'intruder', { status: 'done', attempt: 1, output: 'not yours' }); // writes while we hold the claim
                return { content: `out-${s.id}` };
            },
        };
        await expect(runFlow(two, { executor, journal: new NdjsonRunJournal(dir), runId: 'fenced' })).rejects.toBeInstanceOf(FlowClaimError);
        expect(aborted).toBe(true);
        const r = await new NdjsonRunJournal(dir).get('fenced');
        expect(r?.steps.intruder.output).toBe('not yours');
        expect(r?.steps.a?.status).toBe('running'); // the "done" of the stale writer never landed
        expect(r?.status).toBe('running');          // and it did not mark the run cancelled either
    });
});
