/** Audit 2026-11-26: D-14 (allowlist by prefix) and D-09 (an Obsidian folder outside the vault). */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillManager } from '../manager';
import { ObsidianProvider } from '../providers';

describe('allowedSources match at a boundary (D-14)', () => {
    const manager = new SkillManager('t', { allowedSources: ['https://github.com/my-org', 'https://skills.sh/'] });
    const trusted = (source: string) => { try { (manager as unknown as { assertTrusted(s: string): void }).assertTrusted(source); return true; } catch { return false; } };

    it('a prefix without a trailing slash does not admit a sibling that shares it', () => {
        expect(trusted('https://github.com/my-org-evil/pack')).toBe(false);
        expect(trusted('https://github.com/my-organization/pack')).toBe(false);
    });

    it('the prefix itself, and what is under it, are admitted', () => {
        expect(trusted('https://github.com/my-org')).toBe(true);
        expect(trusted('https://github.com/my-org/pack')).toBe(true);
        expect(trusted('https://skills.sh/anything')).toBe(true);
    });
});

describe('ObsidianProvider stays inside the vault (D-09)', () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-'));
        fs.mkdirSync(path.join(root, 'vault', 'Skills'), { recursive: true });
        fs.mkdirSync(path.join(root, 'secret'));
        fs.writeFileSync(path.join(root, 'secret', 'keys.md'), '---\ntags: [skill]\nname: leak\n---\nsecret');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    const url = (folder: string) => `obsidian:///${path.join(root, 'vault').split(path.sep).join('/')}?folder=${folder}`;

    it('a folder with .. that leaves the vault is refused', async () => {
        await expect(new ObsidianProvider().fetch(url('../secret'))).rejects.toThrow(/outside the vault/);
    });

    it('a folder inside the vault is read', async () => {
        await expect(new ObsidianProvider().fetch(url('Skills'))).resolves.toEqual([]);
    });
});
