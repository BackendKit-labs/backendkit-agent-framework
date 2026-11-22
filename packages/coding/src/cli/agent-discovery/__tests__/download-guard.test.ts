import { assertSafeDownloadUrl, isPrivateIp } from '../download-guard';

const REGISTRY = 'https://registry.example.com/index.json';
const publicDns = async () => [{ address: '93.184.216.34' }];

describe('isPrivateIp', () => {
    it.each([
        '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
        '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
        '64:ff9b::127.0.0.1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', '2002:a9fe:a9fe::1',
    ])('%s is not public', (ip) => {
        expect(isPrivateIp(ip)).toBe(true);
    });

    it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8', '2002:808:808::1'])('%s is public', (ip) => {
        expect(isPrivateIp(ip)).toBe(false);
    });
});

describe('assertSafeDownloadUrl', () => {
    it('accepts a public https URL', async () => {
        await expect(assertSafeDownloadUrl('https://cdn.example.org/a.yaml', REGISTRY, publicDns)).resolves.toBeUndefined();
    });

    it.each(['file:///etc/passwd', 'ftp://example.org/a', 'javascript:alert(1)', 'not a url'])('rejects %s', async (u) => {
        await expect(assertSafeDownloadUrl(u, REGISTRY, publicDns)).rejects.toThrow(/Unsafe download URL/);
    });

    it.each([
        'http://localhost/a', 'http://127.0.0.1/a', 'http://169.254.169.254/latest/meta-data',
        'http://[::1]/a', 'http://metadata.google.internal/a', 'http://10.0.0.5:8080/a', 'http://[::ffff:7f00:1]/a',
    ])('rejects %s', async (u) => {
        await expect(assertSafeDownloadUrl(u, REGISTRY, publicDns)).rejects.toThrow(/Unsafe download URL/);
    });

    it('rejects a public-looking name that resolves to a private address', async () => {
        const rebinding = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.7' }];
        await expect(assertSafeDownloadUrl('https://evil.example.org/a', REGISTRY, rebinding)).rejects.toThrow(/10\.0\.0\.7/);
    });

    it('rejects a host that does not resolve', async () => {
        await expect(assertSafeDownloadUrl('https://nada.example.org/a', REGISTRY, async () => [])).rejects.toThrow(/did not resolve/);
    });

    it('accepts a private address when it is the registry itself (registry inside the company network)', async () => {
        const internal = 'http://registry.corp.internal:8080/index.json';
        await expect(
            assertSafeDownloadUrl('http://registry.corp.internal:8080/agents/a.yaml', internal, publicDns),
        ).resolves.toBeUndefined();
    });

    it('does not extend that trust to another port or host', async () => {
        const internal = 'http://10.0.0.5:8080/index.json';
        await expect(assertSafeDownloadUrl('http://10.0.0.5:9999/a.yaml', internal, publicDns)).rejects.toThrow(/Unsafe/);
        await expect(assertSafeDownloadUrl('http://10.0.0.6:8080/a.yaml', internal, publicDns)).rejects.toThrow(/Unsafe/);
    });
});
