import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectProject } from '../add/detector';
import { addImportLine, insertAfterPattern, insertBeforePattern, addPackageScript, addPackageDependency } from '../add/patcher';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-add-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const file = (name: string, content: string) => {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return p;
};
const pkg = (deps: Record<string, string>) => file('package.json', JSON.stringify({ name: 'x', dependencies: deps }));

describe('detectProject', () => {
    it('returns null without package.json, with invalid JSON, or without agent-core', () => {
        expect(detectProject(dir)).toBeNull();
        file('package.json', '{broken');
        expect(detectProject(dir)).toBeNull();
        pkg({ express: '1' });
        expect(detectProject(dir)).toBeNull();
    });

    it('unknown architecture when there is no engine.ts', () => {
        pkg({ '@backendkit-labs/agent-core': '^0.24.0' });
        expect(detectProject(dir)).toMatchObject({ architecture: 'unknown', engineFnName: 'createEngine', isEnterprise: false });
    });

    it('detects enterprise only with the enterprise dependency AND ObsidianRAGProvider', () => {
        pkg({ '@backendkit-labs/agent-core': '1', '@backendkit-labs/agent-enterprise': '1' });
        file('src/engine.ts', 'new ObsidianRAGProvider(); export function make() {}');
        expect(detectProject(dir)).toMatchObject({ architecture: 'enterprise', isEnterprise: true, engineFnName: 'make' });
    });

    it('detects multi-agent via ORCHESTRATOR_PROFILE and single via an exported create* function', () => {
        pkg({ '@backendkit-labs/agent-core': '1' });
        file('src/engine.ts', 'const ORCHESTRATOR_PROFILE = {}; export function createEngine() {}');
        expect(detectProject(dir)?.architecture).toBe('multi-agent');
        file('src/engine.ts', 'export function createThing() {}');
        expect(detectProject(dir)).toMatchObject({ architecture: 'single', engineFnName: 'createThing' });
    });

    it('finds agent-core in devDependencies too', () => {
        file('package.json', JSON.stringify({ devDependencies: { '@backendkit-labs/agent-core': '1' } }));
        expect(detectProject(dir)).not.toBeNull();
    });
});

describe('patcher', () => {
    it('addImportLine goes after the last import, once, and handles files without imports', () => {
        const f = file('a.ts', "import a from 'a';\nimport b from 'b';\n\nconst x = 1;\n");
        addImportLine(f, "import c from 'c';");
        addImportLine(f, "import c from 'c';");
        expect(fs.readFileSync(f, 'utf-8')).toBe("import a from 'a';\nimport b from 'b';\nimport c from 'c';\n\nconst x = 1;\n");

        const g = file('g.ts', 'const y = 2;\n');
        addImportLine(g, "import d from 'd';");
        expect(fs.readFileSync(g, 'utf-8')).toBe("import d from 'd';\nconst y = 2;\n");
    });

    it('insertAfterPattern uses the LAST match; reports a miss; is idempotent', () => {
        const f = file('a.ts', 'tool(1);\ntool(2);\nend();\n');
        expect(insertAfterPattern(f, /^tool\(/, 'tool(3);')).toBe(true);
        expect(fs.readFileSync(f, 'utf-8')).toBe('tool(1);\ntool(2);\ntool(3);\nend();\n');
        expect(insertAfterPattern(f, /^tool\(/, 'tool(3);')).toBe(true);
        expect(fs.readFileSync(f, 'utf-8').match(/tool\(3\)/g)).toHaveLength(1);
        expect(insertAfterPattern(f, /^nothing/, 'x')).toBe(false);
    });

    it('insertBeforePattern uses the FIRST match', () => {
        const f = file('a.ts', 'a();\nreturn;\nreturn;\n');
        expect(insertBeforePattern(f, /^return/, 'log();')).toBe(true);
        expect(fs.readFileSync(f, 'utf-8')).toBe('a();\nlog();\nreturn;\nreturn;\n');
        expect(insertBeforePattern(f, /^nope/, 'x')).toBe(false);
    });

    it('addPackageScript / addPackageDependency edit package.json without clobbering', () => {
        const f = file('package.json', JSON.stringify({ name: 'x', scripts: { build: 'tsc' }, dependencies: { a: '1' } }));
        addPackageScript(f, 'start', 'node .');
        expect(addPackageDependency(f, 'b', '^2.0.0')).toBe(true);
        expect(addPackageDependency(f, 'b', '^3.0.0')).toBe(false); // already present: keep the user's range
        const p = JSON.parse(fs.readFileSync(f, 'utf-8'));
        expect(p.scripts).toEqual({ build: 'tsc', start: 'node .' });
        expect(p.dependencies).toEqual({ a: '1', b: '^2.0.0' });
    });
});
