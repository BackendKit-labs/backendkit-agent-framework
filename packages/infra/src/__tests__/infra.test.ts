import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { bkPaths, getBkHome, initBkHome, isBkHomeInitialized } from '../index.js';

const savedHome = process.env.BK_HOME;
let tmp: string;
beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-infra-')); });
afterEach(async () => {
    if (savedHome === undefined) delete process.env.BK_HOME; else process.env.BK_HOME = savedHome;
    await fs.rm(tmp, { recursive: true, force: true });
});

describe('getBkHome', () => {
    it('uses BK_HOME when set', () => {
        process.env.BK_HOME = tmp;
        expect(getBkHome()).toBe(tmp);
    });

    it('defaults to ~/.backendkit', () => {
        delete process.env.BK_HOME;
        expect(getBkHome()).toBe(path.join(os.homedir(), '.backendkit'));
    });

    it.each(['', '   '])('treats an empty or blank BK_HOME (%p) as unset instead of using the cwd', (v) => {
        process.env.BK_HOME = v;
        expect(getBkHome()).toBe(path.join(os.homedir(), '.backendkit'));
    });

    it('resolves a relative BK_HOME to an absolute path', () => {
        process.env.BK_HOME = 'rel/home';
        expect(path.isAbsolute(getBkHome())).toBe(true);
        expect(getBkHome()).toBe(path.resolve('rel/home'));
    });
});

describe('bkPaths', () => {
    beforeEach(() => { process.env.BK_HOME = tmp; });

    it('every fixed path lives under BK_HOME', () => {
        const fixed = [
            bkPaths.home(), bkPaths.vaultsDir(), bkPaths.sharedVault(), bkPaths.ragDir(), bkPaths.directorMemory(),
            bkPaths.directorGoals(), bkPaths.directorUserModel(), bkPaths.memoryDir(), bkPaths.memoryEpisodic(),
            bkPaths.memorySemantic(), bkPaths.memoryProcedural(), bkPaths.skillsDir(), bkPaths.configDir(),
            bkPaths.orchestratorMcpConfig(),
        ];
        for (const p of fixed) expect(path.relative(tmp, p).startsWith('..')).toBe(false);
    });

    it('builds the documented layout', () => {
        expect(bkPaths.vault('proj')).toBe(path.join(tmp, 'vaults', 'proj'));
        expect(bkPaths.ragIndex('proj')).toBe(path.join(tmp, 'rag', 'proj.json'));
        expect(bkPaths.data('orchestrator')).toBe(path.join(tmp, 'data', 'orchestrator'));
        expect(bkPaths.memoryEpisodic()).toBe(path.join(tmp, 'memory', 'episodic.json'));
    });

    it('follows BK_HOME changes at call time (no cached root)', () => {
        const other = path.join(tmp, 'other');
        process.env.BK_HOME = other;
        expect(bkPaths.home()).toBe(other);
    });

    it.each([
        ['vault', (n: string) => bkPaths.vault(n)],
        ['ragIndex', (n: string) => bkPaths.ragIndex(n)],
        ['data', (n: string) => bkPaths.data(n)],
    ])('%s rejects names that would escape BK_HOME', (_l, fn) => {
        for (const bad of ['..', '../../etc', 'a/b', 'a\\b', '', '.']) {
            expect(() => fn(bad)).toThrow(/Invalid name/);
        }
    });

    it('accepts ordinary project names (dots, spaces, unicode)', () => {
        expect(() => bkPaths.vault('my.project v2')).not.toThrow();
        expect(() => bkPaths.vault('proyecto-ñandú')).not.toThrow();
    });
});

describe('initBkHome', () => {
    beforeEach(() => { process.env.BK_HOME = path.join(tmp, 'home'); });

    it('creates the directory tree and seed files, returning the home path', async () => {
        const home = await initBkHome();
        expect(home).toBe(path.join(tmp, 'home'));
        for (const d of ['vaults/shared', 'rag', 'data/orchestrator', 'data/orchestrator-mcp', 'data/vault-manager', 'director', 'memory', 'skills', 'config']) {
            expect((await fs.stat(path.join(home, d))).isDirectory()).toBe(true);
        }
        expect(JSON.parse(await fs.readFile(bkPaths.directorGoals(), 'utf-8'))).toEqual([]);
        expect(JSON.parse(await fs.readFile(bkPaths.memoryProcedural(), 'utf-8'))).toEqual({ patterns: [], learnedFlows: [] });
        expect(await fs.readFile(bkPaths.orchestratorMcpConfig(), 'utf-8')).toContain('agents: []');
        expect(await fs.readFile(path.join(home, 'README.md'), 'utf-8')).toContain('BackendKit Platform');
    });

    it('is idempotent and never overwrites a file the user already changed', async () => {
        await initBkHome();
        await fs.writeFile(bkPaths.directorGoals(), '["keep me"]');
        await initBkHome();
        expect(JSON.parse(await fs.readFile(bkPaths.directorGoals(), 'utf-8'))).toEqual(['keep me']);
    });

    it('concurrent initialisations do not fail or corrupt the seeds', async () => {
        await Promise.all(Array.from({ length: 8 }, () => initBkHome()));
        expect(JSON.parse(await fs.readFile(bkPaths.memorySemantic(), 'utf-8'))).toEqual({});
        expect(JSON.parse(await fs.readFile(bkPaths.memoryEpisodic(), 'utf-8'))).toEqual([]);
    });

    it('isBkHomeInitialized reflects whether the directory exists', async () => {
        expect(await isBkHomeInitialized()).toBe(false);
        await initBkHome();
        expect(await isBkHomeInitialized()).toBe(true);
    });
});
