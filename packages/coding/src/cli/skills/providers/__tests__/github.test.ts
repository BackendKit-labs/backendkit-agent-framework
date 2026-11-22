import { GitHubProvider, MAX_SKILL_FILE_BYTES } from '../github';

const skillMd = '---\nname: demo\ndescription: d\ntriggers: [x]\n---\nbody';

function mockFetch(downloadUrl: string, body: string) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    (global as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.startsWith('https://api.github.com')) {
            return new Response(JSON.stringify([{ type: 'file', name: 'demo.md', download_url: downloadUrl }]), { status: 200 });
        }
        return new Response(body, { status: 200 });
    });
    return calls;
}

describe('GitHubProvider downloads', () => {
    const realFetch = global.fetch;
    afterEach(() => { (global as { fetch: unknown }).fetch = realFetch; });

    it('downloads from raw.githubusercontent.com and refuses redirects', async () => {
        const calls = mockFetch('https://raw.githubusercontent.com/o/r/main/skills/demo.md', skillMd);
        const skills = await new GitHubProvider().fetch('https://github.com/o/r');
        expect(skills.map(s => s.name)).toEqual(['demo']);
        expect(calls.find(c => c.url.includes('raw.githubusercontent'))?.init?.redirect).toBe('error');
    });

    it.each([
        'http://raw.githubusercontent.com/o/r/main/demo.md',
        'https://evil.example.com/demo.md',
        'https://169.254.169.254/latest/meta-data',
    ])('refuses a download_url that points at %s', async (url) => {
        const calls = mockFetch(url, skillMd);
        await expect(new GitHubProvider().fetch('https://github.com/o/r')).rejects.toThrow(/Unsafe download URL/);
        expect(calls.some(c => c.url === url)).toBe(false);
    });

    it('refuses a skill file over the size cap', async () => {
        mockFetch('https://raw.githubusercontent.com/o/r/main/skills/demo.md', 'a'.repeat(MAX_SKILL_FILE_BYTES + 1));
        await expect(new GitHubProvider().fetch('https://github.com/o/r')).rejects.toThrow(/too large/);
    });
});
