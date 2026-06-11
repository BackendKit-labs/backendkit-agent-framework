import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PolicySeeder } from '../../policies/PolicySeeder';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeTmpVault(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'seeder-'));
}

// ── seed ──────────────────────────────────────────────────────────────────────

describe('PolicySeeder — seed', () => {
    let vault: string;
    beforeEach(async () => { vault = await makeTmpVault(); });
    afterEach(async () => { await fs.rm(vault, { recursive: true, force: true }); });

    it('returns the list of files written', async () => {
        const seeder = new PolicySeeder(vault);
        const written = await seeder.seed();
        expect(written.length).toBeGreaterThan(0);
        for (const f of written) {
            expect(f).toContain('politicas');
            expect(f.endsWith('.md')).toBe(true);
        }
    });

    it('writes all 6 seed policies', async () => {
        const seeder = new PolicySeeder(vault);
        await seeder.seed();
        const allFiles: string[] = [];
        for (const domain of ['finanzas', 'operaciones', 'ventas', 'soporte', 'rrhh']) {
            const dir = path.join(vault, 'politicas', domain);
            const files = await fs.readdir(dir);
            allFiles.push(...files.filter(f => f.endsWith('.md')));
        }
        expect(allFiles.length).toBe(6);
    });

    it('creates files with correct frontmatter fields', async () => {
        const seeder = new PolicySeeder(vault);
        await seeder.seed();
        const file = path.join(vault, 'politicas', 'finanzas', 'approval-authority.md');
        const content = await fs.readFile(file, 'utf-8');
        expect(content).toContain('vigente_desde:');
        expect(content).toContain('aprobada_por:');
        expect(content).toContain('version:');
    });

    it('finance approval policy contains the approval matrix', async () => {
        const seeder = new PolicySeeder(vault);
        await seeder.seed();
        const content = await fs.readFile(
            path.join(vault, 'politicas', 'finanzas', 'approval-authority.md'),
            'utf-8',
        );
        expect(content).toContain('Approval Authority Matrix');
        expect(content).toContain('$500');      // thresholds live in the vault, not in prompts
        expect(content).toContain('$5,000');
        expect(content).toContain('$50,000');
    });

    it('ops policy contains incident severity levels', async () => {
        const seeder = new PolicySeeder(vault);
        await seeder.seed();
        const content = await fs.readFile(
            path.join(vault, 'politicas', 'operaciones', 'incident-severity.md'),
            'utf-8',
        );
        expect(content).toContain('P1');
        expect(content).toContain('P2');
        expect(content).toContain('P3');
        expect(content).toContain('P4');
    });

    it('support policy contains escalation tier definitions', async () => {
        const seeder = new PolicySeeder(vault);
        await seeder.seed();
        const content = await fs.readFile(
            path.join(vault, 'politicas', 'soporte', 'escalation-levels.md'),
            'utf-8',
        );
        expect(content).toContain('Tier 1');
        expect(content).toContain('Tier 2');
        expect(content).toContain('Tier 3');
    });
});

// ── overwrite behaviour ───────────────────────────────────────────────────────

describe('PolicySeeder — overwrite behaviour', () => {
    let vault: string;
    beforeEach(async () => { vault = await makeTmpVault(); });
    afterEach(async () => { await fs.rm(vault, { recursive: true, force: true }); });

    it('does NOT overwrite existing files by default', async () => {
        const seeder = new PolicySeeder(vault);
        await seeder.seed();

        // Customise the finance policy
        const file = path.join(vault, 'politicas', 'finanzas', 'approval-authority.md');
        await fs.writeFile(file, '# Custom policy', 'utf-8');

        // Second seed call — should skip existing
        const written = await seeder.seed();
        expect(written).not.toContain(file);
        expect(await fs.readFile(file, 'utf-8')).toBe('# Custom policy');
    });

    it('overwrites existing files when overwrite: true', async () => {
        const seeder = new PolicySeeder(vault);
        await seeder.seed();

        const file = path.join(vault, 'politicas', 'finanzas', 'approval-authority.md');
        await fs.writeFile(file, '# Custom policy', 'utf-8');

        const written = await seeder.seed({ overwrite: true });
        expect(written).toContain(file);
        const content = await fs.readFile(file, 'utf-8');
        expect(content).not.toBe('# Custom policy');
        expect(content).toContain('Approval Authority Matrix');
    });

    it('second default seed call returns empty array (all files already exist)', async () => {
        const seeder = new PolicySeeder(vault);
        await seeder.seed();
        const written2 = await seeder.seed();
        expect(written2).toEqual([]);
    });
});

// ── policyPath ────────────────────────────────────────────────────────────────

describe('PolicySeeder — policyPath', () => {
    it('returns the correct absolute path for a given domain and slug', () => {
        const seeder = new PolicySeeder('/vault');
        expect(seeder.policyPath('finanzas', 'approval-authority')).toBe(
            path.join('/vault', 'politicas', 'finanzas', 'approval-authority.md'),
        );
    });
});
