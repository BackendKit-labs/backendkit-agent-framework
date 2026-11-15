import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    canonicalProjectPath, isProjectTrusted, listTrustedProjects, projectLayerContents, trustFilePath, trustProject,
    untrustedLayerWarning, untrustProject,
} from '../workspace-trust';
import { SlashCommandRegistry } from '@backendkit-labs/agent-core';
import { registerBuiltinCommands } from '../../commands/builtin';

const APP = 'trust-test';
let home: string;
let root: string;
let project: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-trust-'));
    home = path.join(root, 'home');
    project = path.join(root, 'repo');
    fs.mkdirSync(home);
    fs.mkdirSync(project);
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    delete process.env.BK_TRUST_PROJECT;
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.USERPROFILE;
    delete process.env.HOME;
    delete process.env.BK_TRUST_PROJECT;
});

describe('isProjectTrusted', () => {
    it('trusts nobody by default', () => {
        expect(isProjectTrusted(APP, project)).toMatchObject({ trusted: false, reason: 'untrusted' });
    });

    it('reading never writes: asking leaves no trust file behind', () => {
        isProjectTrusted(APP, project);
        expect(fs.existsSync(trustFilePath(APP))).toBe(false);
    });

    it('trusts a project the user trusted, and says why', () => {
        trustProject(APP, project);
        expect(isProjectTrusted(APP, project)).toMatchObject({ trusted: true, reason: 'listed' });
    });

    it('matches the exact project only: not its children, not its parent', () => {
        const child = path.join(project, 'packages', 'app');
        fs.mkdirSync(child, { recursive: true });
        trustProject(APP, project);
        expect(isProjectTrusted(APP, project).trusted).toBe(true);
        expect(isProjectTrusted(APP, child).trusted).toBe(false); // a subdirectory of a trusted project
        expect(isProjectTrusted(APP, root).trusted).toBe(false);  // the directory above it
    });

    it('trusting a parent directory does not trust a repository cloned inside it', () => {
        const clone = path.join(root, 'code', 'some-clone');
        fs.mkdirSync(clone, { recursive: true });
        trustProject(APP, path.join(root, 'code'));
        expect(isProjectTrusted(APP, clone).trusted).toBe(false);
    });

    it('is not fooled by how the path is written', () => {
        trustProject(APP, project);
        expect(isProjectTrusted(APP, path.join(project, 'sub', '..')).trusted).toBe(true);
        expect(isProjectTrusted(APP, project + path.sep).trusted).toBe(true);
        expect(isProjectTrusted(APP, path.relative(process.cwd(), project)).trusted).toBe(true);
    });

    it('follows a link to the real directory', () => {
        const link = path.join(root, 'link');
        try {
            fs.symlinkSync(project, link, 'junction');
        } catch {
            return; // the platform will not create links for this user: nothing to verify
        }
        trustProject(APP, project);
        expect(isProjectTrusted(APP, link).trusted).toBe(true);
        expect(canonicalProjectPath(link)).toBe(canonicalProjectPath(project));
    });

    (process.platform === 'win32' ? it : it.skip)('ignores letter case on Windows', () => {
        trustProject(APP, project);
        expect(isProjectTrusted(APP, project.toUpperCase()).trusted).toBe(true);
    });

    it('BK_TRUST_PROJECT=1 trusts any path, and only the value "1" does', () => {
        process.env.BK_TRUST_PROJECT = '1';
        expect(isProjectTrusted(APP, project)).toMatchObject({ trusted: true, reason: 'env' });
        for (const value of ['true', '0', '', 'yes']) {
            process.env.BK_TRUST_PROJECT = value;
            expect(isProjectTrusted(APP, project).trusted).toBe(false);
        }
    });

    it('takes the environment as an argument, so a host does not depend on process.env', () => {
        expect(isProjectTrusted(APP, project, { BK_TRUST_PROJECT: '1' }).trusted).toBe(true);
        expect(isProjectTrusted(APP, project, {}).trusted).toBe(false);
    });
});

describe('a damaged trust file means nobody is trusted, never everybody', () => {
    const write = (content: string) => {
        fs.mkdirSync(path.dirname(trustFilePath(APP)), { recursive: true });
        fs.writeFileSync(trustFilePath(APP), content);
    };

    it.each([
        ['not JSON', '{ broken'],
        ['empty', ''],
        ['null', 'null'],
        ['wrong shape', '{"projects":"everything"}'],
        ['a wildcard string', '{"projects":["*"]}'],
        ['numbers', '{"projects":[1,2]}'],
    ])('%s', (_name, content) => {
        write(content);
        expect(isProjectTrusted(APP, project).trusted).toBe(false);
    });

    it('can be repaired by trusting again', () => {
        write('{ broken');
        trustProject(APP, project);
        expect(isProjectTrusted(APP, project).trusted).toBe(true);
    });
});

describe('trustProject / untrustProject', () => {
    it('is idempotent and records the canonical path once', () => {
        const first = trustProject(APP, project);
        trustProject(APP, project + path.sep);
        expect(listTrustedProjects(APP)).toEqual([first]);
        expect(JSON.parse(fs.readFileSync(trustFilePath(APP), 'utf-8'))).toEqual({ version: 1, projects: [first] });
    });

    it('keeps the other projects when one is removed, and says whether it was trusted', () => {
        const other = path.join(root, 'other');
        fs.mkdirSync(other);
        trustProject(APP, project);
        trustProject(APP, other);
        expect(untrustProject(APP, project)).toBe(true);
        expect(isProjectTrusted(APP, project).trusted).toBe(false);
        expect(isProjectTrusted(APP, other).trusted).toBe(true);
        expect(untrustProject(APP, project)).toBe(false);
    });

    it('leaves no temporary file next to the trust file', () => {
        trustProject(APP, project);
        expect(fs.readdirSync(path.dirname(trustFilePath(APP)))).toEqual([path.basename(trustFilePath(APP))]);
    });

    it('is kept per app: trusting for one app does not trust for another', () => {
        trustProject(APP, project);
        expect(isProjectTrusted('another-app', project).trusted).toBe(false);
    });
});

describe('what is left out, and the warning that says so', () => {
    const put = (rel: string) => {
        const file = path.join(project, `.${APP}`, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'x');
    };

    it('lists agent and skill names without reading their content', () => {
        put('agents/general.json');
        put('agents/general.md');
        put('agents/reviewer.json');
        put('skills/deploy.yaml');
        put('skills/lint.md');
        put('agents/notes.txt');
        expect(projectLayerContents(APP, project)).toMatchObject({ agents: ['general', 'reviewer'], skills: ['deploy', 'lint'] });
    });

    it('warns with the names, the folder and how to trust', () => {
        put('agents/general.json');
        put('skills/deploy.yaml');
        const text = untrustedLayerWarning(APP, project)!;
        expect(text).toContain('general');
        expect(text).toContain('deploy');
        expect(text).toContain(`.${APP}`);
        expect(text).toContain('/trust add');
        expect(text).toContain('BK_TRUST_PROJECT=1');
    });

    it('says nothing when there is nothing to leave out', () => {
        expect(untrustedLayerWarning(APP, project)).toBeUndefined();
        fs.mkdirSync(path.join(project, `.${APP}`, 'agents'), { recursive: true });
        expect(untrustedLayerWarning(APP, project)).toBeUndefined();
    });
});

describe('/trust command', () => {
    const run = async (input: string, extra: Record<string, unknown> = {}) => {
        const registry = new SlashCommandRegistry();
        registerBuiltinCommands(registry);
        const out: string[] = [];
        let reloaded = 0;
        await registry.dispatch(input, {
            emit: t => out.push(t), appName: APP, workingDir: project, reloadSkills: async () => { reloaded++; }, ...extra,
        });
        return { text: out.join('\n'), reloaded };
    };

    it('status says the project is not trusted and what it holds', async () => {
        fs.mkdirSync(path.join(project, `.${APP}`, 'agents'), { recursive: true });
        fs.writeFileSync(path.join(project, `.${APP}`, 'agents', 'general.json'), '{}');
        const { text } = await run('/trust');
        expect(text).toContain('Trusted : no');
        expect(text).toContain('general');
        expect(text).toContain('/trust add');
    });

    it('add trusts the project, reloads skills and tells that agents need a restart', async () => {
        const { text, reloaded } = await run('/trust add');
        expect(isProjectTrusted(APP, project).trusted).toBe(true);
        expect(reloaded).toBe(1);
        expect(text).toMatch(/restart/i);
        expect((await run('/trust status')).text).toContain('Trusted : yes (listed)');
    });

    it('remove stops trusting it, and says so when it was not trusted', async () => {
        await run('/trust add');
        expect((await run('/trust remove')).text).toContain('No longer trusted');
        expect(isProjectTrusted(APP, project).trusted).toBe(false);
        expect((await run('/trust remove')).text).toContain('was not trusted');
    });

    it('list shows the trusted projects', async () => {
        expect((await run('/trust list')).text).toBe('No project is trusted.');
        await run('/trust add');
        expect((await run('/trust list')).text).toContain(canonicalProjectPath(project));
    });

    it('shows the env override in status', async () => {
        process.env.BK_TRUST_PROJECT = '1';
        expect((await run('/trust')).text).toContain('BK_TRUST_PROJECT=1');
    });

    it('refuses an unknown subcommand and does not change anything', async () => {
        expect((await run('/trust everything')).text).toContain('Usage');
        expect(listTrustedProjects(APP)).toEqual([]);
    });

    it('asks the host for appName and workingDir instead of guessing', async () => {
        expect((await run('/trust add', { workingDir: undefined })).text).toContain('needs the host');
        expect(listTrustedProjects(APP)).toEqual([]);
    });
});
