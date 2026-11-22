import { scrubEnv } from '../env';
import { PERMISSION_PRESETS, isPermissionPreset, matchPreset, needsApproval } from '../presets';
import { createSandboxPolicy, parsePolicyConfig, SandboxPolicyError } from '../policy';

const caller = (agentId = 'coder') => ({ agentId, sessionId: 's1' });

describe('scrubEnv', () => {
    const env = {
        PATH: '/usr/bin', HOME: '/home/u', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\cmd.exe', PATHEXT: '.EXE',
        DEEPSEEK_API_KEY: 'k1', GITHUB_TOKEN: 't', db_password: 'p', MY_SECRET_THING: 's', AWS_Credentials: 'c', EMPTY: undefined,
    };

    it('drops credential-looking names case-insensitively and keeps what a shell needs', () => {
        expect(Object.keys(scrubEnv(env)).sort()).toEqual(['ComSpec', 'HOME', 'PATH', 'PATHEXT', 'SystemRoot']);
    });

    it('drops personal access tokens named PAT, but not PATH or PATHEXT', () => {
        const out = scrubEnv({ GH_PAT: 'a', GITHUB_PAT: 'b', PAT: 'c', NPM_PAT_READ: 'd', PATH: '/bin', PATHEXT: '.EXE', PATTERN: 'x' });
        expect(Object.keys(out).sort()).toEqual(['PATH', 'PATHEXT', 'PATTERN']);
    });

    it('allow wins over the default patterns, with exact names or wildcards', () => {
        const out = scrubEnv(env, { allow: ['GITHUB_TOKEN', 'deepseek_*'] });
        expect(out.GITHUB_TOKEN).toBe('t');
        expect(out.DEEPSEEK_API_KEY).toBe('k1');
        expect(out.db_password).toBeUndefined();
    });

    it('deny adds names on top of the defaults', () => {
        const out = scrubEnv(env, { deny: ['HOME', 'SYSTEM*'] });
        expect(out.HOME).toBeUndefined();
        expect(out.SystemRoot).toBeUndefined();
        expect(out.PATH).toBe('/usr/bin');
    });

    it('treats regex characters in patterns literally', () => {
        expect(scrubEnv({ 'A.B': '1', AXB: '2' }, { deny: ['A.B'] })).toEqual({ AXB: '2' });
    });
});

describe('presets', () => {
    it('map to the documented mode and approval', () => {
        expect(PERMISSION_PRESETS['read-only']).toMatchObject({ mode: 'read-only', approval: 'none' });
        expect(PERMISSION_PRESETS.ask).toMatchObject({ mode: 'workspace-write', approval: 'writes-and-commands' });
        expect(PERMISSION_PRESETS['auto-edit']).toMatchObject({ mode: 'workspace-write', approval: 'commands' });
        expect(PERMISSION_PRESETS.full).toMatchObject({ mode: 'danger-full-access', approval: 'none' });
    });

    it('matchPreset names a combination, or says custom', () => {
        expect(matchPreset('workspace-write', 'commands')).toBe('auto-edit');
        expect(matchPreset('read-only', 'none')).toBe('read-only');
        expect(matchPreset('read-only', 'commands')).toBe('custom');
        expect(matchPreset('danger-full-access', 'commands')).toBe('custom');
    });

    it('needsApproval depends on the level and the kind of action', () => {
        expect(needsApproval('none', 'command')).toBe(false);
        expect(needsApproval('commands', 'command')).toBe(true);
        expect(needsApproval('commands', 'write')).toBe(false);
        expect(needsApproval('writes-and-commands', 'write')).toBe(true);
        expect(needsApproval('writes-and-commands', 'read')).toBe(false);
    });

    it('isPermissionPreset rejects inherited property names', () => {
        expect(isPermissionPreset('ask')).toBe(true);
        expect(isPermissionPreset('toString')).toBe(false);
        expect(isPermissionPreset(undefined)).toBe(false);
    });
});

describe('createSandboxPolicy', () => {
    it('defaults to the ask preset, with the network closed outside full access', () => {
        const r = createSandboxPolicy().resolve(caller(), 'run_command');
        expect(r).toMatchObject({ mode: 'workspace-write', network: 'none', approval: 'writes-and-commands', preset: 'ask', roots: [] });
    });

    it('a preset sets mode and approval; the network follows the mode unless set', () => {
        expect(createSandboxPolicy({ preset: 'full' }).resolve(caller(), 't')).toMatchObject({ mode: 'danger-full-access', network: 'allow' });
        expect(createSandboxPolicy({ preset: 'read-only' }).resolve(caller(), 't')).toMatchObject({ mode: 'read-only', network: 'none' });
        expect(createSandboxPolicy({ preset: 'ask', network: 'allow' }).resolve(caller(), 't').network).toBe('allow');
    });

    it('explicit mode and approval override the preset and the result is reported as custom', () => {
        const r = createSandboxPolicy({ preset: 'ask', approval: 'none' }).resolve(caller(), 't');
        expect(r).toMatchObject({ mode: 'workspace-write', approval: 'none', preset: 'custom' });
    });

    it('the first matching rule wins, by agent and/or tool', () => {
        const p = createSandboxPolicy({ preset: 'ask', rules: [
            { agentId: 'reviewer', mode: 'read-only' },
            { tool: 'run_command', mode: 'danger-full-access', network: 'none' },
            { mode: 'read-only' },
        ] });
        expect(p.resolve(caller('reviewer'), 'run_command').mode).toBe('read-only');       // first rule, not the second
        expect(p.resolve(caller('coder'), 'run_command')).toMatchObject({ mode: 'danger-full-access', network: 'none' });
        expect(p.resolve(caller('coder'), 'write_file').mode).toBe('read-only');            // catch-all
    });

    it('set swaps the whole policy for the next call and bumps the version', () => {
        const p = createSandboxPolicy({ preset: 'read-only' });
        expect(p.version).toBe(1);
        expect(p.resolve(caller(), 't').mode).toBe('read-only');
        p.set({ preset: 'full' });
        expect(p.version).toBe(2);
        expect(p.resolve(caller(), 't').mode).toBe('danger-full-access');
    });

    it('a rejected set leaves the current policy and version untouched', () => {
        const p = createSandboxPolicy({ preset: 'read-only' });
        expect(() => p.set({ mode: 'everything' } as never)).toThrow(SandboxPolicyError);
        expect(p.version).toBe(1);
        expect(p.snapshot().preset).toBe('read-only');
    });

    it('snapshot is a copy: editing it does not change the policy', () => {
        const p = createSandboxPolicy({ preset: 'ask', roots: ['/a'], writeTools: ['write_file'] });
        const snap = p.snapshot();
        snap.roots!.push('/hacked');
        snap.preset = 'full';
        expect(p.snapshot()).toEqual({ preset: 'ask', roots: ['/a'], writeTools: ['write_file'] });
        expect(p.resolve(caller(), 't').roots).toEqual(['/a']);
        expect(p.writeTools()).toEqual(['write_file']);
    });

    it('resolve hands out copies of the lists', () => {
        const p = createSandboxPolicy({ roots: ['/a'], env: { allow: ['X'] } });
        const r = p.resolve(caller(), 't');
        r.roots.push('/b');
        r.env.allow!.push('Y');
        expect(p.resolve(caller(), 't').roots).toEqual(['/a']);
        expect(p.resolve(caller(), 't').env.allow).toEqual(['X']);
    });
});

describe('parsePolicyConfig', () => {
    it('accepts a full valid config as it would come from JSON or YAML', () => {
        const cfg = { preset: 'auto-edit', network: 'allow', roots: ['/x'], writeTools: ['w'], env: { allow: ['A'], deny: ['B'] },
            rules: [{ agentId: 'a', tool: 't', mode: 'read-only', network: 'none' }] };
        expect(parsePolicyConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
    });

    it.each([
        [null, /\$: expected an object/],
        [[], /\$: expected an object/],
        [{ preset: 'yolo' }, /preset: unknown preset "yolo"/],
        [{ mode: 'root' }, /mode: expected one of/],
        [{ approval: 1 }, /approval: expected one of/],
        [{ network: 'maybe' }, /network: expected one of/],
        [{ roots: 'x' }, /roots: expected an array of strings/],
        [{ writeTools: [1] }, /writeTools: expected an array of strings/],
        [{ env: { allow: 'X' } }, /env.allow: expected an array of strings/],
        [{ env: 5 }, /env: expected an object/],
        [{ rules: {} }, /rules: expected an array/],
        [{ rules: [5] }, /rules\[0\]: expected an object/],
        [{ rules: [{ agentId: 1 }] }, /rules\[0\].agentId: expected a string/],
        [{ rules: [{ tool: 1 }] }, /rules\[0\].tool: expected a string/],
        [{ rules: [{}, { mode: 'x' }] }, /rules\[1\].mode: expected one of/],
        [{ rules: [{ network: 'x' }] }, /rules\[0\].network: expected one of/],
    ])('rejects %j with the path of the problem', (input, message) => {
        expect(() => parsePolicyConfig(input)).toThrow(message);
    });
});

describe('scrubEnv: secrets that are not called a secret', () => {
    it('drops a connection string with credentials in its value, whatever the variable is named', () => {
        const out = scrubEnv({
            DATABASE_URL: 'postgres://app:s3cret@db.internal:5432/app', MONGODB_URI: 'mongodb+srv://u:p@cluster0.example.net/x',
            REDIS_URL: 'redis://:pw@cache:6379', HTTP_PROXY: 'http://user:pass@proxy:8080', PATH: '/bin',
        });
        expect(Object.keys(out)).toEqual(['PATH']);
    });

    it('keeps a URL without credentials, and what merely contains an @', () => {
        const out = scrubEnv({ API_BASE: 'https://api.example.com/v1', GIT_AUTHOR_EMAIL: 'ana@example.com', SENTRY_URL: 'https://o1.ingest.example.com', PATH: '/bin' });
        expect(Object.keys(out).sort()).toEqual(['API_BASE', 'GIT_AUTHOR_EMAIL', 'PATH', 'SENTRY_URL']);
    });

    it('drops cookies, private values and DSNs by name, as whole words', () => {
        const out = scrubEnv({ SESSION_COOKIE: 'c', PRIVATE_KEY_PATH: 'p', SENTRY_DSN: 'd', COOKIES: 'x', PRIVATELY: 'y', DSNAME: 'z', PATH: '/bin' });
        expect(Object.keys(out).sort()).toEqual(['DSNAME', 'PATH', 'PRIVATELY']);
    });

    it('allow still wins, for a variable the operator chose to pass', () => {
        expect(scrubEnv({ DATABASE_URL: 'postgres://app:pw@db/app' }, { allow: ['DATABASE_URL'] }).DATABASE_URL).toBe('postgres://app:pw@db/app');
    });
});
