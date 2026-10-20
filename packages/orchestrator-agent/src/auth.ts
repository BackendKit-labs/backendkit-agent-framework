import { timingSafeEqual } from 'node:crypto';

/** Constant-time check of an `Authorization: Bearer <apiKey>` header. */
export function isBearerAuthorized(header: string | undefined, apiKey: string): boolean {
    if (!header?.startsWith('Bearer ')) return false;
    const given    = Buffer.from(header.slice(7));
    const expected = Buffer.from(apiKey);
    return given.length === expected.length && timingSafeEqual(given, expected);
}
