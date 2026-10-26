import * as net from 'node:net';
import { AgentServer } from '../index';

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

describe('AgentServer bind address', () => {
    let server: AgentServer | undefined;
    afterEach(async () => { await server?.stop(); server = undefined; });

    it('binds to loopback by default', async () => {
        const port = await freePort();
        server = new AgentServer({ name: 'a', version: '1.0.0', description: 'd', port });
        await server.start();
        const addr = (server as unknown as { server: { address(): net.AddressInfo } }).server.address();
        expect(addr.address).toBe('127.0.0.1');
    });

    it('binds to the given host', async () => {
        const port = await freePort();
        server = new AgentServer({ name: 'a', version: '1.0.0', description: 'd', port, host: '0.0.0.0' });
        await server.start();
        const addr = (server as unknown as { server: { address(): net.AddressInfo } }).server.address();
        expect(addr.address).toBe('0.0.0.0');
    });
});
