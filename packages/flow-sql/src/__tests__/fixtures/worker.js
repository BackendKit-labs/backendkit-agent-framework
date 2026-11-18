// A separate process over the same SQLite file (SPEC-0028 F1). Prints one JSON line per outcome.
const { DatabaseSync } = require('node:sqlite');
const { SqliteRunJournal } = require('../../../dist/index.js');

const [, , mode, file, runId, who, count] = process.argv;
const journal = new SqliteRunJournal(new DatabaseSync(file));
const out = o => process.stdout.write(JSON.stringify(o) + '\n');

(async () => {
    if (mode === 'claim') {
        const release = await journal.claim(runId, who, 60_000);
        out({ who, won: release !== null });
        await new Promise(r => setTimeout(r, 400)); // hold it while the others try
        if (release) await release();
    } else {
        for (let i = 0; i < Number(count); i++) {
            const stepId = `${who}-${i}`;
            try {
                await journal.step(runId, stepId, { status: 'done', attempt: 1 });
                out({ who, stepId, ok: true });
            } catch (err) {
                out({ who, stepId, ok: false, error: err.name, message: String(err.message).slice(0, 80) });
            }
        }
    }
})().catch(err => { out({ who, fatal: String(err.message) }); process.exit(1); });
