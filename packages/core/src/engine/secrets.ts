import type { AgentProfile, SecretRef } from '../types';

export type SecretResolver = (name: string, agentId: string) => string | undefined | Promise<string | undefined>;

/**
 * Resolves a profile's `secrets` to plain strings, on every call so a rotated env var or vault value applies
 * without a restart. A string is used as is; `{ env }` reads `process.env`; when that is empty the
 * `resolver` is asked. Names that end with no value are left out (the tool decides how to fail).
 */
export async function resolveSecrets(profile: AgentProfile | undefined, resolver?: SecretResolver): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [name, spec] of Object.entries(profile?.secrets ?? {})) {
        let value: string | undefined;
        if (typeof spec === 'string') value = spec;
        else value = process.env[(spec as SecretRef).env];
        if (!value && typeof spec !== 'string') value = await resolver?.(name, profile!.id);
        if (value) out[name] = value;
    }
    return out;
}
