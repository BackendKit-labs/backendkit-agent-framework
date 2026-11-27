import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectProject } from '../add/detector';
import { addImportLine, insertAfterPattern, insertBeforePattern, addPackageScript, addPackageDependency, addPackageDevDependency } from '../add/patcher';
import { addTesting, EXAMPLE_TEST } from '../add/modules/testing';

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

describe('add testing', () => {
    const project = () => {
        const pkgFile = file('package.json', JSON.stringify({ name: 'my-agent', scripts: { build: 'tsc' }, dependencies: { '@backendkit-labs/agent-core': '^0.29.0' } }));
        const info = detectProject(dir)!;
        expect(info.pkgFile).toBe(pkgFile);
        return info;
    };
    const quiet = () => jest.spyOn(console, 'log').mockImplementation(() => undefined);

    it('addPackageDevDependency adds once and respects what is already declared', () => {
        const f = file('package.json', JSON.stringify({ name: 'x', dependencies: { a: '1' }, devDependencies: { b: '2' } }));
        expect(addPackageDevDependency(f, 'c', '^3.0.0')).toBe(true);
        expect(addPackageDevDependency(f, 'c', '^9.0.0')).toBe(false);
        expect(addPackageDevDependency(f, 'a', '^9.0.0')).toBe(false);   // already a runtime dependency
        expect(addPackageDevDependency(f, 'b', '^9.0.0')).toBe(false);
        expect(JSON.parse(fs.readFileSync(f, 'utf-8')).devDependencies).toEqual({ b: '2', c: '^3.0.0' });
    });

    it('adds the dev dependencies, the test script, a jest config and the example test', () => {
        const info = project();
        const log = quiet();
        addTesting(info, [], { install: false });
        log.mockRestore();

        const p = JSON.parse(fs.readFileSync(info.pkgFile, 'utf-8'));
        expect(p.scripts).toEqual({ build: 'tsc', test: 'jest' });
        expect(Object.keys(p.devDependencies).sort()).toEqual(['@backendkit-labs/agent-testkit', '@types/jest', 'jest', 'ts-jest']);
        expect(p.devDependencies['@backendkit-labs/agent-testkit'].startsWith('^0.1.')).toBe(true);
        expect(fs.readFileSync(path.join(dir, 'jest.config.js'), 'utf-8')).toContain("preset: 'ts-jest'");
        expect(fs.readFileSync(path.join(dir, 'src', '__tests__', 'agent.example.test.ts'), 'utf-8')).toBe(EXAMPLE_TEST);
    });

    it('never overwrites an existing jest config, test file or testkit range', () => {
        const info = project();
        const pkgJson = JSON.parse(fs.readFileSync(info.pkgFile, 'utf-8'));
        pkgJson.devDependencies = { '@backendkit-labs/agent-testkit': '^0.1.5' };
        fs.writeFileSync(info.pkgFile, JSON.stringify(pkgJson));
        file('jest.config.ts', 'export default {};');
        file('src/__tests__/agent.example.test.ts', '// mine');
        const log = quiet();
        addTesting(info, [], { install: false });
        log.mockRestore();

        expect(fs.existsSync(path.join(dir, 'jest.config.js'))).toBe(false);
        expect(fs.readFileSync(path.join(dir, 'src', '__tests__', 'agent.example.test.ts'), 'utf-8')).toBe('// mine');
        expect(JSON.parse(fs.readFileSync(info.pkgFile, 'utf-8')).devDependencies['@backendkit-labs/agent-testkit']).toBe('^0.1.5');
    });
});

describe('add server: what the user types cannot break the generated code (audit B-26)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { addServer } = require('../add/modules/server') as typeof import('../add/modules/server');
    const project = () => {
        pkg({ '@backendkit-labs/agent-core': '1' });
        file('src/engine.ts', 'export function createEngine() {}');
        return detectProject(dir)!;
    };
    const quiet = () => [jest.spyOn(console, 'log').mockImplementation(() => undefined), jest.spyOn(console, 'error').mockImplementation(() => undefined)];

    it("a name with a quote stays a string: O'Brien does not end the literal", () => {
        const spies = quiet();
        try {
            addServer(project(), ['--name', "O'Brien'); process.exit(1); ('"]);
            const code = fs.readFileSync(path.join(dir, 'src', 'server.ts'), 'utf-8');
            const literal = /name:\s+(.+),\n/.exec(code)![1];
            expect(new Function(`return ${literal}`)()).toBe("O'Brien'); process.exit(1); ('");
        } finally { spies.forEach(s => s.mockRestore()); }
    });

    it.each(['abc', '3001abc', '0', '70000', '-1'])('refuses --port %s', (port) => {
        const spies = quiet();
        const exit = jest.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
        try {
            expect(() => addServer(project(), ['--port', port])).toThrow('exit');
            expect(fs.existsSync(path.join(dir, 'src', 'server.ts'))).toBe(false);
        } finally { exit.mockRestore(); spies.forEach(s => s.mockRestore()); }
    });
});