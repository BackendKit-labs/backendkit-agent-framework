import type { AuthUser } from './JwtAuth';

/** An owner no session has: a token without `sub` is scoped to nothing, never to everything. */
const NOBODY = '\u0000nobody';

/**
 * Which sessions an authenticated request may see or end.
 *
 * Returns the one user id whose sessions it may touch, or `undefined` for all of them. That is the case when
 * no user is in play (no auth configured: single-tenant, as before) and for a user holding `adminRole`.
 */
export function sessionScope(user: AuthUser | undefined, adminRole: string): string | undefined {
    if (!user) return undefined;
    if (Array.isArray(user.roles) && user.roles.includes(adminRole)) return undefined;
    return typeof user.sub === 'string' && user.sub ? user.sub : NOBODY;
}

/** Whether a scope (from {@link sessionScope}) covers a session owned by `ownerId`. */
export function inScope(scope: string | undefined, ownerId: string | undefined): boolean {
    return scope === undefined || scope === ownerId;
}
