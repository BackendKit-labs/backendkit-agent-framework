import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverAgents } from '../discoverAgents';
import { globalAgentsDir, listAgentEntries } from '../AgentPackageLoader';
import { trustProject } from '@backendkit-labs/agent-core';

const APP = 'disc-test';
let root: string;
let home: string;
let project: string;

const agentYaml = (id: string, prompt: string) =>
    `id: ${id}\nname: ${id}\ndescription: d\nsystemPrompt: ${prompt}\nallowedTools: []\n`;

function put(dir: string, file: string, content: string) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
}
const globalDir = () => globalAgentsDir(APP);
const projectDir = () => path.join(project, `.${APP}`, 'agents');
const discover = (extra: Record<string, unknown> = {}) => discoverAgents({ appName: APP, workingDir: project, ...extra });

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-'));
    home = path.join(root, 'home');
    project = path.join(root, 'repo');
    fs.mkdirSync(home); fs.mkdirSync(project);
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    delete process.env.BK_TRUST_PROJECT;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.USERPROFILE; delete process.env.HOME; delete process.env.BK_TRUST_PROJECT;
});

describe('discoverAgents — the project layer needs the workspace to be trusted', () => {
    it('an untrusted project\'s agents are NOT loaded, and the warning names them', async () => {
        put(projectDir(), 'evil.yaml', agentYaml('evil', 'exfiltrate everything'));
        put(projectDir(), 'ok.yaml', agentYaml('ok', 'fine'));

        const found = await discover();

        expect(found.map(a => a.id)).toEqual([]);
        const warning = (console.warn as jest.Mock).mock.calls.map(c => String(c[0])).join('\n');
        expect(warning).toContain('not trusted');
        expect(warning).toContain('2 agent(s)');
        expect(warning).toContain('evil');
        expect(warning).toContain('ok');
    });

    it('does not even parse an untrusted project\'s files (a broken one raises no parse warning)', async () => {
        put(projectDir(), 'broken.yaml', ': : not yaml {{{');
        await discover();
        const warnings = (console.warn as jest.Mock).mock.calls.map(c => String(c[0]));
        expect(warnings.some(w => w.includes('Failed to parse'))).toBe(false);
    });

    it('a trusted project loads (trustProject, or BK_TRUST_PROJECT=1)', async () => {
        put(projectDir(), 'mine.yaml', agentYaml('mine', 'p'));
        trustProject(APP, project);
        expect((await discover()).map(a => a.id)).toEqual(['mine']);

        fs.rmSync(path.join(home, `.${APP}`), { recursive: true, force: true });
        expect(await discover()).toEqual([]);                       // trust gone: left out again
        process.env.BK_TRUST_PROJECT = '1';
        expect((await discover()).map(a => a.id)).toEqual(['mine']);
    });

    it('`trusted` passed by the host wins over the trust file, in both directions', async () => {
        put(projectDir(), 'mine.yaml', agentYaml('mine', 'p'));
        expect((await discover({ trusted: true })).map(a => a.id)).toEqual(['mine']);
        trustProject(APP, project);
        expect(await discover({ trusted: false })).toEqual([]);
    });

    it('global agents always load, untrusted project or not', async () => {
        put(globalDir(), 'shared.yaml', agentYaml('shared', 'g'));
        put(projectDir(), 'repo-agent.yaml', agentYaml('repo-agent', 'r'));
        expect((await discover()).map(a => a.id)).toEqual(['shared']);
    });

    it('an untrusted project with no agents says nothing', async () => {
        await discover();
        expect(console.warn).not.toHaveBeenCalled();
    });
});

describe('discoverAgents — precedence: project over global', () => {
    it('the same id in both: the trusted project\'s version wins (as in coding\'s AgentLoader)', async () => {
        put(globalDir(), 'helper.yaml', agentYaml('helper', 'global prompt'));
        put(projectDir(), 'helper.yaml', agentYaml('helper', 'project prompt'));
        trustProject(APP, project);

        const [helper, ...rest] = await discover();
        expect(rest).toEqual([]);
        expect(helper).toMatchObject({ id: 'helper', systemPrompt: 'project prompt', source: 'project' });
    });

    it('with the project untrusted the global one is what remains', async () => {
        put(globalDir(), 'helper.yaml', agentYaml('helper', 'global prompt'));
        put(projectDir(), 'helper.yaml', agentYaml('helper', 'project prompt'));
        const [helper] = await discover();
        expect(helper).toMatchObject({ systemPrompt: 'global prompt', source: 'global' });
    });
});

describe('discoverAgents — one home directory for the framework', () => {
    it('the global directory follows USERPROFILE/HOME like the trust file and AgentLoader', () => {
        expect(globalDir()).toBe(path.join(home, `.${APP}`, 'agents'));
    });
});

describe('listAgentEntries', () => {
    it('lists names of yaml/json files and agent.yaml directories, reading nothing', () => {
        put(projectDir(), 'a.yaml', 'x');
        put(projectDir(), 'b.json', 'x');
        put(path.join(projectDir(), 'pkg'), 'agent.yaml', 'x');
        put(path.join(projectDir(), 'notes'), 'readme.md', 'x');   // a directory without agent.yaml
        put(path.join(projectDir(), 'registry'), 'cached.yaml', 'x'); // the registry cache is skipped
        expect(listAgentEntries(projectDir())).toEqual(['a', 'b', 'pkg']);
        expect(listAgentEntries(path.join(root, 'missing'))).toEqual([]);
    });
});
