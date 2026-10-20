import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GENERATED_DEP_RANGES, scaffold } from '../scaffold';
import { validateProjectName } from '../prompts';
import type { ArchitectureId, DeployMode, ProviderId, UserChoices } from '../prompts';

const PACKAGES = path.resolve(__dirname, '../../..');
const TEMPLATES = path.join(PACKAGES, 'templates');

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-scaffold-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const choices = (over: Partial<UserChoices> = {}): UserChoices => ({
    projectName: 'my-agent', architecture: 'minimal', skillPacks: [], deployMode: undefined, provider: 'anthropic', ...over,
});
const gen = (over: Partial<UserChoices> = {}) => {
    const dir = path.join(root, over.projectName ?? 'my-agent');
    scaffold(choices(over), dir);
    return dir;
};
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const read = (p: string) => fs.readFileSync(p, 'utf-8');

describe('scaffold', () => {
    it.each(['minimal', 'single', 'multi-agent', 'coding', 'autonomous', 'enterprise'] as ArchitectureId[])(
        '%s: produces a project with the chosen package name and a src dir', (architecture) => {
            const dir = gen({ architecture, deployMode: 'repl', vaultPath: '/vault' });
            expect(readJson(path.join(dir, 'package.json')).name).toBe('my-agent');
            expect(fs.existsSync(path.join(dir, 'src'))).toBe(true);
        });

    it('refuses to overwrite an existing directory', () => {
        const dir = path.join(root, 'taken');
        fs.mkdirSync(dir);
        expect(() => scaffold(choices({ projectName: 'taken' }), dir)).toThrow(/already exists/);
    });

    it('fails clearly for an unknown architecture', () => {
        expect(() => gen({ architecture: 'nope' as ArchitectureId })).toThrow(/Base template not found: nope/);
    });

    describe('.env', () => {
        it.each<[ProviderId, string, string | null]>([
            ['anthropic', 'ANTHROPIC_API_KEY=', null],
            ['openai',    'OPENAI_API_KEY=',    'https://api.openai.com/v1'],
            ['deepseek',  'LLM_API_KEY=',       'https://api.deepseek.com/v1'],
            ['ollama',    'OLLAMA_BASE_URL=',   null],
        ])('%s writes its key var and the right base URL', (provider, keyVar, baseUrl) => {
            const dir = gen({ provider });
            const env = read(path.join(dir, '.env'));
            expect(env).toContain(keyVar);
            expect(env).toContain(`LLM_PROVIDER=${provider}`);
            if (baseUrl) expect(env).toContain(`LLM_BASE_URL=${baseUrl}`);
            else expect(env).not.toContain('LLM_BASE_URL');
        });

        it('enterprise injects the vault path', () => {
            const dir = gen({ architecture: 'enterprise', deployMode: 'repl', vaultPath: '/my/vault' });
            expect(read(path.join(dir, '.env'))).toMatch(/^VAULT_PATH=\/my\/vault$/m);
        });
    });

    describe('deploy modes (layered architectures)', () => {
        const pkg = (deployMode: DeployMode) => readJson(path.join(gen({ architecture: 'single', deployMode }), 'package.json'));

        it('mcp-http / mcp-stdio / hybrid depend on mcp-server at the current range', () => {
            for (const mode of ['mcp-http', 'mcp-stdio', 'hybrid'] as DeployMode[]) {
                fs.rmSync(path.join(root, 'my-agent'), { recursive: true, force: true });
                expect(pkg(mode).dependencies['@backendkit-labs/mcp-server']).toBe(GENERATED_DEP_RANGES['@backendkit-labs/mcp-server']);
            }
        });

        it('library drops dev/start/server scripts; repl drops server', () => {
            const lib = pkg('library');
            for (const s of ['dev', 'start', 'server']) expect(lib.scripts?.[s]).toBeUndefined();
            fs.rmSync(path.join(root, 'my-agent'), { recursive: true, force: true });
            expect(pkg('repl').scripts?.server).toBeUndefined();
        });
    });

    it('skill packs append a marked comment block to engine.ts', () => {
        const dir = gen({ architecture: 'single', deployMode: 'repl', skillPacks: ['node', 'docker'] });
        const engine = path.join(dir, 'src', 'engine.ts');
        expect(fs.existsSync(engine)).toBe(true);
        const text = read(engine);
        expect(text).toContain('Skill pack: node');
        expect(text).toContain('Skill pack: docker');
    });

    describe('orchestrator', () => {
        it('fills provider placeholders in orchestrator.yaml and names the package', () => {
            const dir = gen({ architecture: 'orchestrator', provider: 'deepseek', workflowTemplate: 'blank' });
            const yaml = read(path.join(dir, 'orchestrator.yaml'));
            expect(yaml).not.toContain('__PROVIDER_ID__');
            expect(yaml).not.toContain('__PROVIDERS_BLOCK__');
            expect(yaml).toContain('api_key: ${DEEPSEEK_API_KEY}');
            expect(yaml).toContain('base_url: https://api.deepseek.com/v1');
            expect(readJson(path.join(dir, 'package.json')).name).toBe('my-agent');
            expect(read(path.join(dir, '.env'))).toContain('DEEPSEEK_API_KEY=');
        });

        it('ollama needs no API key', () => {
            const dir = gen({ architecture: 'orchestrator', provider: 'ollama', workflowTemplate: 'blank' });
            expect(read(path.join(dir, 'orchestrator.yaml'))).not.toContain('api_key');
            expect(read(path.join(dir, '.env'))).toContain('OLLAMA_BASE_URL=http://localhost:11434');
        });
    });
});

describe('validateProjectName', () => {
    it.each(['my-agent', 'agent_1', 'a.b', 'x'])('accepts %p', (n) => {
        expect(validateProjectName(n)).toBe(true);
    });
    it.each([
        [''], [' '], ['My Agent'], ['UPPER'], ['../escape'], ['a/b'], ['a\\b'], ['.hidden'], ['-lead'],
        ['node_modules'], ['x'.repeat(215)], ['trailing '],
    ])('rejects %p', (n) => {
        expect(validateProjectName(n)).not.toBe(true);
    });
});

/** Caret range check, npm semantics: in 0.x ^0.a.b only covers 0.a.*. */
function caretSatisfied(range: string, version: string): boolean {
    const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
    const v = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (!m || !v) return false;
    const [rM, rm, rp] = m.slice(1).map(Number);
    const [vM, vm, vp] = v.slice(1).map(Number);
    if (vM !== rM) return false;
    if (rM === 0) return vm === rm && vp >= rp;
    return vm > rm || (vm === rm && vp >= rp);
}

describe('generated projects depend on the framework versions in this repo', () => {
    const workspace: Record<string, string> = {};
    for (const d of fs.readdirSync(PACKAGES)) {
        const f = path.join(PACKAGES, d, 'package.json');
        if (fs.existsSync(f)) { const p = readJson(f); if (p.name) workspace[p.name] = p.version; }
    }

    const templatePackageJsons: string[] = [];
    (function walk(d: string) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.name === 'node_modules') continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p); else if (e.name === 'package.json') templatePackageJsons.push(p);
        }
    })(TEMPLATES);

    it('finds the templates', () => { expect(templatePackageJsons.length).toBeGreaterThan(5); });

    it.each(templatePackageJsons.map(f => [path.relative(TEMPLATES, f), f]))('%s ranges include the workspace version', (_rel, file) => {
        const pkg = readJson(file as string);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies } as Record<string, string>;
        const stale = Object.entries(deps)
            .filter(([name]) => name.startsWith('@backendkit-labs/') && workspace[name])
            .filter(([name, range]) => !caretSatisfied(range, workspace[name]))
            .map(([name, range]) => `${name}@${range} (workspace ${workspace[name]})`);
        expect(stale).toEqual([]);
    });

    it('ranges injected by scaffold.ts include the workspace version', () => {
        for (const [name, range] of Object.entries(GENERATED_DEP_RANGES)) {
            expect(caretSatisfied(range, workspace[name])).toBe(true);
        }
    });
});
