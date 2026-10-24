import { resolveResourceAuth } from '../resources/resource-auth';

const URI = 'director://deployables';
const realFetch = global.fetch;
let tokenSeq = 0;
const freshToken = () => `tok-${++tokenSeq}`;

const abacAnswers = (patterns: string[]) =>
    jest.fn().mockResolvedValue({ ok: true, json: async () => ({ patterns }) });
const abacDown = () => jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

afterEach(() => {
    global.fetch = realFetch;
    delete process.env.BK_ABAC_FAIL_OPEN;
    delete process.env.NODE_ENV;
});

describe('resolveResourceAuth: fail closed by default', () => {
    it('denies a request without a token', async () => {
        global.fetch = abacAnswers(['**']) as unknown as typeof fetch;
        const auth = await resolveResourceAuth(undefined);
        expect(auth.isAllowed(URI)).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('denies when abac-service is down, whatever NODE_ENV says', async () => {
        for (const env of [undefined, 'development', 'test', 'production']) {
            if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
            global.fetch = abacDown() as unknown as typeof fetch;
            const auth = await resolveResourceAuth(freshToken());
            expect(auth.isAllowed(URI)).toBe(false);
        }
    });

    it('denies when abac-service rejects the token', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
        expect((await resolveResourceAuth(freshToken())).isAllowed(URI)).toBe(false);
    });
});

describe('resolveResourceAuth: decisions from abac-service still apply', () => {
    it('allows only what the patterns cover, with or without the Bearer prefix', async () => {
        global.fetch = abacAnswers(['director://deployables', 'director://agents/*']) as unknown as typeof fetch;
        const auth = await resolveResourceAuth(`Bearer ${freshToken()}`);
        expect(auth.isAllowed('director://deployables')).toBe(true);
        expect(auth.isAllowed('director://agents/a1')).toBe(true);
        expect(auth.isAllowed('director://secrets')).toBe(false);
    });
});

describe('resolveResourceAuth: BK_ABAC_FAIL_OPEN=1 is the explicit opt-in', () => {
    beforeEach(() => { process.env.BK_ABAC_FAIL_OPEN = '1'; });

    it('allows a request without a token', async () => {
        expect((await resolveResourceAuth(undefined)).isAllowed(URI)).toBe(true);
    });

    it('allows when abac-service is down', async () => {
        global.fetch = abacDown() as unknown as typeof fetch;
        expect((await resolveResourceAuth(freshToken())).isAllowed(URI)).toBe(true);
    });

    it('still denies when abac-service answers and says no', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;
        expect((await resolveResourceAuth(freshToken())).isAllowed(URI)).toBe(false);
    });

    it('only "1" enables it', async () => {
        process.env.BK_ABAC_FAIL_OPEN = 'true';
        expect((await resolveResourceAuth(undefined)).isAllowed(URI)).toBe(false);
    });
});
