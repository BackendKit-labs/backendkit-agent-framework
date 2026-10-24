import { resolveHttpBinding } from '../http-binding.js';

describe('resolveHttpBinding', () => {
    it('listens on loopback by default, with or without an API key', () => {
        expect(resolveHttpBinding({})).toEqual({ ok: true, host: '127.0.0.1', loopback: true });
        expect(resolveHttpBinding({ ORCHESTRATOR_API_KEY: 'k' })).toEqual({ ok: true, host: '127.0.0.1', loopback: true });
    });

    it.each(['127.0.0.1', 'localhost', '::1'])('accepts loopback host %s without a key', host => {
        expect(resolveHttpBinding({ ORCHESTRATOR_HTTP_HOST: host })).toMatchObject({ ok: true, host, loopback: true });
    });

    it.each(['0.0.0.0', '::', '192.168.1.20', 'orchestrator.internal'])('refuses non-loopback host %s without a key', host => {
        const out = resolveHttpBinding({ ORCHESTRATOR_HTTP_HOST: host });
        expect(out.ok).toBe(false);
        expect(out).toMatchObject({ error: expect.stringContaining('ORCHESTRATOR_API_KEY') });
    });

    it('allows a non-loopback host when an API key is set', () => {
        expect(resolveHttpBinding({ ORCHESTRATOR_HTTP_HOST: '0.0.0.0', ORCHESTRATOR_API_KEY: 'k' }))
            .toEqual({ ok: true, host: '0.0.0.0', loopback: false });
    });

    it('an empty key counts as no key', () => {
        expect(resolveHttpBinding({ ORCHESTRATOR_HTTP_HOST: '0.0.0.0', ORCHESTRATOR_API_KEY: '' }).ok).toBe(false);
    });

    it('a blank host falls back to loopback', () => {
        expect(resolveHttpBinding({ ORCHESTRATOR_HTTP_HOST: '  ' })).toMatchObject({ ok: true, host: '127.0.0.1' });
    });
});
