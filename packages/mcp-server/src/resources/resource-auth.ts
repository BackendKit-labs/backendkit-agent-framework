/**
 * MCP Resource authorization — calls abac-service to get allowed URI patterns
 * for a given JWT, then provides a matcher to gate resources/list and resources/read.
 */

const ABAC_URL = process.env.ABAC_URL ?? 'http://localhost:3005';

export interface ResourceAuthContext {
    patterns: string[];
    isAllowed(uri: string): boolean;
}

/** Cache per JWT to avoid hammering abac-service on every resource call. */
const cache = new Map<string, { patterns: string[]; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

export async function resolveResourceAuth(bearerToken: string | undefined): Promise<ResourceAuthContext> {
    if (!bearerToken) return allowAll();

    const token = bearerToken.startsWith('Bearer ') ? bearerToken.slice(7) : bearerToken;

    // Check cache
    const hit = cache.get(token);
    if (hit && hit.expiresAt > Date.now()) {
        return buildContext(hit.patterns);
    }

    try {
        const res = await fetch(`${ABAC_URL}/resources/allowed`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(3_000),
        });
        if (!res.ok) return denyAll();

        const body = (await res.json()) as { patterns: string[] };
        const patterns = body.patterns ?? [];
        cache.set(token, { patterns, expiresAt: Date.now() + CACHE_TTL_MS });
        return buildContext(patterns);
    } catch {
        // abac-service unreachable → fail open (allow) in dev, fail closed in prod
        const isDev = (process.env.NODE_ENV ?? 'development') === 'development';
        return isDev ? allowAll() : denyAll();
    }
}

function buildContext(patterns: string[]): ResourceAuthContext {
    return {
        patterns,
        isAllowed: (uri: string) => patterns.some(p => matchesPattern(p, uri)),
    };
}

function allowAll(): ResourceAuthContext {
    return { patterns: ['**'], isAllowed: () => true };
}

function denyAll(): ResourceAuthContext {
    return { patterns: [], isAllowed: () => false };
}

/** Glob-style match: * = single segment, ** = any depth */
function matchesPattern(pattern: string, uri: string): boolean {
    const re = new RegExp(
        '^' +
        pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '.+')
            .replace(/\*/g, '[^/]+')
        + '$',
    );
    return re.test(uri);
}
