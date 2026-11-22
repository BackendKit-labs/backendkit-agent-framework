import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getFrameworkDir } from '@backendkit-labs/agent-core';
import { AgentLoader } from '../AgentLoader';

describe('AgentLoader — files from disk are validated', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'loader-')); });
    afterEach(() => {
        rmSync(cwd, { recursive: true, force: true });
        rmSync(getFrameworkDir('al-test'), { recursive: true, force: true }); // load() creates the global directory
    });

    const write = (name: string, content: string) => {
        const dir = join(cwd, '.al-test', 'agents');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, name), content);
    };

    it('loads a well-formed agent and skips malformed ones instead of registering them', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            write('good.json', JSON.stringify({ id: 'good', name: 'Good', icon: 'g', description: 'd', systemPrompt: 'p', allowedTools: ['read_file'] }));
            write('no-tools.json', JSON.stringify({ id: 'x', name: 'X', icon: 'x', description: 'd', systemPrompt: 'p' }));
            write('bad-tools.json', JSON.stringify({ id: 'y', name: 'Y', icon: 'y', description: 'd', systemPrompt: 'p', allowedTools: [1, 2] }));
            write('null.json', 'null');
            write('no-id.json', JSON.stringify({ name: 'Z', systemPrompt: 'p', allowedTools: [] }));
            const agents = AgentLoader.load({ appName: 'al-test', cwd, trusted: true, builtins: [] });
            expect(agents.map(a => a.id)).toEqual(['good']);
        } finally { warn.mockRestore(); }
    });

    it('scaffold refuses an id that would leave the agents directory', () => {
        expect(() => AgentLoader.scaffold('../../escaped', { appName: 'al-test', cwd })).toThrow(/Unsafe agent id/);
        expect(existsSync(join(cwd, 'escaped.json'))).toBe(false);
    });
});
