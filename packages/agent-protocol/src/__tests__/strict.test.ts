import { AgentServer } from '../index';

const base = { name: 'a', version: '1.0.0', description: 'd', port: 0 };

describe('AgentServer strict', () => {
    it('refuses a non-loopback host without an apiKey', () => {
        expect(() => new AgentServer({ ...base, host: '0.0.0.0', strict: true })).toThrow(/strict mode/);
    });

    it('allows loopback, or a non-loopback host with an apiKey', () => {
        for (const opts of [
            { strict: true },
            { strict: true, host: '127.0.0.1' },
            { strict: true, host: '0.0.0.0', apiKey: 'k' },
        ]) {
            const server = new AgentServer({ ...base, ...opts });
            void server.stop();
        }
    });

    it('without strict the server still starts, but warns when it is open to the network', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const server = new AgentServer({ ...base, host: '0.0.0.0' });
        try {
            await server.start();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('without an apiKey'));
        } finally {
            await server.stop();
            warn.mockRestore();
            log.mockRestore();
        }
    });

    it('does not warn on loopback', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const server = new AgentServer(base);
        try {
            await server.start();
            expect(warn).not.toHaveBeenCalled();
        } finally {
            await server.stop();
            warn.mockRestore();
            log.mockRestore();
        }
    });
});
