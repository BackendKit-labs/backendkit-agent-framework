/** Audit 2026-11-26, C-09: over MCP the caller is a client, so skills are installed only from an operator allowlist. */
import { skillsInstall } from '../tools/skills/install.js';

describe('skills_install needs BK_TRUSTED_SOURCES', () => {
    const saved = process.env.BK_TRUSTED_SOURCES;
    afterEach(() => { if (saved === undefined) delete process.env.BK_TRUSTED_SOURCES; else process.env.BK_TRUSTED_SOURCES = saved; });

    it('without an allowlist nothing is installed, and it says why', async () => {
        delete process.env.BK_TRUSTED_SOURCES;
        const r = await skillsInstall('https://github.com/anyone/pack', 'bk-test');
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/BK_TRUSTED_SOURCES/);
    });

    it('a source outside the allowlist is refused before any network use', async () => {
        process.env.BK_TRUSTED_SOURCES = 'https://github.com/my-org/';
        const r = await skillsInstall('https://github.com/my-org-evil/pack', 'bk-test');
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/not in the trusted allowlist/);
    });
});
