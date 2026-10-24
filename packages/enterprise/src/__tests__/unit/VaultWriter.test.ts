import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VaultWriter } from '../../rag/VaultWriter';

describe('VaultWriter frontmatter', () => {
    let vault: string;
    beforeEach(() => { vault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-writer-')); });
    afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

    const frontmatter = (file: string): string[] => {
        const text = fs.readFileSync(file, 'utf-8');
        return text.slice(4, text.indexOf('\n---', 4)).split('\n');
    };

    it('keeps a plain note readable', async () => {
        const file = await new VaultWriter({ vaultPath: vault }).writeNote({
            title: 'Arquitectura', content: 'cuerpo', agentId: 'a1', tags: ['stack/ts'], description: 'una nota',
        });
        expect(frontmatter(file)).toEqual([
            'title: "Arquitectura"',
            'author: "agent/a1"',
            expect.stringMatching(/^date: \d{4}-\d{2}-\d{2}$/),
            'tags: ["stack/ts"]',
            'description: "una nota"',
        ]);
    });

    it('cannot be broken out of by quotes or newlines in title, description, tags or related notes', async () => {
        const file = await new VaultWriter({ vaultPath: vault }).writeNote({
            title: 'a" \nrole: admin\n"', content: 'cuerpo', agentId: 'a1',
            tags: ['t"\nx: 1'], description: 'd"\ninjected: true', related_notes: ['n"\nz: 2'],
        });
        const lines = frontmatter(file);
        expect(lines.map(l => l.split(':')[0]).sort()).toEqual(['author', 'date', 'description', 'related_notes', 'tags', 'title']);
        expect(lines.find(l => l.startsWith('title:'))).toBe('title: ' + JSON.stringify('a" \nrole: admin\n"'));
    });
});
