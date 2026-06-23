import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { extractFiles, writeFiles, isPathSafe } from '../file-writer.js';

// ── extractFiles ──────────────────────────────────────────────────────────────

describe('extractFiles', () => {

    test('Format A — ### FILE: path', () => {
        const out = '### FILE: src/index.ts\n```typescript\nconst x = 1;\n```';
        const files = extractFiles(out);
        assert.equal(files.length, 1);
        assert.equal(files[0].relativePath, 'src/index.ts');
        assert.equal(files[0].content, 'const x = 1;');
    });

    test('Format A — case insensitive FILE:', () => {
        const out = '### file: src/app.js\n```js\nconsole.log(1)\n```';
        const files = extractFiles(out);
        assert.equal(files.length, 1);
        assert.equal(files[0].relativePath, 'src/app.js');
    });

    test('Format B — ## src/file.ts (no backticks)', () => {
        const out = '## src/service.ts\n```typescript\nexport class S {}\n```';
        const files = extractFiles(out);
        assert.equal(files.length, 1);
        assert.equal(files[0].relativePath, 'src/service.ts');
        assert.equal(files[0].content, 'export class S {}');
    });

    test('Format B — ## `src/file.ts` (with backticks)', () => {
        const out = '## `src/router.ts`\n```typescript\nconst r = 1;\n```';
        const files = extractFiles(out);
        assert.equal(files.length, 1);
        assert.equal(files[0].relativePath, 'src/router.ts');
    });

    test('Format D — **`src/file.ts`** (DeepSeek bold with backticks)', () => {
        const out = '**`src/model.ts`**\n```typescript\nexport type T = string;\n```';
        const files = extractFiles(out);
        assert.equal(files.length, 1);
        assert.equal(files[0].relativePath, 'src/model.ts');
    });

    test('Format D — **FILE: src/file.ts**', () => {
        const out = '**FILE: src/handler.ts**\n```typescript\nexport const h = 1;\n```';
        const files = extractFiles(out);
        assert.equal(files.length, 1);
        assert.equal(files[0].relativePath, 'src/handler.ts');
    });

    test('Format C — first line comment // path', () => {
        const out = '```typescript\n// src/util.ts\nexport const u = 1;\n```';
        const files = extractFiles(out);
        assert.equal(files.length, 1);
        assert.equal(files[0].relativePath, 'src/util.ts');
        assert.equal(files[0].content, 'export const u = 1;');
    });

    test('Format C — first line hash comment # path.py', () => {
        const out = '```python\n# src/main.py\nprint("hi")\n```';
        const files = extractFiles(out);
        assert.equal(files.length, 1);
        assert.equal(files[0].relativePath, 'src/main.py');
    });

    test('multiple files in one output', () => {
        const out = [
            '### FILE: src/a.ts',
            '```typescript',
            'const a = 1;',
            '```',
            '',
            '### FILE: src/b.ts',
            '```typescript',
            'const b = 2;',
            '```',
        ].join('\n');
        const files = extractFiles(out);
        assert.equal(files.length, 2);
        assert.equal(files[0].relativePath, 'src/a.ts');
        assert.equal(files[1].relativePath, 'src/b.ts');
    });

    test('duplicate paths — last write wins', () => {
        const out = [
            '### FILE: src/index.ts',
            '```typescript',
            'const v = 1;',
            '```',
            '### FILE: src/index.ts',
            '```typescript',
            'const v = 2;',
            '```',
        ].join('\n');
        const files = extractFiles(out);
        assert.equal(files.length, 1);
        assert.equal(files[0].content, 'const v = 2;');
    });

    test('skips code blocks without file path header', () => {
        const out = '```typescript\nconst x = 1;\n```';
        const files = extractFiles(out);
        assert.equal(files.length, 0);
    });

    test('mixed formats in same output', () => {
        const out = [
            '### FILE: src/a.ts\n```ts\nconst a = 1;\n```',
            '**`src/b.ts`**\n```ts\nconst b = 2;\n```',
            '## src/c.ts\n```ts\nconst c = 3;\n```',
        ].join('\n\n');
        const files = extractFiles(out);
        assert.equal(files.length, 3);
    });
});

// ── isPathSafe (tarea 2.2) ────────────────────────────────────────────────────

describe('isPathSafe', () => {
    const root = '/tmp/project';

    test('valid TS file inside root', () => {
        assert.ok(isPathSafe('src/index.ts', root, root));
    });

    test('path traversal rejected', () => {
        assert.ok(!isPathSafe('../../../etc/passwd', root, root));
    });

    test('empty path rejected', () => {
        assert.ok(!isPathSafe('', root, root));
    });

    test('whitespace-only path rejected', () => {
        assert.ok(!isPathSafe('   ', root, root));
    });

    test('.sh blocked', () => {
        assert.ok(!isPathSafe('scripts/setup.sh', root, root));
    });

    test('.bat blocked', () => {
        assert.ok(!isPathSafe('run.bat', root, root));
    });

    test('.exe blocked', () => {
        assert.ok(!isPathSafe('bin/app.exe', root, root));
    });

    test('.ps1 blocked', () => {
        assert.ok(!isPathSafe('install.ps1', root, root));
    });

    test('nested valid path allowed', () => {
        assert.ok(isPathSafe('src/handlers/user.controller.ts', root, root));
    });
});

// ── writeFiles ────────────────────────────────────────────────────────────────

describe('writeFiles', () => {
    test('writes files to disk and returns count', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));
        try {
            const count = writeFiles(
                [{ relativePath: 'src/index.ts', content: 'const x = 1;' }],
                tmpDir,
            );
            assert.equal(count, 1);
            const written = fs.readFileSync(path.join(tmpDir, 'src', 'index.ts'), 'utf-8');
            assert.equal(written, 'const x = 1;');
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    test('creates nested directories automatically', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));
        try {
            writeFiles([{ relativePath: 'a/b/c/file.ts', content: 'ok' }], tmpDir);
            assert.ok(fs.existsSync(path.join(tmpDir, 'a', 'b', 'c', 'file.ts')));
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    test('skips empty content', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));
        try {
            const count = writeFiles([{ relativePath: 'empty.ts', content: '   ' }], tmpDir);
            assert.equal(count, 0);
            assert.ok(!fs.existsSync(path.join(tmpDir, 'empty.ts')));
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    test('skips path traversal attempt', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));
        try {
            const count = writeFiles([{ relativePath: '../../../evil.ts', content: 'evil' }], tmpDir);
            assert.equal(count, 0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    test('skips blocked extension .sh', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));
        try {
            const count = writeFiles([{ relativePath: 'setup.sh', content: 'rm -rf /' }], tmpDir);
            assert.equal(count, 0);
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    test('domain base: qa files go to .qa/', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));
        try {
            writeFiles([{ relativePath: 'qa-phase1.md', content: '# QA' }], tmpDir, 'qa');
            assert.ok(fs.existsSync(path.join(tmpDir, '.qa', 'qa-phase1.md')));
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    test('calls onFile callback for each written file', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));
        const reported: string[] = [];
        try {
            writeFiles(
                [
                    { relativePath: 'a.ts', content: 'a' },
                    { relativePath: 'b.ts', content: 'b' },
                ],
                tmpDir,
                undefined,
                (p) => reported.push(p),
            );
            assert.equal(reported.length, 2);
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });
});
