import { defineTool, z } from '../../tools/defineTool';
import { parseToolServerArgs, runToolServer, toolServerUsage } from '../tool-server-cli';

describe('parseToolServerArgs', () => {
    it('defaults to stdio with nothing set', () => {
        expect(parseToolServerArgs([])).toEqual({ mode: 'stdio', help: false, unknown: [] });
    });

    it('reads the http flags', () => {
        expect(parseToolServerArgs(['--http', '--port', '3100', '--host', '0.0.0.0', '--token', 't'])).toEqual({
            mode: 'http', port: 3100, host: '0.0.0.0', token: 't', help: false, unknown: [],
        });
    });

    it('takes the token from the environment when the flag is absent, flag wins otherwise', () => {
        expect(parseToolServerArgs(['--http'], { BK_MCP_TOKEN: 'env' }).token).toBe('env');
        expect(parseToolServerArgs(['--http', '--token', 'flag'], { BK_MCP_TOKEN: 'env' }).token).toBe('flag');
        expect(parseToolServerArgs(['--http'], { MY_TOKEN: 'mine' }, 'MY_TOKEN').token).toBe('mine');
    });

    it('rejects a bad port and a flag without value', () => {
        expect(() => parseToolServerArgs(['--port', 'abc'])).toThrow(/--port expects/);
        expect(() => parseToolServerArgs(['--port', '70000'])).toThrow(/--port expects/);
        expect(() => parseToolServerArgs(['--host'])).toThrow(/--host expects/);
    });

    it('collects unknown flags and recognises --help', () => {
        expect(parseToolServerArgs(['--verbose', '-h']).unknown).toEqual(['--verbose']);
        expect(parseToolServerArgs(['--help']).help).toBe(true);
    });
});

describe('toolServerUsage', () => {
    it('names the binary, the token variable and the default port', () => {
        const text = toolServerUsage('p2p-mcp', 'BK_P2P_TOKEN', 3100);
        expect(text).toContain('p2p-mcp');
        expect(text).toContain('BK_P2P_TOKEN');
        expect(text).toContain('3100');
    });
});

describe('runToolServer', () => {
    const tools = [defineTool({ name: 'ping', description: '', readOnly: true, input: z.object({}), execute: async () => 'pong' })];

    it('prints usage and does not start anything on --help', async () => {
        const lines: string[] = [];
        const running = await runToolServer({ name: 't', tools }, { argv: ['--help'], log: l => { lines.push(l); }, bin: 'my-mcp' });
        expect(running.mode).toBe('help');
        expect(lines.join('\n')).toContain('my-mcp');
        await running.close();
    });

    it('refuses unknown options', async () => {
        await expect(runToolServer({ name: 't', tools }, { argv: ['--nope'], log: () => undefined })).rejects.toThrow(/Unknown option\(s\): --nope/);
    });

    it('warns that --token is visible to other users, and not when the token comes from the variable', async () => {
        const fromFlag: string[] = [];
        const a = await runToolServer({ name: 't', tools }, { argv: ['--http', '--port', '0', '--token', 'tok'], log: l => { fromFlag.push(l); } });
        await a.close();
        expect(fromFlag.some(l => /--token puts the token where other users/.test(l))).toBe(true);

        const fromEnv: string[] = [];
        const b = await runToolServer({ name: 't', tools }, { argv: ['--http', '--port', '0'], env: { BK_MCP_TOKEN: 'tok' }, log: l => { fromEnv.push(l); } });
        await b.close();
        expect(fromEnv.some(l => /--token puts/.test(l))).toBe(false);
    });

    it('starts HTTP with the flags and the token from the configured env variable', async () => {
        const lines: string[] = [];
        const running = await runToolServer(
            { name: 't', tools },
            { argv: ['--http', '--port', '0'], env: { P2P_TOKEN: 'tok' }, tokenEnv: 'P2P_TOKEN', log: l => { lines.push(l); } },
        );
        try {
            expect(running.mode).toBe('http');
            expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
            expect((await fetch(running.url!, { method: 'POST' })).status).toBe(401);
            expect(lines.some(l => l.includes('listening'))).toBe(true);
        } finally {
            await running.close();
        }
    });
});
