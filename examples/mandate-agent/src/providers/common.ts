/**
 * What every provider adapter has to do the same way, whatever the format of its credential. An adapter turns ITS format into this neutral
 * shape (a list of powers, the person it represents, a consent) and the rules below are applied identically. Keeping them here is what makes
 * "adding a provider" mean writing a translation and nothing else, and what the conformance suite (`__tests__/conformance.test.ts`) checks.
 */
import { createHash, verify as edVerify, type KeyObject } from 'node:crypto';
import { canonicalJson } from '../identity/prototype';

/** A power in the neutral vocabulary: a verb, optionally an object, optionally an amount limit. */
export interface Power {
    action: string;
    object?: string;
    max?: { value: number; currency: string };
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Checks a list of powers already translated to the neutral shape. FAILS CLOSED on what it cannot enforce: `extraKeys` are the fields of the
 * original power that the adapter did not translate. A restriction the framework does not understand (a daily cap, a time window, a
 * counterparty list) cannot be ignored: ignoring it would grant MORE than the issuer meant. So a power that carries one is refused.
 */
export function checkPowers(entries: Array<{ power: unknown; extraKeys: string[] }>): { ok: true; powers: Power[] } | { ok: false; reason: string } {
    const powers: Power[] = [];
    const seen = new Set<string>();
    if (entries.length === 0) return { ok: false, reason: 'the credential grants no powers' };
    for (const { power: raw, extraKeys } of entries) {
        const p = raw as Partial<Power> | null;
        if (!p || typeof p !== 'object' || !nonEmpty(p.action)) return { ok: false, reason: 'a power has no action' };
        if (extraKeys.length > 0) {
            return { ok: false, reason: `the power "${p.action}" carries a restriction this deployment cannot enforce (${extraKeys.slice(0, 3).join(', ')}): ignoring it would grant more than was meant` };
        }
        if (p.action === '*') return { ok: false, reason: 'a wildcard power is not accepted: name the action' };
        if (p.object !== undefined && !nonEmpty(p.object)) return { ok: false, reason: `the object of "${p.action}" is not valid` };
        if (p.object === '*') return { ok: false, reason: 'a wildcard object is not accepted: name the object, or leave it out' };
        const key = `${p.action}\u0000${p.object ?? ''}`;
        if (seen.has(key)) return { ok: false, reason: `"${p.action}${p.object ? ` ${p.object}` : ''}" appears more than once: its limit would be ambiguous` };
        seen.add(key);
        if (p.max !== undefined) {
            const max = p.max as { value?: unknown; currency?: unknown };
            if (typeof max.value !== 'number' || !Number.isFinite(max.value) || max.value < 0) return { ok: false, reason: `the limit of "${p.action}" is not valid` };
            if (!nonEmpty(max.currency)) return { ok: false, reason: `the limit of "${p.action}" has no currency` };
        }
        powers.push(p as Power);
    }
    return { ok: true, powers };
}

/**
 * The power for THIS call: the one for the verb the tool declares and the object the call is about. With none for the object, the verb's first
 * power is used so the policy refuses with the right reason ("does not cover <object>") instead of a vague one.
 */
export function selectPower(powers: Power[], verb: string | undefined, object: string | undefined): Power | undefined {
    const forVerb = verb === undefined ? [] : powers.filter(p => p.action === verb);
    return forVerb.find(p => p.object !== undefined && p.object === object) ?? forVerb.find(p => p.object === undefined) ?? forVerb[0];
}

const RANK = { low: 0, substantial: 1, high: 2 } as const;

/** `assurance` is only recorded unless the deployment sets a minimum. */
export function checkAssurance(min: 'low' | 'substantial' | 'high' | undefined, got: unknown): string | undefined {
    if (!min) return undefined;
    const level = typeof got === 'string' && got in RANK ? RANK[got as keyof typeof RANK] : -1;
    return level < RANK[min] ? `the person was identified with a lower assurance than the "${min}" this deployment requires` : undefined;
}

/** What the PERSON signs when they consent: the agent, the person, the powers and the end date, in the neutral shape. Format-independent. */
export function consentMessage(p: { jti: unknown; agent: unknown; exp: unknown; represents: { id: unknown; kind: unknown }; powers: unknown }): Buffer {
    return Buffer.from(createHash('sha256').update(canonicalJson({ jti: p.jti, agent: p.agent, exp: p.exp, represents: { id: p.represents.id, kind: p.represents.kind }, powers: p.powers })).digest('hex'), 'hex');
}

/** The person's own signature over the powers. Without it the issuer could grant what nobody granted; with it, it cannot widen it afterwards. */
export function checkConsent(o: {
    consent: { kid?: unknown; signature?: unknown } | undefined;
    keyOf: (kid: string) => KeyObject | undefined;
    require: boolean;
    message: Buffer;
}): { ok: true; consent: 'verified' | 'none' } | { ok: false; reason: string } {
    if (o.consent === undefined) return o.require ? { ok: false, reason: 'the credential carries no consent of the person it represents' } : { ok: true, consent: 'none' };
    const key = typeof o.consent.kid === 'string' ? o.keyOf(o.consent.kid) : undefined;
    if (!key) return { ok: false, reason: 'the consent of the person cannot be checked: no key of theirs is trusted for it' };
    let ok = false;
    try { ok = typeof o.consent.signature === 'string' && edVerify(null, o.message, key, Buffer.from(o.consent.signature, 'base64url')); } catch { ok = false; }
    return ok ? { ok: true, consent: 'verified' } : { ok: false, reason: 'the person did not consent to these powers (their signature does not verify)' };
}
