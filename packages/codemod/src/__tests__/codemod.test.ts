import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, TRANSFORMS } from '../index';

const FIXTURES = join(__dirname, 'fixtures');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'codemod-')); dirs.push(d); return d; };
const lf = (s: string): string => s.replace(/\r\n/g, '\n');

/** Runs the command and returns the exit code and what it printed. */
async function run(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
    const out: string[] = []; const err: string[] = [];
    const code = await main(argv, { out: l => out.push(l), err: l => err.push(l) });
    return { code, out, err };
}

const read = (dir: string): Record<string, string> =>
    Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.ts')).sort().map(f => [f, lf(readFileSync(join(dir, f), 'utf8'))]));

// Each transformation has a pair of folders: `before/` is what a project looks like, `after/` what the command must leave.
describe.each(['scope-rename', 'coding-split', 'terminal-app-split', 'zod4-record'])('%s', name => {
    const before = join(FIXTURES, name, 'before');
    const after = join(FIXTURES, name, 'after');
    const copy = (): string => { const d = tmp(); cpSync(before, d, { recursive: true }); return d; };

    it('leaves the project as the after folder says', async () => {
        const d = copy();
        const r = await run(name, d);
        expect(r.code).toBe(0);
        expect(read(d)).toEqual(read(after));
    });

    it('is idempotent: a second run changes nothing', async () => {
        const d = copy();
        await run(name, d);
        const once = read(d);
        const r = await run(name, d);
        expect(r.out[r.out.length - 1]).toBe('changed 0 files');
        expect(read(d)).toEqual(once);
    });

    it('--dry-run reports and writes nothing', async () => {
        const d = copy();
        const r = await run(name, d, '--dry-run');
        expect(r.code).toBe(0);
        expect(r.out[r.out.length - 1]).toMatch(/^would change [1-9]/);
        expect(read(d)).toEqual(read(before));
    });
});

describe('what the command prints', () => {
    it('lists the symbols moved with paths relative to what was pointed at, and the statements that need a person', async () => {
        const d = tmp(); cpSync(join(FIXTURES, 'coding-split', 'before'), d, { recursive: true });
        const r = await run('coding-split', d);
        expect(r.out).toContain('engine.ts: Orchestrator -> @backendkit-labs/agent-coding/pipeline');
        expect(r.out).toContain('TODO engine.ts: ProjectStoreData (no destination)');
        expect(r.out).toContain('TODO namespace.ts: core.Orchestrator (namespace use)');
        expect(r.out[r.out.length - 1]).toBe('changed 3 files; 3 need a decision (search for TODO(codemod))');
    });

    it('--list names every transformation with the release that asks for it', async () => {
        const r = await run('--list');
        expect(r.code).toBe(0);
        for (const t of TRANSFORMS) expect(r.out.join('\n')).toContain(`${t.name}\n  ${t.description}\n  since ${t.since}`);
    });
});

describe('what it leaves alone', () => {
    it('does not touch dependencies, build output or declaration files', async () => {
        const d = tmp();
        const src = "import { Orchestrator } from '@backendkit-labs/agent-core';\nexport const x = Orchestrator;\n";
        for (const sub of ['node_modules/pkg', 'dist']) { mkdirSync(join(d, sub), { recursive: true }); writeFileSync(join(d, sub, 'a.ts'), src); }
        writeFileSync(join(d, 'types.d.ts'), src);
        writeFileSync(join(d, 'mine.ts'), src);
        await run('coding-split', d);
        expect(readFileSync(join(d, 'node_modules/pkg/a.ts'), 'utf8')).toBe(src);
        expect(readFileSync(join(d, 'dist/a.ts'), 'utf8')).toBe(src);
        expect(readFileSync(join(d, 'types.d.ts'), 'utf8')).toBe(src);
        expect(readFileSync(join(d, 'mine.ts'), 'utf8')).not.toBe(src);
    });

    it('keeps an alias, a type-only import and a package that has the same name as a symbol', async () => {
        const d = tmp();
        writeFileSync(join(d, 'a.ts'), [
            "import { Orchestrator as Orch, type QAService } from '@backendkit-labs/agent-core';",
            "import { Orchestrator } from 'unrelated-package';",
            '',
        ].join('\n'));
        await run('coding-split', d);
        expect(lf(readFileSync(join(d, 'a.ts'), 'utf8'))).toBe([
            "import { Orchestrator as Orch, type QAService } from '@backendkit-labs/agent-coding/pipeline';",
            "import { Orchestrator } from 'unrelated-package';",
            '',
        ].join('\n'));
    });

    it('keeps the line endings of the file (CRLF stays CRLF) and its quotes', async () => {
        const d = tmp();
        writeFileSync(join(d, 'a.ts'), ['import { createBaseEngine, Orchestrator } from "@backendkit-labs/agent-core";', '', 'export const x = 1;', ''].join('\r\n'));
        await run('coding-split', d);
        const text = readFileSync(join(d, 'a.ts'), 'utf8');
        expect(text).not.toMatch(/[^\r]\n/);
        expect(text).toContain('import { Orchestrator } from "@backendkit-labs/agent-coding/pipeline";');
    });

    it('accepts a single file as the path', async () => {
        const d = tmp();
        writeFileSync(join(d, 'a.ts'), "import { Orchestrator } from '@backendkit-labs/agent-core';\n");
        writeFileSync(join(d, 'b.ts'), "import { Orchestrator } from '@backendkit-labs/agent-core';\n");
        const r = await run('coding-split', join(d, 'a.ts'));
        expect(r.out[r.out.length - 1]).toBe('changed 1 file');
        expect(readFileSync(join(d, 'b.ts'), 'utf8')).toContain('agent-core');
    });
});

describe('the command line', () => {
    it('refuses what it does not know, with a message and a non-zero code', async () => {
        expect((await run('nope', '.')).code).toBe(1);
        expect((await run('coding-split', join(tmp(), 'missing'))).err.join('')).toMatch(/path not found/);
        expect((await run('coding-split', '--force')).err.join('')).toMatch(/unknown option --force/);
    });

    it('prints the usage when run without arguments, and with --help', async () => {
        const none = await run();
        expect(none.code).toBe(1);
        expect(none.out.join('\n')).toContain('Usage: codemod');
        const help = await run('--help');
        expect(help.code).toBe(0);
        expect(existsSync(join(__dirname, '..', '..', 'bin', 'codemod.js'))).toBe(true);
    });
});
