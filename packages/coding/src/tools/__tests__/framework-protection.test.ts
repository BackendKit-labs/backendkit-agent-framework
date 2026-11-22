/** The protection of the framework's own source is for the framework's repository, not for any project that has a packages/core/src. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFrameworkProtection } from '../path-sandbox';
import { writeFileTool } from '../write-file';
import { createToolContext } from '@backendkit-labs/agent-core';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'fw-protect-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

function monorepo(name: string): string {
    const dir = join(root, name);
    mkdirSync(join(dir, 'packages', 'core', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'core', 'package.json'), JSON.stringify({ name: name === 'framework' ? '@backendkit-labs/agent-core' : `@${name}/core` }));
    return dir;
}

describe('checkFrameworkProtection', () => {
    it('a user monorepo with its own packages/core/src is NOT protected: the agent may write its code', () => {
        const dir = monorepo('acme-app');
        expect(checkFrameworkProtection(join(dir, 'packages', 'core', 'src', 'index.ts'), dir)).toBeUndefined();
    });

    it('a project with a packages/core/src and no package.json there is not protected either', () => {
        const dir = join(root, 'bare');
        mkdirSync(join(dir, 'packages', 'core', 'src'), { recursive: true });
        expect(checkFrameworkProtection(join(dir, 'packages', 'core', 'src', 'a.ts'), dir)).toBeUndefined();
    });

    it('the repository of the framework itself still is', () => {
        const dir = monorepo('framework');
        expect(checkFrameworkProtection(join(dir, 'packages', 'core', 'src', 'index.ts'), dir)).toMatch(/Framework protection/);
    });

    it('working inside the framework package (the user is developing it) is still allowed', () => {
        const dir = monorepo('framework');
        const cwd = join(dir, 'packages', 'core', 'src');
        expect(checkFrameworkProtection(join(cwd, 'index.ts'), cwd)).toBeUndefined();
    });
});

describe('write_file in a user monorepo', () => {
    it('writes into its packages/core/src', async () => {
        const dir = monorepo('acme-app');
        const ctx = { ...createToolContext(), workingDir: dir };
        const out = await writeFileTool.execute({ file_path: 'packages/core/src/index.ts', content: 'export const x = 1;\n' }, ctx);
        expect(String(out)).toMatch(/^Written:/);
    });

    it('is refused in the repository of the framework', async () => {
        const dir = monorepo('framework');
        const ctx = { ...createToolContext(), workingDir: dir };
        const out = await writeFileTool.execute({ file_path: 'packages/core/src/index.ts', content: 'x' }, ctx);
        expect(String(out)).toMatch(/Framework protection/);
    });
});
