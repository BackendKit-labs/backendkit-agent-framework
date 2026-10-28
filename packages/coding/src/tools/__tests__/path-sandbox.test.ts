import { resolveAndCheck } from '../path-sandbox';
import { mkdirSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

let BASE: string;
beforeEach(() => {
    BASE = join(tmpdir(), `bk-sandbox-test-${randomUUID()}`);
    mkdirSync(BASE, { recursive: true });
});
afterEach(() => { rmSync(BASE, { recursive: true, force: true }); });

describe('resolveAndCheck', () => {
    it('returns absolute path for a safe relative path', () => {
        const abs = resolveAndCheck(BASE, 'src/index.ts');
        expect(abs).toBe(join(BASE, 'src', 'index.ts'));
    });

    it('returns absolute path for a safe absolute path inside workingDir', () => {
        const inner = join(BASE, 'src', 'file.ts');
        expect(() => resolveAndCheck(BASE, inner)).not.toThrow();
    });

    it('throws on simple path traversal', () => {
        expect(() => resolveAndCheck(BASE, '../../etc/passwd')).toThrow(/Access denied/);
    });

    it('throws on disguised traversal', () => {
        expect(() => resolveAndCheck(BASE, 'src/../../../../../../etc/shadow')).toThrow(/Access denied/);
    });

    it('allows the workingDir itself', () => {
        expect(() => resolveAndCheck(BASE, '.')).not.toThrow();
    });

    it('allows deeply nested paths', () => {
        expect(() => resolveAndCheck(BASE, 'a/b/c/d/e.ts')).not.toThrow();
    });

    it('uses process.cwd() when workingDir is undefined', () => {
        const abs = resolveAndCheck(undefined, 'file.txt');
        expect(abs).toContain('file.txt');
    });

    it('returned path contains the relative segment', () => {
        const abs = resolveAndCheck(BASE, 'sub/dir/file.ts');
        expect(abs).toContain('sub');
        expect(abs).toContain('file.ts');
    });

    describe('symlink escape', () => {
        // 'junction' needs no privilege on Windows; on POSIX it is a plain directory symlink.
        it('rejects a link inside the working dir that points outside', () => {
            const outside = join(tmpdir(), `bk-sandbox-outside-${randomUUID()}`);
            mkdirSync(outside, { recursive: true });
            try {
                symlinkSync(outside, join(BASE, 'link'), 'junction');
                expect(() => resolveAndCheck(BASE, 'link/secret.txt')).toThrow(/Access denied/);
                expect(() => resolveAndCheck(BASE, 'link')).toThrow(/Access denied/);
            } finally {
                rmSync(outside, { recursive: true, force: true });
            }
        });

        it('allows a link that points inside the working dir', () => {
            mkdirSync(join(BASE, 'real'), { recursive: true });
            symlinkSync(join(BASE, 'real'), join(BASE, 'alias'), 'junction');
            expect(() => resolveAndCheck(BASE, 'alias/new-file.ts')).not.toThrow();
        });
    });
});
