/** The request to the provider, with a fake `fetch` (SPEC-0040 F1): where the key goes, what is asked, and how failures read. */
import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DEEPSEEK, openAiCompatible } from './providers.ts';
import { ProviderError } from './generate.ts';
import type { Message } from './prompt.ts';

const KEY = 'sk-SECRET-KEY-1234567890';
const MESSAGES: Message[] = [{ role: 'system', content: 'be a designer' }, { role: 'user', content: 'design it' }];

interface Seen { url: string; init: RequestInit }

function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>) {
    const seen: Seen[] = [];
    const impl = (async (url: string, init: RequestInit) => { const s = { url, init }; seen.push(s); return respond(s); }) as unknown as typeof fetch;
    return { impl, seen };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (content: string, extra: Record<string, unknown> = {}) => json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 45 }, ...extra });

describe('the request', () => {
    test('goes to the provider and nowhere else, with the key only in the Authorization header', async () => {
        const f = fakeFetch(() => ok('{}'));
        await openAiCompatible(DEEPSEEK, `  ${KEY}  `, f.impl)(MESSAGES);
        assert.equal(f.seen.length, 1);
        const { url, init } = f.seen[0]!;
        assert.equal(url, 'https://api.deepseek.com/chat/completions');
        assert.equal(new URL(url).host, DEEPSEEK.host);
        assert.equal(init.method, 'POST');
        assert.deepEqual(init.headers, { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` });     // trimmed
        assert.ok(!url.includes(KEY) && !String(init.body).includes(KEY), 'the key must not be in the URL or the body');
    });

    test('asks for one JSON object, without thinking, and sends nothing else of the visitor\'s', async () => {
        const f = fakeFetch(() => ok('{}'));
        await openAiCompatible(DEEPSEEK, KEY, f.impl)(MESSAGES);
        const body = JSON.parse(String(f.seen[0]!.init.body));
        assert.deepEqual(body.messages, MESSAGES);
        assert.equal(body.model, DEEPSEEK.model);
        assert.deepEqual(body.response_format, { type: 'json_object' });
        assert.deepEqual(body.thinking, { type: 'disabled' });
        assert.equal(body.stream, false);
        assert.equal(f.seen[0]!.init.credentials, 'omit');
        assert.equal(f.seen[0]!.init.referrerPolicy, 'no-referrer');
    });

    test('returns the text and the usage', async () => {
        const r = await openAiCompatible(DEEPSEEK, KEY, fakeFetch(() => ok('{"a":1}')).impl)(MESSAGES);
        assert.deepEqual(r, { text: '{"a":1}', usage: { inputTokens: 120, outputTokens: 45 } });
    });

    test('with no key it does not even send the request', async () => {
        const f = fakeFetch(() => ok('{}'));
        await assert.rejects(openAiCompatible(DEEPSEEK, '   ', f.impl)(MESSAGES), /Paste your key/);
        assert.equal(f.seen.length, 0);
    });
});

describe('a failure is told as it is, in words for the visitor, never with the key', () => {
    const cases: Array<[number, RegExp]> = [
        [401, /rejected the key \(401\)/], [403, /rejected the key \(403\)/], [402, /no balance \(402\)/],
        [429, /limiting requests \(429\)/], [500, /had an error \(500\)/], [503, /had an error \(503\)/], [400, /refused the request \(400\)/],
    ];
    for (const [status, pattern] of cases) {
        test(`${status}`, async () => {
            const f = fakeFetch(() => json({ error: { message: `server said no, for the key ${KEY}` } }, status));
            const err = await openAiCompatible(DEEPSEEK, KEY, f.impl)(MESSAGES).catch(e => e as ProviderError);
            assert.ok(err instanceof ProviderError);
            assert.match(err.message, pattern);
            assert.equal(err.status, status);
            assert.equal(f.seen.length, 1, 'no retry');
        });
    }

    test('what the provider said is shown, clipped', async () => {
        const f = fakeFetch(() => json({ error: { message: 'x'.repeat(1000) } }, 400));
        const err = await openAiCompatible(DEEPSEEK, KEY, f.impl)(MESSAGES).catch(e => e as ProviderError);
        assert.ok(err.message.length < 500);
        assert.match(err.message, /\.\.\.$/);
    });

    test('a body that is not JSON still gives a readable error', async () => {
        const err = await openAiCompatible(DEEPSEEK, KEY, fakeFetch(() => new Response('<html>gateway</html>', { status: 502 })).impl)(MESSAGES).catch(e => e as ProviderError);
        assert.match(err.message, /had an error \(502\)/);
    });

    test('a network error says where it could not reach, and that it may be the browser', async () => {
        const f = fakeFetch(() => { throw new TypeError('Failed to fetch'); });
        const err = await openAiCompatible(DEEPSEEK, KEY, f.impl)(MESSAGES).catch(e => e as ProviderError);
        assert.match(err.message, /Could not reach api\.deepseek\.com/);
        assert.match(err.message, /browser/);
    });

    test('a request that takes too long is cut', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const f = fakeFetch(({ init }) => new Promise<Response>((_res, rej) => { init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); }));
        const pending = openAiCompatible(DEEPSEEK, KEY, f.impl)(MESSAGES).catch(e => e as ProviderError);
        t.mock.timers.tick(120_000);
        const err = await pending;
        assert.match(err.message, /did not answer in 120 seconds/);
    });

    test('an answer that is cut by the token limit, empty, or not JSON is not accepted as a design', async () => {
        const cut = await openAiCompatible(DEEPSEEK, KEY, fakeFetch(() => json({ choices: [{ message: { content: '{"a"' }, finish_reason: 'length' }] })).impl)(MESSAGES).catch(e => e as ProviderError);
        assert.match(cut.message, /token limit/);
        const empty = await openAiCompatible(DEEPSEEK, KEY, fakeFetch(() => json({ choices: [{ message: { content: '' } }] })).impl)(MESSAGES).catch(e => e as ProviderError);
        assert.match(empty.message, /no content/);
        const notJson = await openAiCompatible(DEEPSEEK, KEY, fakeFetch(() => new Response('plain text', { status: 200 })).impl)(MESSAGES).catch(e => e as ProviderError);
        assert.match(notJson.message, /not JSON/);
    });
});

void mock;
