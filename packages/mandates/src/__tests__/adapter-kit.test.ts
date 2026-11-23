/** The rules every provider adapter applies the same way, whatever its credential format. */
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalJson, checkAssurance, checkConsent, checkPowers, consentMessage, selectPower } from '../index';

const ok = (action: string, extra: Partial<{ object: string; max: unknown }> = {}, extraKeys: string[] = []) => ({ power: { action, ...extra }, extraKeys });

describe('checkPowers', () => {
    it('accepts well-formed powers', () => {
        const r = checkPowers([ok('buy', { object: 'television', max: { value: 1000, currency: 'EUR' } })]);
        expect(r.ok).toBe(true);
    });
    it('refuses a power that carries a restriction it cannot enforce, because ignoring it would grant more', () => {
        const r = checkPowers([ok('buy', {}, ['maxPerDay'])]);
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/cannot enforce.*maxPerDay/) });
    });
    it.each([
        ['nothing granted', []],
        ['no action', [{ power: {}, extraKeys: [] }]],
        ['a wildcard action', [ok('*')]],
        ['a wildcard object', [ok('buy', { object: '*' })]],
        ['a repeated verb and object', [ok('buy', { object: 'tv' }), ok('buy', { object: 'tv' })]],
        ['a negative limit', [ok('buy', { max: { value: -1, currency: 'EUR' } })]],
        ['a limit without currency', [ok('buy', { max: { value: 5, currency: '' } })]],
        ['a limit that is not finite', [ok('buy', { max: { value: Infinity, currency: 'EUR' } })]],
    ] as const)('refuses %s', (_name, entries) => {
        expect(checkPowers(entries as never).ok).toBe(false);
    });
});

describe('selectPower', () => {
    const powers = [{ action: 'buy', object: 'television' }, { action: 'buy' }, { action: 'sign' }];
    it('prefers the power for that object, then the verb without object', () => {
        expect(selectPower(powers, 'buy', 'television')).toBe(powers[0]);
        expect(selectPower(powers, 'buy', 'laptop')).toBe(powers[1]);
    });
    it('falls back to the first power of the verb, so the policy can refuse with the right reason', () => {
        expect(selectPower([{ action: 'buy', object: 'television' }], 'buy', 'laptop')).toMatchObject({ object: 'television' });
    });
    it('returns nothing for a verb that was not granted, or when the tool declares none', () => {
        expect(selectPower(powers, 'delete', 'x')).toBeUndefined();
        expect(selectPower(powers, undefined, 'x')).toBeUndefined();
    });
});

describe('checkAssurance', () => {
    it('is only recorded unless a minimum is set', () => expect(checkAssurance(undefined, 'low')).toBeUndefined());
    it('refuses a lower or unknown level', () => {
        expect(checkAssurance('high', 'substantial')).toMatch(/lower assurance/);
        expect(checkAssurance('low', 'banana')).toMatch(/lower assurance/);
        expect(checkAssurance('substantial', 'high')).toBeUndefined();
    });
});

describe('consent', () => {
    const pair = generateKeyPairSync('ed25519');
    const base = { jti: 'c1', agent: 'a', exp: 10, represents: { id: 'carlos', kind: 'person' }, powers: [{ action: 'buy' }] };
    const message = consentMessage(base);
    const signed = { kid: 'k', signature: sign(null, message, pair.privateKey).toString('base64url') };
    const keyOf = (kid: string) => (kid === 'k' ? pair.publicKey : undefined);

    it('verifies the person\'s signature over the powers', () => {
        expect(checkConsent({ consent: signed, keyOf, require: true, message })).toEqual({ ok: true, consent: 'verified' });
    });
    it('a change in the powers breaks it: the issuer cannot widen what the person granted', () => {
        const wider = consentMessage({ ...base, powers: [{ action: 'buy' }, { action: 'sign' }] });
        expect(checkConsent({ consent: signed, keyOf, require: true, message: wider }).ok).toBe(false);
    });
    it('is refused when required and missing, recorded as none when optional, refused when no key of the person is trusted', () => {
        expect(checkConsent({ consent: undefined, keyOf, require: true, message }).ok).toBe(false);
        expect(checkConsent({ consent: undefined, keyOf, require: false, message })).toEqual({ ok: true, consent: 'none' });
        expect(checkConsent({ consent: { ...signed, kid: 'unknown' }, keyOf, require: false, message }).ok).toBe(false);
    });
});

describe('canonicalJson', () => {
    it('is stable across key order and drops undefined', () => {
        expect(canonicalJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe('{"a":[{"d":1}],"b":1}');
    });
});
