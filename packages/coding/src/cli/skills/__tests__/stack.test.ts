import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { detectStack } from '../stack';

// ── detectStack() ─────────────────────────────────────────────────────────────

describe('detectStack()', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-detect-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('detects node when package.json present', async () => {
        await fs.writeFile(path.join(tmpDir, 'package.json'), '{}');
        const stack = await detectStack(tmpDir);
        expect(stack).toContain('node');
    });

    it('detects typescript when tsconfig.json present', async () => {
        await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
        const stack = await detectStack(tmpDir);
        expect(stack).toContain('typescript');
    });

    it('detects python when requirements.txt present', async () => {
        await fs.writeFile(path.join(tmpDir, 'requirements.txt'), '');
        const stack = await detectStack(tmpDir);
        expect(stack).toContain('python');
    });

    it('detects rust when Cargo.toml present', async () => {
        await fs.writeFile(path.join(tmpDir, 'Cargo.toml'), '');
        const stack = await detectStack(tmpDir);
        expect(stack).toContain('rust');
    });

    it('returns empty array for empty directory', async () => {
        const stack = await detectStack(tmpDir);
        expect(stack).toHaveLength(0);
    });

    it('detects multiple stacks when multiple indicators exist', async () => {
        await fs.writeFile(path.join(tmpDir, 'package.json'), '{}');
        await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
        const stack = await detectStack(tmpDir);
        expect(stack).toContain('node');
        expect(stack).toContain('typescript');
    });
});
