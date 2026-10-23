import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { SandboxRunner } from '@backendkit-labs/agent-core';
import { createSandboxPolicy, createSandboxService, NoneBackend } from '@backendkit-labs/agent-sandbox';
import { writeFileTool } from '../write-file';
import { editFileTool } from '../edit-file';
import { readFileTool } from '../read-file';
import { listDirectoryTool } from '../list-directory';
import { searchFilesTool } from '../search-files';

describe('file tools through ctx.sandbox', () => {
    let root: string;
    let workspace: string;
    let outside: string;
    let linked = false;

    const ctx = (sandbox?: SandboxRunner, extra: Record<string, unknown> = {}) => ({
        agentId: 'coder', sessionId: 's1', workingDir: workspace,
        memory: { get: () => undefined, set: () => undefined, getAll: () => ({}) },
        askAgent: async () => '',
        ...(sandbox ? { sandbox } : {}),
        ...extra,
    });
    const service = (preset: 'read-only' | 'ask' | 'full', roots: string[] = []) =>
        createSandboxService({ policy: createSandboxPolicy({ preset, roots, writeTools: ['write_file', 'edit_file'] }), backends: [new NoneBackend()] });

    beforeEach(() => {
        root = realpathSync(mkdtempSync(join(tmpdir(), 'bk-ft-')));
        workspace = join(root, 'ws'); outside = join(root, 'outside');
        mkdirSync(workspace); mkdirSync(outside);
        writeFileSync(join(outside, 'secret.txt'), 'secret');
        writeFileSync(join(workspace, 'a.txt'), 'hello');
        try { symlinkSync(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); linked = true; }
        catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err; linked = false; }
    });
    afterEach(() => { rmSync(root, { recursive: true, force: true }); });

    it('without a sandbox nothing changes: the tools behave as before', async () => {
        expect(await writeFileTool.execute({ file_path: 'b.txt', content: 'x' }, ctx())).toContain('Written');
        expect(await readFileTool.execute({ file_path: 'b.txt' }, ctx())).toBe('x');
        expect(await editFileTool.execute({ file_path: 'b.txt', old_string: 'x', new_string: 'y', replace_all: false }, ctx())).toContain('Edited');
    });

    it('inside the workspace the tools work under workspace-write', async () => {
        const sb = service('ask');
        expect(await writeFileTool.execute({ file_path: 'sub/b.txt', content: 'x' }, ctx(sb))).toContain('Written');
        expect(await readFileTool.execute({ file_path: 'sub/b.txt' }, ctx(sb))).toBe('x');
        expect(await editFileTool.execute({ file_path: 'sub/b.txt', old_string: 'x', new_string: 'y', replace_all: false }, ctx(sb))).toContain('Edited');
        expect(await listDirectoryTool.execute({ path: '.', max_depth: 2 }, ctx(sb))).toContain('a.txt');
        expect(await searchFilesTool.execute({ pattern: 'hello', case_insensitive: false }, ctx(sb))).toContain('a.txt:1:hello');
    });

    it('a link inside the workspace cannot be used to write, edit or read outside it', async () => {
        if (!linked) return;
        const sb = service('ask');
        const w = await writeFileTool.execute({ file_path: 'escape/new.txt', content: 'pwned' }, ctx(sb));
        expect(w).toMatch(/^Error: SANDBOX_DENIED: .*outside the allowed roots/);
        expect(existsSync(join(outside, 'new.txt'))).toBe(false);

        const e = await editFileTool.execute({ file_path: 'escape/secret.txt', old_string: 'secret', new_string: 'pwned', replace_all: false }, ctx(sb));
        expect(e).toMatch(/^Error: SANDBOX_DENIED/);
        expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret');

        expect(await readFileTool.execute({ file_path: 'escape/secret.txt' }, ctx(sb))).toMatch(/^Error: SANDBOX_DENIED/);
        expect(await listDirectoryTool.execute({ path: 'escape', max_depth: 1 }, ctx(sb))).toMatch(/^Error: SANDBOX_DENIED/);
        expect(await searchFilesTool.execute({ pattern: 'secret', path: 'escape', case_insensitive: false }, ctx(sb))).toMatch(/^Error: SANDBOX_DENIED/);
    });

    it('the same link works without a sandbox: that is the hole the sandbox closes', async () => {
        if (!linked) return;
        expect(await readFileTool.execute({ file_path: 'escape/secret.txt' }, ctx())).toBe('secret');
    });

    it('in full access the workspace limit of the tool itself still holds', async () => {
        const sb = service('full');
        expect(await writeFileTool.execute({ file_path: join(outside, 'x.txt'), content: 'x' }, ctx(sb))).toMatch(/^Error: Access denied/);
    });

    it('the memory directory (additionalRoots) stays writable', async () => {
        const memory = join(root, 'memory'); mkdirSync(memory);
        const sb = service('ask');
        const out = await writeFileTool.execute({ file_path: join(memory, 'session.md'), content: 'notes' }, ctx(sb, { additionalRoots: [memory] }));
        expect(out).toContain('Written');
        expect(readFileSync(join(memory, 'session.md'), 'utf8')).toBe('notes');
    });

    it('read-only refuses writes and edits (nothing changes) but reads', async () => {
        const sb = service('read-only');
        expect(await writeFileTool.execute({ file_path: 'b.txt', content: 'x' }, ctx(sb))).toMatch(/^Error: SANDBOX_DENIED: .*read-only/);
        expect(existsSync(join(workspace, 'b.txt'))).toBe(false);
        expect(await editFileTool.execute({ file_path: 'a.txt', old_string: 'hello', new_string: 'bye', replace_all: false }, ctx(sb))).toMatch(/^Error: SANDBOX_DENIED/);
        expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('hello');
        expect(await readFileTool.execute({ file_path: 'a.txt' }, ctx(sb))).toBe('hello');
    });
});
