import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFlow, FlowDefinitionSchema } from '@backendkit-labs/agent-core';
import type { StepExecutor } from '@backendkit-labs/agent-core';
import { journalConformance } from '@backendkit-labs/agent-core/testing';
import { SqliteRunJournal } from '../index';
import type { SyncSqliteDb } from '../index';

// The same journal over a `better-sqlite3` handle (SPEC-0028 F1). The package depends on no driver, so this runs only when
// `better-sqlite3` can be loaded: install it somewhere and point BETTER_SQLITE3_PATH at the module folder
// (`BETTER_SQLITE3_PATH=/tmp/x/node_modules/better-sqlite3 npx jest better-sqlite3`). Otherwise it is skipped.
type Handle = SyncSqliteDb & { close(): void };
let Database: (new (path: string) => Handle) | undefined;
try {
    const target = process.env.BETTER_SQLITE3_PATH ?? 'better-sqlite3';
    Database = require(target) as typeof Database;
} catch { /* not installed */ }

const dirs: string[] = [];
const handles: Handle[] = [];
const open = (file: string): Handle => { const db = new Database!(file); handles.push(db); return db; };
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'flow-sql-bsq3-')); dirs.push(d); return d; };
afterAll(() => {
    for (const h of handles) { try { h.close(); } catch { /* already closed */ } }
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

if (Database) {
    const file = join(tmp(), 'conformance.db');
    journalConformance('SqliteRunJournal over better-sqlite3', {
        make: async () => { const j = new SqliteRunJournal(open(file)); await j.migrate(); return j; },
        exclusiveWriter: true,
        rejectsUnsafeIds: true,
    });
}

(Database ? describe : describe.skip)('SqliteRunJournal over better-sqlite3', () => {
    it('resumes a flow after the process died, from a new connection: done steps are not repeated', async () => {
        const file = join(tmp(), 'r.db');
        const first = new SqliteRunJournal(open(file));
        await first.migrate();
        await first.begin({ runId: 'resume', flow: 'f', inputPreview: '' });
        await first.step('resume', 'a', { status: 'done', output: 'out-a', attempt: 1 });
        await first.step('resume', 'b', { status: 'running', attempt: 1 });

        const calls: string[] = [];
        const executor: StepExecutor = { run: async (s) => { calls.push(s.id); return { content: `out-${s.id}` }; } };
        const def = FlowDefinitionSchema.parse({
            flow: 'f', trigger: { type: 'manual' },
            steps: ['a', 'b', 'c'].map((id, i, all) => ({ id, agent: `agent-${id}`, prompt: `Do ${id}`, after: i > 0 ? [all[i - 1]] : [] })),
        });
        const r = await runFlow(def, { executor, journal: new SqliteRunJournal(open(file)), runId: 'resume' });
        expect(r.status).toBe('completed');
        expect(calls).toEqual(['b', 'c']);
    });
});

if (!Database) console.warn('better-sqlite3 is not available: its tests are skipped (see BETTER_SQLITE3_PATH)');
