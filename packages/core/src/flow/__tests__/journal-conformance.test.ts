import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryRunJournal } from '../journal';
import { NdjsonRunJournal } from '../ndjson-journal';
import { journalConformance } from '../../testing';

// The journals of agent-core against the shared battery (SPEC-0028 F0). The Redis journal runs it from agent-flow-queue.

describe('RunJournals of agent-core', () => {
    const dirs: string[] = [];
    const dir = () => { const d = mkdtempSync(join(tmpdir(), 'journal-conformance-')); dirs.push(d); return d; };
    afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

    const memory = new MemoryRunJournal(); // one object: every make() sees the same runs, as a file does
    journalConformance('MemoryRunJournal', { make: () => memory, shared: true });

    const ndjson = dir();
    // The ndjson journal frees a claim when its holder is gone and ignores the TTL (SPEC-0024 D2), and a second object
    // that writes to a run gets JournalConflict (one writer per run).
    journalConformance('NdjsonRunJournal', { make: () => new NdjsonRunJournal(ndjson), expiresByTtl: false, exclusiveWriter: true, rejectsUnsafeIds: true });
});
