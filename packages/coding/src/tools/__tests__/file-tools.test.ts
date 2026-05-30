import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { readFileTool }      from '../read-file';
import { writeFileTool }     from '../write-file';
import { editFileTool }      from '../edit-file';
import { listDirectoryTool } from '../list-directory';

function makeTmpDir() {
    const dir = join(tmpdir(), `bk-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function makeCtx(workingDir: string) {
    return {
        agentId: 'coder', sessionId: 'test', workingDir,
        memory: { get: () => undefined, set: () => undefined, getAll: () => ({}) },
        askAgent: async () => '',
    };
}

let dir: string;
beforeEach(() => { dir = makeTmpDir(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// ── read_file ──────────────────────────────────────────────────────────────────
describe('read_file', () => {
    it('reads existing file', async () => {
        writeFileSync(join(dir, 'hello.txt'), 'hello world', 'utf-8');
        const result = await readFileTool.execute({ file_path: 'hello.txt' }, makeCtx(dir));
        expect(result).toBe('hello world');
    });

    it('returns error string for missing file', async () => {
        const result = await readFileTool.execute({ file_path: 'missing.txt' }, makeCtx(dir));
        expect(result).toMatch(/Error:/);
    });

    it('blocks path traversal', async () => {
        const result = await readFileTool.execute({ file_path: '../../etc/passwd' }, makeCtx(dir));
        expect(result).toMatch(/Error:.*Access denied|outside the working directory/i);
    });

    it('rejects missing file_path', async () => {
        const result = await readFileTool.execute({}, makeCtx(dir));
        expect(result).toMatch(/Invalid arguments/);
    });
});

// ── write_file ─────────────────────────────────────────────────────────────────
describe('write_file', () => {
    it('writes a new file', async () => {
        await writeFileTool.execute({ file_path: 'new.txt', content: 'content' }, makeCtx(dir));
        const { readFileSync } = await import('fs');
        expect(readFileSync(join(dir, 'new.txt'), 'utf-8')).toBe('content');
    });

    it('creates parent directories', async () => {
        await writeFileTool.execute({ file_path: 'a/b/c.txt', content: 'deep' }, makeCtx(dir));
        const { existsSync } = await import('fs');
        expect(existsSync(join(dir, 'a/b/c.txt'))).toBe(true);
    });

    it('blocks path traversal', async () => {
        const result = await writeFileTool.execute({ file_path: '../../evil.txt', content: 'x' }, makeCtx(dir));
        expect(result).toMatch(/Error:.*Access denied|outside the working directory/i);
    });
});

// ── edit_file ──────────────────────────────────────────────────────────────────
describe('edit_file', () => {
    it('replaces exact string', async () => {
        writeFileSync(join(dir, 'file.txt'), 'hello world', 'utf-8');
        const result = await editFileTool.execute(
            { file_path: 'file.txt', old_string: 'world', new_string: 'there' },
            makeCtx(dir),
        );
        expect(result).toMatch(/Edited/);
        const { readFileSync } = await import('fs');
        expect(readFileSync(join(dir, 'file.txt'), 'utf-8')).toBe('hello there');
    });

    it('returns error when old_string not found', async () => {
        writeFileSync(join(dir, 'file.txt'), 'hello', 'utf-8');
        const result = await editFileTool.execute(
            { file_path: 'file.txt', old_string: 'MISSING', new_string: 'x' },
            makeCtx(dir),
        );
        expect(result).toMatch(/Error:.*not found/);
    });

    it('returns error when old_string is ambiguous (replace_all: false)', async () => {
        writeFileSync(join(dir, 'file.txt'), 'aa aa aa', 'utf-8');
        const result = await editFileTool.execute(
            { file_path: 'file.txt', old_string: 'aa', new_string: 'bb', replace_all: false },
            makeCtx(dir),
        );
        expect(result).toMatch(/Error:.*appears \d+ times/);
    });

    it('replace_all replaces every occurrence', async () => {
        writeFileSync(join(dir, 'file.txt'), 'aa aa aa', 'utf-8');
        await editFileTool.execute(
            { file_path: 'file.txt', old_string: 'aa', new_string: 'bb', replace_all: true },
            makeCtx(dir),
        );
        const { readFileSync } = await import('fs');
        expect(readFileSync(join(dir, 'file.txt'), 'utf-8')).toBe('bb bb bb');
    });

    it('blocks path traversal', async () => {
        const result = await editFileTool.execute(
            { file_path: '../secret.txt', old_string: 'x', new_string: 'y' },
            makeCtx(dir),
        );
        expect(result).toMatch(/Error:.*Access denied|outside the working directory/i);
    });
});

// ── list_directory ─────────────────────────────────────────────────────────────
describe('list_directory', () => {
    it('lists files in directory', async () => {
        writeFileSync(join(dir, 'a.ts'), '', 'utf-8');
        writeFileSync(join(dir, 'b.ts'), '', 'utf-8');
        const result = await listDirectoryTool.execute({ path: '.', max_depth: 1 }, makeCtx(dir));
        expect(result).toContain('a.ts');
        expect(result).toContain('b.ts');
    });

    it('blocks path traversal', async () => {
        const result = await listDirectoryTool.execute({ path: '../../etc' }, makeCtx(dir));
        expect(result).toMatch(/Error:.*Access denied|outside the working directory/i);
    });

    it('returns error for non-existent path', async () => {
        const result = await listDirectoryTool.execute({ path: 'nonexistent' }, makeCtx(dir));
        expect(result).toMatch(/Error:/);
    });
});
