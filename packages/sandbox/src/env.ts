/**
 * Environment hygiene for confined processes: variables that look like credentials are not handed down.
 * A case-insensitive denylist by name pattern, never an allowlist-only filter (cmd.exe needs SystemRoot,
 * ComSpec and PATHEXT, and most tools need PATH/HOME-like variables).
 */

// `PAT` only as a whole word (GH_PAT, GITHUB_PAT): a bare /PAT/ would also drop PATH and PATHEXT.
const DEFAULT_DENY = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|(?:^|_)(?:PAT|COOKIES?|PRIVATE|DSN)(?:_|$)/i;

// A connection string carries its secret in the VALUE, whatever the variable is called (DATABASE_URL, MONGODB_URI, REDIS_URL...):
// `scheme://user:password@host`.
const URL_WITH_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]*:[^\s/@]+@/i;

export interface EnvPolicy {
    /** Names (exact, or with `*` as wildcard) that are passed even if they look like credentials, e.g. `GH_TOKEN`. */
    allow?: string[];
    /** Extra names (exact, or with `*`) to drop on top of the default patterns. */
    deny?: string[];
}

function matcher(patterns: string[] | undefined): (name: string) => boolean {
    const regexes = (patterns ?? []).map(p =>
        new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i'));
    return name => regexes.some(r => r.test(name));
}

/** The variables of `env` a confined process may see. Undefined values are dropped. */
export function scrubEnv(env: Record<string, string | undefined>, policy: EnvPolicy = {}): Record<string, string> {
    const allowed = matcher(policy.allow);
    const denied = matcher(policy.deny);
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(env)) {
        if (value === undefined) continue;
        if (allowed(name)) { out[name] = value; continue; }
        if (denied(name) || DEFAULT_DENY.test(name) || URL_WITH_CREDENTIALS.test(value)) continue;
        out[name] = value;
    }
    return out;
}
