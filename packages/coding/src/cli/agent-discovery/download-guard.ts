import { isIPv4, isIPv6 } from 'net';
import { lookup } from 'dns/promises';

/**
 * SSRF guard for the download URLs of a remote agent registry.
 *
 * The `downloadUrl` of every package comes from the registry index, which is data fetched over the
 * network, so it is not trusted: it may point at localhost, the cloud metadata endpoint
 * (169.254.169.254) or an internal service. A URL is accepted when:
 *   - the protocol is http or https, and
 *   - it has the same origin as the registry itself (the operator configured that host, so a registry
 *     inside the company network keeps working), or every address its host resolves to is public.
 *
 * Not covered: a host whose DNS answer changes between this check and the request (DNS rebinding).
 * Redirects are refused by the caller (`redirect: 'error'`), since they would skip this check.
 */

export type LookupFn = (host: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupFn = (host) => lookup(host, { all: true });

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|localdomain)$/;

/** True for loopback, private, link-local, CGNAT, unspecified and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (isIPv4(v)) return isPrivateV4(v.split('.').map(Number));
    if (!isIPv6(v)) return true; // not an IP we understand: refuse

    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1): judge the embedded IPv4 address.
    const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mappedDotted) return isPrivateV4(mappedDotted[1].split('.').map(Number));
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
    if (mappedHex) {
        const hi = parseInt(mappedHex[1], 16);
        const lo = parseInt(mappedHex[2], 16);
        return isPrivateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
    }

    // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) embed an IPv4 address: judge that one, not the wrapper.
    const nat64 = /^64:ff9b::(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(v);
    if (nat64) {
        if (nat64[1]) return isPrivateV4(nat64[1].split('.').map(Number));
        const hi = parseInt(nat64[2], 16), lo = parseInt(nat64[3], 16);
        return isPrivateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
    }
    const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/.exec(v);
    if (sixToFour) {
        const hi = parseInt(sixToFour[1], 16), lo = parseInt(sixToFour[2], 16);
        return isPrivateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
    }

    if (v === '::' || v === '::1') return true;
    const first = parseInt(v.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
}

function isPrivateV4([a, b, c]: number[]): boolean {
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;           // CGNAT
    if (a === 169 && b === 254) return true;                     // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;       // benchmarking
    if (a >= 224) return true;                                   // multicast, reserved, broadcast
    return false;
}

export async function assertSafeDownloadUrl(
    raw: string,
    registryUrl: string,
    resolve: LookupFn = defaultLookup,
): Promise<void> {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`Unsafe download URL (invalid): ${raw}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`Unsafe download URL (protocol ${url.protocol} not allowed): ${raw}`);
    }

    try {
        if (new URL(registryUrl).origin === url.origin) return;
    } catch { /* an invalid registry URL cannot vouch for anything */ }

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTS.test(host) || host === 'metadata') {
        throw new Error(`Unsafe download URL (host ${host} is internal): ${raw}`);
    }
    const addresses = isIPv4(host) || isIPv6(host) ? [{ address: host }] : await resolve(host);
    if (addresses.length === 0) {
        throw new Error(`Unsafe download URL (${host} did not resolve): ${raw}`);
    }
    for (const { address } of addresses) {
        if (isPrivateIp(address)) {
            throw new Error(`Unsafe download URL (${host} resolves to non-public address ${address}): ${raw}`);
        }
    }
}
