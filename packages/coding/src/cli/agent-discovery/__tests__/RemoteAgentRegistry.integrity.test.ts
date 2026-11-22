/**
 * Audit 2026-11, third pass: what a registry sends is checked. A package name cannot leave the cache, a file is checked against the
 * hash the index lists, it is size-limited, a cached copy that changed is not reused, and a profile that asks for powerful tools says so.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PACKAGE_BYTES, RemoteAgentRegistry, packageDirName } from '../RemoteAgentRegistry';

const URL_INDEX = 'https://registry.example.com/index.json';
const URL_FILE = 'https://registry.example.com/files/a.yaml';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const YAML = 'id: helper\nname: Helper\nsystemPrompt: help\nallowedTools: [read_file]\n';
const POWERFUL = 'id: builder\nname: Builder\nsystemPrompt: build\nallowedTools: [read_file, run_command, write_file]\n';

let root: string;
let cache: string;
const realFetch = global.fetch;
let calls: string[];

function serve(files: { listing: Record<string, unknown>; body: string | (() => Response) }) {
    global.fetch = jest.fn(async (u: string) => {
        calls.push(String(u));
        if (String(u) === URL_INDEX) return new Response(JSON.stringify({ version: '1', agents: [{ name: 'helper', version: '1.0.0', description: 'x', downloadUrl: URL_FILE, ...files.listing }] }));
        return typeof files.body === 'function' ? files.body() : new Response(files.body);
    }) as unknown as typeof fetch;
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bk-registry-int-'));
    cache = join(root, 'agents', 'registry');
    calls = [];
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
});

describe('the name of a package', () => {
    it('becomes a directory name inside the cache, and "." and ".." are refused', () => {
        expect(packageDirName('@bk/agent-devops')).toBe('_bk_agent-devops');
        expect(packageDirName('a\\..\\b')).toBe('a_.._b');
        expect(() => packageDirName('..')).toThrow(/Unsafe package name/);
        expect(() => packageDirName('.')).toThrow(/Unsafe package name/);
        expect(() => packageDirName('')).toThrow(/Unsafe package name/);
        expect(() => packageDirName('x'.repeat(200))).toThrow(/Unsafe package name/);
    });

    it('a package called ".." writes nothing outside the cache (it used to put agent.yaml in the parent directory)', async () => {
        serve({ listing: { name: '..' }, body: YAML });
        const reg = new RemoteAgentRegistry(URL_INDEX, cache);
        await expect(reg.installPackage('..')).rejects.toThrow(/Unsafe package name/);
        expect(readdirSync(join(root, 'agents'))).toEqual(['registry']);
        expect(calls).toEqual([]);                                        // refused before anything was requested
    });
});

describe('the hash of the index', () => {
    it('a file that matches the listed sha256 is installed, and the cache says it was verified', async () => {
        serve({ listing: { sha256: sha(YAML) }, body: YAML });
        const p = await new RemoteAgentRegistry(URL_INDEX, cache).installPackage('helper');
        expect(p?.id).toBe('helper');
        const meta = JSON.parse(readFileSync(join(cache, 'helper', 'agent.meta.json'), 'utf8'));
        expect(meta).toMatchObject({ name: 'helper', version: '1.0.0', sha256: sha(YAML), verified: true });
    });

    it('the hash is compared without regard to case', async () => {
        serve({ listing: { sha256: sha(YAML).toUpperCase() }, body: YAML });
        expect((await new RemoteAgentRegistry(URL_INDEX, cache).installPackage('helper'))?.id).toBe('helper');
    });

    it('a file that is not the listed one is refused and nothing is written', async () => {
        serve({ listing: { sha256: sha(YAML) }, body: POWERFUL });
        await expect(new RemoteAgentRegistry(URL_INDEX, cache).installPackage('helper')).rejects.toThrow(/Integrity check failed/);
        expect(existsSync(join(cache, 'helper', 'agent.yaml'))).toBe(false);
    });

    it('without a hash the file is accepted with a warning, unless requireIntegrity is on', async () => {
        serve({ listing: {}, body: YAML });
        expect((await new RemoteAgentRegistry(URL_INDEX, cache).installPackage('helper'))?.id).toBe('helper');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('has no sha256'));

        const strictCache = join(root, 'strict');
        await expect(new RemoteAgentRegistry(URL_INDEX, strictCache, { requireIntegrity: true }).installPackage('helper')).rejects.toThrow(/requireIntegrity/);
        expect(existsSync(join(strictCache, 'helper', 'agent.yaml'))).toBe(false);
    });
});

describe('size', () => {
    it('a package over the limit is refused, by its declared length or while it is read', async () => {
        const big = 'id: x\n' + 'a'.repeat(MAX_PACKAGE_BYTES + 10);
        serve({ listing: {}, body: () => new Response(big, { headers: { 'content-length': String(big.length) } }) });
        await expect(new RemoteAgentRegistry(URL_INDEX, cache).installPackage('helper')).rejects.toThrow(/too large/);

        const chunks = new ReadableStream({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(10_000).fill(97)); c.close(); } });
        serve({ listing: {}, body: () => new Response(chunks) });                      // no content-length: the read itself is limited
        await expect(new RemoteAgentRegistry(URL_INDEX, join(root, 'c2')).installPackage('helper')).rejects.toThrow(/too large/);
        expect(existsSync(join(cache, 'helper', 'agent.yaml'))).toBe(false);
    });
});

describe('the cached copy', () => {
    it('is reused when it is what was downloaded: no request at all', async () => {
        serve({ listing: { sha256: sha(YAML) }, body: YAML });
        const reg = new RemoteAgentRegistry(URL_INDEX, cache);
        await reg.installPackage('helper');
        calls.length = 0;
        expect((await reg.installPackage('helper'))?.id).toBe('helper');
        expect(calls).toEqual([]);
    });

    it('is not reused when the file changed after it was downloaded: it is fetched again', async () => {
        serve({ listing: { sha256: sha(YAML) }, body: YAML });
        const reg = new RemoteAgentRegistry(URL_INDEX, cache);
        await reg.installPackage('helper');
        writeFileSync(join(cache, 'helper', 'agent.yaml'), POWERFUL);                  // someone edited the cached profile
        calls.length = 0;
        const p = await reg.installPackage('helper');
        expect(p?.allowedTools).toEqual(['read_file']);                                  // the real one is back
        expect(calls).toContain(URL_FILE);
    });

    it('a copy from before hashes were recorded is fetched again when requireIntegrity is on, and reused otherwise', async () => {
        serve({ listing: { sha256: sha(YAML) }, body: YAML });
        const first = new RemoteAgentRegistry(URL_INDEX, cache);
        // a cache made by an earlier version: the file, no meta
        const dir = join(cache, 'helper');
        require('node:fs').mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'agent.yaml'), YAML);
        calls.length = 0;
        await first.installPackage('helper');                                           // no meta: not trusted, fetched
        expect(calls).toContain(URL_FILE);
        expect(JSON.parse(readFileSync(join(dir, 'agent.meta.json'), 'utf8')).verified).toBe(true);
    });
});

describe('a profile that asks for powerful tools', () => {
    it('says so', async () => {
        serve({ listing: { sha256: sha(POWERFUL) }, body: POWERFUL });
        await new RemoteAgentRegistry(URL_INDEX, cache).installPackage('helper');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('asks for powerful tools: run_command, write_file'));
    });

    it('does not make noise about one that only reads', async () => {
        serve({ listing: { sha256: sha(YAML) }, body: YAML });
        await new RemoteAgentRegistry(URL_INDEX, cache).installPackage('helper');
        expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('powerful'));
    });
});
