import * as crypto from 'crypto';
import Fastify from 'fastify';
import { TriggerBus } from '../trigger/TriggerBus';

const SECRET = 'whsec';
const sign = (body: string) => `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;

async function build() {
    const bus = new TriggerBus(() => { throw new Error('engine is not needed: the factory is never reached'); });
    bus.addWebhook({ name: 'gh', path: '/hook', secret: SECRET, buildPrompt: () => 'x' });
    const app = Fastify();
    bus.registerRoutes(app);
    await app.ready();
    return app;
}

describe('webhook HMAC over the raw body', () => {
    // Pretty-printed with a space after the colon and keys in a non-canonical order: JSON.stringify
    // of the parsed body would produce different bytes and a different signature.
    const body = '{ "zeta": 1,  "alpha": [1, 2] }';

    it('accepts a signature computed over the exact bytes sent', async () => {
        const app = await build();
        const res = await app.inject({
            method: 'POST', url: '/hook', payload: body,
            headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
        });
        expect(res.statusCode).toBe(202);
        await app.close();
    });

    it('rejects a wrong signature', async () => {
        const app = await build();
        const res = await app.inject({
            method: 'POST', url: '/hook', payload: body,
            headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign('{}') },
        });
        expect(res.statusCode).toBe(401);
        await app.close();
    });

    it('rejects a missing signature', async () => {
        const app = await build();
        const res = await app.inject({ method: 'POST', url: '/hook', payload: body, headers: { 'content-type': 'application/json' } });
        expect(res.statusCode).toBe(401);
        await app.close();
    });

    it('answers 400 for an empty or malformed JSON body', async () => {
        const app = await build();
        for (const payload of ['', '{nope']) {
            const res = await app.inject({
                method: 'POST', url: '/hook', payload,
                headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(payload) },
            });
            expect(res.statusCode).toBe(400);
        }
        await app.close();
    });
});
