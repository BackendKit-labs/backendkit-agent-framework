import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as core from '@backendkit-labs/agent-core';
import type { AgentProfile } from '@backendkit-labs/agent-core';

/**
 * ADR-0006: the project layer ({cwd}/.{appName}/agents) is the repository's own content, so it loads only for a
 * project the user trusted. createBaseEngine is mocked to read back which agents the engine would get.
 */
jest.mock('@backendkit-labs/agent-core', () => ({
    ...jest.requireActual('@backendkit-labs/agent-core'),
    createBaseEngine: jest.fn(() => ({})),
}));
// The first-run seed would write to the real home directory.
jest.mock('../cli/bootstrap/GlobalSeed', () => ({ runGlobalSeed: jest.fn(async () => undefined) }));

import { createCodingEngine } from '../index';
import { AgentLoader } from '../agents/AgentLoader';
import { trustProject } from '../cli/trust/workspace-trust';

const APP = 'trust-test';
let home: string;
let cwd: string;

const builtin: AgentProfile = {
    id: 'general', name: 'General', icon: 'g', description: 'builtin', systemPrompt: 'BUILTIN PROMPT', allowedTools: ['read_file'],
};

const projectAgentsDir = () => path.join(cwd, `.${APP}`, 'agents');
const globalAgentsDir = () => path.join(home, `.${APP}`, 'agents');
const writeAgent = (dir: string, id: string, prompt: string, extra: Record<string, unknown> = {}) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
        id, name: id, icon: 'x', description: id, systemPrompt: prompt, allowedTools: ['run_command'], delegatesTo: ['*'], ...extra,
    }));
};

beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-trust-'));
    home = path.join(root, 'home');
    cwd = path.join(root, 'repo');
    fs.mkdirSync(home);
    fs.mkdirSync(cwd);
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    delete process.env.BK_TRUST_PROJECT;
});

afterEach(() => {
    fs.rmSync(path.dirname(home), { recursive: true, force: true });
    delete process.env.USERPROFILE;
    delete process.env.HOME;
    delete process.env.BK_TRUST_PROJECT;
});

const promptOf = (agents: AgentProfile[], id: string) => agents.find(a => a.id === id)?.systemPrompt;

describe('AgentLoader and the project layer', () => {
    it('does not load a repository\'s agent that replaces a built-in, and keeps the built-in', () => {
        writeAgent(projectAgentsDir(), 'general', 'EVIL PROMPT');
        writeAgent(projectAgentsDir(), 'extra', 'EVIL EXTRA');
        const agents = AgentLoader.load({ appName: APP, cwd, builtins: [builtin] });
        expect(promptOf(agents, 'general')).toBe('BUILTIN PROMPT');
        expect(agents.some(a => a.id === 'extra')).toBe(false);
        expect(agents.find(a => a.id === 'general')?.source).toBe('builtin');
    });

    it('does not apply a repository\'s .md override of a built-in prompt either', () => {
        fs.mkdirSync(projectAgentsDir(), { recursive: true });
        fs.writeFileSync(path.join(projectAgentsDir(), 'general.md'), 'REWRITTEN BY THE REPO');
        expect(promptOf(AgentLoader.load({ appName: APP, cwd, builtins: [builtin] }), 'general')).toBe('BUILTIN PROMPT');
    });

    it('creates nothing inside a project that is not trusted', () => {
        AgentLoader.load({ appName: APP, cwd, builtins: [builtin] });
        expect(fs.existsSync(path.join(cwd, `.${APP}`))).toBe(false);
    });

    it('still loads the user\'s own global agents', () => {
        writeAgent(globalAgentsDir(), 'mine', 'MY OWN PROMPT');
        const agents = AgentLoader.load({ appName: APP, cwd, builtins: [builtin] });
        expect(promptOf(agents, 'mine')).toBe('MY OWN PROMPT');
        expect(agents.find(a => a.id === 'mine')?.source).toBe('global');
    });

    it('loads the project layer once the project is trusted, with precedence and .md overrides intact', () => {
        writeAgent(globalAgentsDir(), 'shared', 'GLOBAL');
        writeAgent(projectAgentsDir(), 'shared', 'PROJECT');
        fs.writeFileSync(path.join(projectAgentsDir(), 'general.md'), 'CUSTOMISED BY A TRUSTED PROJECT');
        trustProject(APP, cwd);
        const agents = AgentLoader.load({ appName: APP, cwd, builtins: [builtin] });
        expect(promptOf(agents, 'shared')).toBe('PROJECT');
        expect(promptOf(agents, 'general')).toBe('CUSTOMISED BY A TRUSTED PROJECT');
        expect(agents.find(a => a.id === 'shared')?.source).toBe('project');
    });

    it('BK_TRUST_PROJECT=1 trusts it', () => {
        writeAgent(projectAgentsDir(), 'extra', 'FROM REPO');
        process.env.BK_TRUST_PROJECT = '1';
        expect(promptOf(AgentLoader.load({ appName: APP, cwd, builtins: [builtin] }), 'extra')).toBe('FROM REPO');
    });

    it('a host that already decided can pass its answer, in either direction', () => {
        writeAgent(projectAgentsDir(), 'extra', 'FROM REPO');
        expect(promptOf(AgentLoader.load({ appName: APP, cwd, builtins: [builtin], trusted: true }), 'extra')).toBe('FROM REPO');
        trustProject(APP, cwd);
        expect(AgentLoader.load({ appName: APP, cwd, builtins: [builtin], trusted: false }).some(a => a.id === 'extra')).toBe(false);
    });
});

describe('createCodingEngine and the project layer', () => {
    const create = (extra: Record<string, unknown> = {}) => {
        const emitted: Array<{ type: string; level?: string; text?: string }> = [];
        createCodingEngine({
            providers: { ollama: {} } as never,
            defaultProvider: 'ollama',
            disablePersistence: true,
            workingDir: cwd,
            appName: APP,
            transport: { emit: (e: never) => emitted.push(e) } as never,
            ...extra,
        });
        const call = (core.createBaseEngine as jest.Mock).mock.calls.at(-1)![0];
        const agents = (call.agents instanceof Array ? call.agents : call.agents.getAll?.() ?? []) as AgentProfile[];
        return { emitted, agents };
    };

    it('leaves the repository\'s agent out of an untrusted project and tells the user what and how to trust', () => {
        writeAgent(projectAgentsDir(), 'general', 'EVIL PROMPT');
        const { emitted, agents } = create();
        expect(agents.find(a => a.id === 'general')?.systemPrompt).not.toBe('EVIL PROMPT');
        const warning = emitted.find(e => e.type === 'system' && e.level === 'warn' && e.text?.includes('[Trust]'));
        expect(warning?.text).toContain('general');
        expect(warning?.text).toContain('/trust add');
    });

    it('says nothing when the project holds nothing to leave out', () => {
        expect(create().emitted.filter(e => e.text?.includes('[Trust]'))).toEqual([]);
    });

    it('loads it and does not warn once the project is trusted', () => {
        writeAgent(projectAgentsDir(), 'general', 'FROM TRUSTED REPO');
        trustProject(APP, cwd);
        const { emitted, agents } = create();
        expect(agents.find(a => a.id === 'general')?.systemPrompt).toBe('FROM TRUSTED REPO');
        expect(emitted.filter(e => e.text?.includes('[Trust]'))).toEqual([]);
    });

    it('trustedProject overrides the disk in both directions', () => {
        writeAgent(projectAgentsDir(), 'general', 'FROM REPO');
        expect(create({ trustedProject: true }).agents.find(a => a.id === 'general')?.systemPrompt).toBe('FROM REPO');
        trustProject(APP, cwd);
        const denied = create({ trustedProject: false });
        expect(denied.agents.find(a => a.id === 'general')?.systemPrompt).not.toBe('FROM REPO');
        expect(denied.emitted.some(e => e.text?.includes('[Trust]'))).toBe(true);
    });
});
