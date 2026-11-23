/**
 * SD-JWT (RFC 9901), the container of an eIDAS 2 credential in the SD-JWT VC format. Provider-neutral: these tests know no provider.
 * What a verifier MUST refuse, refused; what a holder may do, accepted.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { hideClaims, kbSigningInput, resolveDisclosures, sdHashInput, splitSdJwt, verifyKbJwt } from '../standards/sd-jwt';

const b64u = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const digestOf = (d: string) => createHash('sha256').update(d, 'ascii').digest('base64url');
const NOW = new Date('2026-11-23T12:00:00Z');
const nowS = Math.floor(NOW.getTime() / 1000);

describe('splitting', () => {
    it('a bare JWT, a JWT with disclosures, and a presentation with a key binding JWT', () => {
        expect(splitSdJwt('a.b.c')).toEqual({ jwt: 'a.b.c', disclosures: [] });
        expect(splitSdJwt('a.b.c~d1~d2~')).toEqual({ jwt: 'a.b.c', disclosures: ['d1', 'd2'] });
        expect(splitSdJwt('a.b.c~d1~k.k.k')).toEqual({ jwt: 'a.b.c', disclosures: ['d1'], kb: 'k.k.k' });
    });
    it('an empty Disclosure or an empty issuer part is refused', () => {
        expect(splitSdJwt('a.b.c~~x~')).toMatchObject({ error: expect.stringMatching(/empty Disclosure/) });
        expect(splitSdJwt('~d~')).toMatchObject({ error: expect.stringMatching(/no issuer-signed part/) });
    });
});

describe('resolving Disclosures', () => {
    const payload = { iss: 'https://issuer.example', powers: [{ action: 'buy' }], represents: { id: 'carlos', kind: 'person' }, nested: { secret: 42 } };

    it('puts back what was hidden, drops the bookkeeping, and ignores decoy digests', () => {
        const { payload: hidden, disclosures } = hideClaims(payload, ['powers', 'represents'], 3);
        const r = resolveDisclosures(hidden, disclosures);
        expect(r).toEqual({ ok: true, claims: payload });
    });

    it('a claim the holder chose NOT to disclose stays out', () => {
        const { payload: hidden, disclosures } = hideClaims(payload, ['powers', 'represents']);
        const r = resolveDisclosures(hidden, disclosures.slice(0, 1));
        expect(r.ok).toBe(true);
        if (r.ok) expect(Object.keys(r.claims).sort()).toHaveLength(Object.keys(payload).length - 1);
    });

    it('a nested claim and an array element can be hidden too', () => {
        const nestedDisclosure = b64u(['salt1', 'secret', 42]);
        const elementDisclosure = b64u(['salt2', 'second']);
        const hidden = { a: 1, nested: { _sd: [digestOf(nestedDisclosure)] }, list: ['first', { '...': digestOf(elementDisclosure) }], _sd_alg: 'sha-256' };
        const r = resolveDisclosures(hidden, [nestedDisclosure, elementDisclosure]);
        expect(r).toEqual({ ok: true, claims: { a: 1, nested: { secret: 42 }, list: ['first', 'second'] } });
    });

    it.each([
        ['a Disclosure that no digest points to', (h: Record<string, unknown>, d: string[]) => ({ h, d: [...d, b64u(['salt', 'extra', 1])] }), /not referenced/],
        ['the same Disclosure twice', (h: Record<string, unknown>, d: string[]) => ({ h, d: [...d, d[0]!] }), /appears twice/],
        ['a Disclosure that is not valid JSON', (h: Record<string, unknown>, d: string[]) => ({ h, d: [...d, 'not-base64-json!!'] }), /not valid/],
        ['a hash algorithm other than SHA-256', (h: Record<string, unknown>, d: string[]) => ({ h: { ...h, _sd_alg: 'md5' }, d }), /hash algorithm/],
    ])('refuses %s', (_name, mutate, why) => {
        const { payload: hidden, disclosures } = hideClaims(payload, ['powers']);
        const { h, d } = mutate(hidden, disclosures);
        const r = resolveDisclosures(h, d);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(why);
    });

    it('a Disclosure may not overwrite a claim that is already there', () => {
        const d = b64u(['salt', 'iss', 'https://evil.example']);
        const r = resolveDisclosures({ iss: 'https://issuer.example', _sd: [digestOf(d)], _sd_alg: 'sha-256' }, [d]);
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/overwrite the claim "iss"/) });
    });

    it('a Disclosure may not name _sd or ...', () => {
        for (const name of ['_sd', '...']) {
            const d = b64u(['salt', name, 'x']);
            const r = resolveDisclosures({ _sd: [digestOf(d)], _sd_alg: 'sha-256' }, [d]);
            expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/may not name/) });
        }
    });

    it('the same digest referenced from two places is refused', () => {
        const d = b64u(['salt', 'x', 1]);
        const r = resolveDisclosures({ a: { _sd: [digestOf(d)] }, b: { _sd: [digestOf(d)] }, _sd_alg: 'sha-256' }, [d]);
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/referenced twice/) });
    });

    it('a property Disclosure used where an array element is expected (and the reverse) is refused', () => {
        const prop = b64u(['salt', 'x', 1]);
        const elem = b64u(['salt', 1]);
        expect(resolveDisclosures({ list: [{ '...': digestOf(prop) }], _sd_alg: 'sha-256' }, [prop])).toMatchObject({ ok: false });
        expect(resolveDisclosures({ _sd: [digestOf(elem)], _sd_alg: 'sha-256' }, [elem])).toMatchObject({ ok: false });
    });

    it('an absurdly nested credential is refused instead of exhausting the stack', () => {
        let deep: Record<string, unknown> = { v: 1 };
        for (let i = 0; i < 100; i++) deep = { n: deep };
        expect(resolveDisclosures(deep, [])).toMatchObject({ ok: false, reason: expect.stringMatching(/too deep/) });
    });
});

describe('the key binding JWT', () => {
    const holder = generateKeyPairSync('ed25519');
    const stranger = generateKeyPairSync('ed25519');
    const jwt = 'h.p.s';
    const disclosures = ['d1', 'd2'];
    const base = { jwt, disclosures, aud: 'urn:verifier:acme', nonce: 'n-123', now: NOW };

    const build = (over: Partial<Parameters<typeof kbSigningInput>[0]> = {}, key = holder.privateKey): string => {
        const k = kbSigningInput({ jwt, disclosures, aud: 'urn:verifier:acme', nonce: 'n-123', iat: nowS, ...over });
        return `${k.signingInput}.${sign(null, Buffer.from(k.signingInput, 'ascii'), key).toString('base64url')}`;
    };

    it('a proof made for this verifier, this request and this presentation, with the holder\'s key, verifies', () => {
        expect(verifyKbJwt(build(), { ...base, key: holder.publicKey })).toEqual({ ok: true });
    });

    it('sd_hash covers the jwt and the disclosures in the order they are presented', () => {
        expect(sdHashInput('a.b.c', ['x', 'y'])).toBe('a.b.c~x~y~');
    });

    it.each([
        ['another verifier (aud)', { aud: 'urn:verifier:other' }, /another verifier/],
        ['another request (nonce): a replay', { nonce: 'n-OTHER' }, /nonce/],
        ['a different presentation (other Disclosures): sd_hash', { disclosures: ['d1'] }, /sd_hash/],
        ['a different credential: sd_hash', { jwt: 'x.y.z' }, /sd_hash/],
        ['an old proof (iat)', { iat: nowS - 3600 }, /not fresh/],
        ['a proof from the future', { iat: nowS + 3600 }, /not fresh/],
    ])('refuses a proof made for %s', (_name, over, why) => {
        const r = verifyKbJwt(build(over as never), { ...base, key: holder.publicKey });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(why);
    });

    it('refuses a proof signed by another key: this is the bearer-token gap', () => {
        const r = verifyKbJwt(build({}, stranger.privateKey), { ...base, key: holder.publicKey });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/not signed by the key the credential is tied to/) });
    });

    it('refuses the wrong type, alg none, garbage, and a payload edited after signing', () => {
        const k = kbSigningInput({ jwt, disclosures, aud: base.aud, nonce: base.nonce, iat: nowS });
        const [h, p] = k.signingInput.split('.') as [string, string];
        const sig = sign(null, Buffer.from(k.signingInput, 'ascii'), holder.privateKey).toString('base64url');
        const wrongTyp = `${b64u({ typ: 'JWT', alg: 'EdDSA' })}.${p}.${sig}`;
        expect(verifyKbJwt(wrongTyp, { ...base, key: holder.publicKey })).toMatchObject({ ok: false, reason: expect.stringMatching(/kb\+jwt/) });
        const none = `${b64u({ typ: 'kb+jwt', alg: 'none' })}.${p}.${sig}`;
        expect(verifyKbJwt(none, { ...base, key: holder.publicKey })).toMatchObject({ ok: false, reason: expect.stringMatching(/algorithm "none"/) });
        expect(verifyKbJwt('not-a-jwt', { ...base, key: holder.publicKey })).toMatchObject({ ok: false });
        const edited = `${h}.${b64u({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), nonce: 'n-evil' })}.${sig}`;
        expect(verifyKbJwt(edited, { ...base, key: holder.publicKey })).toMatchObject({ ok: false });
    });
});
