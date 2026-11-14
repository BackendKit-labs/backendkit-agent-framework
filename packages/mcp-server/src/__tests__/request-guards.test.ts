import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { AgentMCPServer } from '../agent-server';
import { extraIndexRoots, isLoopbackRequest, resolveInside } from '../request-guards';

describe('isLoopbackRequest', () => {
    it.each([
        ['127.0.0.1:3001', undefined, true],
        ['localhost:3001', undefined, true],
        ['[::1]:3001', undefined, true],
        ['LOCALHOST', undefined, true],
        ['127.0.0.1:3001', 'http://localhost:5173', true],
        ['127.0.0.1:3001', 'http://127.0.0.1:3001', true],
        ['evil.example.com:3001', undefined, false], // DNS rebinding: the page's own host name resolves to 127.0.0.1
        ['127.0.0.1.evil.example.com', undefined, false],
        ['127.0.0.1:3001', 'https://evil.example.com', false], // cross-site POST from a web page
        ['127.0.0.1:3001', 'null', false],
        ['127.0.0.1:3001', 'not a url', false],
        [undefined, undefined, false],
        ['', undefined, false],
    ])('host %p origin %p -> %p', (host, origin, expected) => {
        expect(isLoopbackRequest(host, origin)).toBe(expected);
    });
});

describe('resolveInside', () => {
    let root: string;
    let outside: string;

    beforeEach(() => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'index-roots-'));
        root = path.join(base, 'project');
        outside = path.join(base, 'secrets');
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.mkdirSync(outside);
    });
    afterEach(() => { fs.rmSync(path.dirname(root), { recursive: true, force: true }); });

    // resolveInside uses fs.promises.realpath (native). On Windows the JS fs.realpathSync does not expand 8.3 short
    // names (C:\Users\NAME~1), so expectations must use the native variant to compare like with like.
    it('accepts the root itself and directories inside it, relative or absolute', async () => {
        const real = fs.realpathSync.native(root);
        expect(await resolveInside([root], '.')).toBe(real);
        expect(await resolveInside([root], 'src')).toBe(path.join(real, 'src'));
        expect(await resolveInside([root], path.join(root, 'src'))).toBe(path.join(real, 'src'));
    });

    it.each(['..', '../secrets', '../../etc'])('refuses %j', async requested => {
        await expect(resolveInside([root], requested)).rejects.toThrow(/Access denied/);
    });

    it('refuses an absolute path elsewhere', async () => {
        await expect(resolveInside([root], outside)).rejects.toThrow(/Access denied/);
    });

    it('refuses a sibling whose name starts like the root', async () => {
        const sibling = `${root}-evil`;
        fs.mkdirSync(sibling);
        await expect(resolveInside([root], sibling)).rejects.toThrow(/Access denied/);
    });

    it('refuses a link inside the root that points outside it', async () => {
        const link = path.join(root, 'link');
        try {
            fs.symlinkSync(outside, link, 'junction');
        } catch {
            return; // the platform will not create links for this user: nothing to verify
        }
        await expect(resolveInside([root], 'link')).rejects.toThrow(/Access denied/);
    });

    it('accepts an extra root and still refuses the rest', async () => {
        await expect(resolveInside([root], outside)).rejects.toThrow(/Access denied/);
        expect(await resolveInside([root, outside], outside)).toBe(fs.realpathSync.native(outside));
    });

    it('a directory that does not exist is an error, not an allow', async () => {
        await expect(resolveInside([root], 'missing')).rejects.toThrow();
    });
});

describe('extraIndexRoots', () => {
    it('splits on the platform path delimiter and drops blanks', () => {
        const d = path.delimiter;
        expect(extraIndexRoots({ BK_INDEX_ROOTS: `/a${d} /b ${d}${d}` })).toEqual(['/a', '/b']);
        expect(extraIndexRoots({})).toEqual([]);
    });
});

describe('AgentMCPServer HTTP on loopback', () => {
    const base = { name: 'test', tools: [], engineFactory: () => { throw new Error('unused'); } };

    function request(port: number, headers: Record<string, string>): Promise<number> {
        return new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, path: '/other', method: 'GET', headers }, res => {
                res.resume();
                resolve(res.statusCode ?? 0);
            });
            req.on('error', reject);
            req.end();
        });
    }

    it('refuses a foreign Host (DNS rebinding) and a foreign Origin with 403, before auth', async () => {
        const srv = new AgentMCPServer({ ...base, port: 0 } as never);
        await srv.start();
        const port = ((srv as never as { httpServer: http.Server }).httpServer.address() as AddressInfo).port;
        try {
            expect(await request(port, { Host: 'evil.example.com' })).toBe(403);
            expect(await request(port, { Origin: 'https://evil.example.com' })).toBe(403);
            expect(await request(port, {})).toBe(404); // a loopback client reaches the router
        } finally {
            await new Promise(r => (srv as never as { httpServer: http.Server }).httpServer.close(r));
        }
    });
});
