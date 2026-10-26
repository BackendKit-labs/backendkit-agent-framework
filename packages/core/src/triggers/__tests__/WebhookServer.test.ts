import crypto from 'crypto';
import net from 'net';
import { WebhookServer } from '../WebhookServer';

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address() as net.AddressInfo;
            s.close(() => resolve(port));
        });
    });
}

const sign = (secret: string, body: string) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

describe('WebhookServer', () => {
    let server: WebhookServer;
    let port: number;
    const received: unknown[] = [];

    beforeEach(async () => {
        received.length = 0;
        port = await freePort();
        server = new WebhookServer(port);
    });
    afterEach(async () => { await server.stop(); });

    it('refuses a route without secret', () => {
        expect(() => server.register('/open', () => undefined)).toThrow(/no secret/);
    });

    it('refuses an empty secret', () => {
        expect(() => server.register('/open', () => undefined, '')).toThrow(/no secret/);
    });

    it('accepts a route without secret when allowUnsigned is explicit', async () => {
        server.register('/open', b => received.push(b), undefined, { allowUnsigned: true });
        await server.start();
        const res = await fetch(`http://127.0.0.1:${port}/open`, { method: 'POST', body: '{"a":1}' });
        expect(res.status).toBe(202);
        expect(received).toEqual([{ a: 1 }]);
    });

    it('verifies the signature when a secret is set', async () => {
        server.register('/signed', b => received.push(b), 's3cret');
        await server.start();
        const body = '{"ok":true}';
        const bad = await fetch(`http://127.0.0.1:${port}/signed`, { method: 'POST', body, headers: { 'x-hub-signature-256': sign('other', body) } });
        expect(bad.status).toBe(401);
        const none = await fetch(`http://127.0.0.1:${port}/signed`, { method: 'POST', body });
        expect(none.status).toBe(401);
        const good = await fetch(`http://127.0.0.1:${port}/signed`, { method: 'POST', body, headers: { 'x-hub-signature-256': sign('s3cret', body) } });
        expect(good.status).toBe(202);
        expect(received).toEqual([{ ok: true }]);
    });
});
