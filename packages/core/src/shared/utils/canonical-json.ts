import { createHash } from 'node:crypto';

/**
 * JSON with object keys sorted at every level, so two values that are equal produce the same text whatever the
 * order their keys were written in. Arrays keep their order. `undefined` inside objects is dropped (as
 * `JSON.stringify` does); a bare `undefined` becomes `null`.
 */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const entries = Object.keys(obj).sort()
        .filter(k => obj[k] !== undefined)
        .map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return `{${entries.join(',')}}`;
}

/**
 * SHA-256 (hex) of the canonical JSON of a tool call's arguments. This is what audit records carry instead of
 * the arguments themselves: equal arguments hash equal, and nothing of their content is readable.
 */
export function hashArgs(args: unknown): string {
    return createHash('sha256').update(canonicalJson(args)).digest('hex');
}
