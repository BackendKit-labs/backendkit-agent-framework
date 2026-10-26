import { generateKeyPairSync } from 'crypto';
import { connect, mockFetch } from './helpers.js';

const ENV_KEYS = ['GCAL_ACCESS_TOKEN', 'GCAL_SERVICE_ACCOUNT_KEY'];
const saved: Record<string, string | undefined> = {};
let restoreFetch: (() => void) | undefined;

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = JSON.stringify({
    client_email: 'bot@project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    token_uri: 'https://oauth2.googleapis.com/token',
});

beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.GCAL_SERVICE_ACCOUNT_KEY = serviceAccount;
    jest.resetModules(); // the token cache is module-level
});
afterEach(() => {
    restoreFetch?.(); restoreFetch = undefined;
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const tokenReply = () => ({ json: { access_token: 'sa-token' } });
const calendars = () => ({ json: { items: [{ id: 'c1', summary: 'Main', primary: true, accessRole: 'owner' }] } });
const isTokenCall = (url: string) => url.includes('oauth2.googleapis.com');

async function server() {
    const { buildServer } = await import('../gcal/tools.js');
    return connect(buildServer());
}

describe('gcal service-account token — single flight', () => {
    it('a burst of concurrent tool calls triggers one token exchange, and all use its token', async () => {
        const m = mockFetch([tokenReply, ...Array.from({ length: 5 }, () => calendars)]);
        restoreFetch = m.restore;
        const c = await server();

        const results = await Promise.all(Array.from({ length: 5 }, () => c.call('calendar_list_calendars')));

        expect(results.every(r => !r.isError)).toBe(true);
        expect(m.calls.filter(x => isTokenCall(x.url))).toHaveLength(1);
        const api = m.calls.filter(x => !isTokenCall(x.url));
        expect(api).toHaveLength(5);
        for (const call of api) expect(call.headers.Authorization).toBe('Bearer sa-token');
        await c.close();
    });

    it('later calls reuse the cached token (no second exchange)', async () => {
        const m = mockFetch([tokenReply, calendars, calendars]);
        restoreFetch = m.restore;
        const c = await server();
        await c.call('calendar_list_calendars');
        await c.call('calendar_list_calendars');
        expect(m.calls.filter(x => isTokenCall(x.url))).toHaveLength(1);
        await c.close();
    });

    it('a failed exchange is not remembered: the next call tries again and can succeed', async () => {
        const m = mockFetch([() => ({ status: 500, text: 'down' }), tokenReply, calendars]);
        restoreFetch = m.restore;
        const c = await server();

        const failed = await c.call('calendar_list_calendars');
        expect(failed.isError).toBe(true);

        const ok = await c.call('calendar_list_calendars');
        expect(ok.isError).toBe(false);
        expect(m.calls.filter(x => isTokenCall(x.url))).toHaveLength(2);
        await c.close();
    });

    it('concurrent callers of a failing exchange all see the failure, and only one request was made', async () => {
        const m = mockFetch([() => ({ status: 500, text: 'down' })]);
        restoreFetch = m.restore;
        const c = await server();
        const results = await Promise.all(Array.from({ length: 3 }, () => c.call('calendar_list_calendars')));
        expect(results.every(r => r.isError)).toBe(true);
        expect(m.calls.filter(x => isTokenCall(x.url))).toHaveLength(1);
        await c.close();
    });
});
