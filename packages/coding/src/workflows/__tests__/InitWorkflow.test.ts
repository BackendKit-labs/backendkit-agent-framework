import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { InitWorkflow } from '../InitWorkflow';

function makeTmpDir() {
    const dir = join(tmpdir(), `bk-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

describe('InitWorkflow.detectMode', () => {
    let dir: string;
    beforeEach(() => { dir = makeTmpDir(); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("returns 'new' when prompt.md exists and no source code", () => {
        writeFileSync(join(dir, 'prompt.md'), 'Build a fintech app', 'utf-8');
        expect(InitWorkflow.detectMode(dir)).toBe('new');
    });

    it("returns 'existing' when source code exists and no prompt.md", () => {
        writeFileSync(join(dir, 'package.json'), '{}', 'utf-8');
        expect(InitWorkflow.detectMode(dir)).toBe('existing');
    });

    it("returns 'hybrid' when both prompt.md and source code exist", () => {
        writeFileSync(join(dir, 'prompt.md'), 'Add auth', 'utf-8');
        writeFileSync(join(dir, 'package.json'), '{}', 'utf-8');
        expect(InitWorkflow.detectMode(dir)).toBe('hybrid');
    });

    it("returns 'new' (not 'hybrid') when neither prompt.md nor code exist", () => {
        // Empty directory — should default to 'new', not 'hybrid'
        expect(InitWorkflow.detectMode(dir)).toBe('new');
    });

    it("detects existing via src/ directory", () => {
        mkdirSync(join(dir, 'src'), { recursive: true });
        expect(InitWorkflow.detectMode(dir)).toBe('existing');
    });

    it("detects existing via go.mod", () => {
        writeFileSync(join(dir, 'go.mod'), 'module example.com/app\n\ngo 1.21', 'utf-8');
        expect(InitWorkflow.detectMode(dir)).toBe('existing');
    });
});
