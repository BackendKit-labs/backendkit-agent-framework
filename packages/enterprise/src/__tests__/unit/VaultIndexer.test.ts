import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { VaultIndexer } from '../../rag/VaultIndexer';

async function writeFixture(dir: string, name: string, content: string): Promise<string> {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
}

describe('VaultIndexer — unit', () => {
    let tmpDir: string;

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-vault-test-'));
    });

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // ── buildChunks ──────────────────────────────────────────────────────────

    test('extrae título del frontmatter', async () => {
        const fp = await writeFixture(tmpDir, 'title-test.md', `---
title: Mi Documento
tags: [área/backend]
---

Contenido sin secciones.
`);
        const indexer = new VaultIndexer({ vaultPath: tmpDir });
        const chunks = await indexer.buildChunks(fp, 1000);
        expect(chunks[0].title).toBe('Mi Documento');
    });

    test('usa nombre de archivo si no hay title en frontmatter', async () => {
        const fp = await writeFixture(tmpDir, 'sin-titulo.md', `Contenido simple.`);
        const indexer = new VaultIndexer({ vaultPath: tmpDir });
        const chunks = await indexer.buildChunks(fp, 1000);
        expect(chunks[0].title).toBe('sin-titulo');
    });

    test('chunkea por headings ##', async () => {
        const fp = await writeFixture(tmpDir, 'secciones.md', `---
title: Doc con secciones
---

## Sección A

Contenido de la sección A.

## Sección B

Contenido de la sección B.
`);
        const indexer = new VaultIndexer({ vaultPath: tmpDir });
        const chunks = await indexer.buildChunks(fp, 1000);
        expect(chunks).toHaveLength(2);
        expect(chunks[0].section).toBe('Sección A');
        expect(chunks[1].section).toBe('Sección B');
    });

    test('el texto del chunk incluye título y sección como prefijo', async () => {
        const fp = await writeFixture(tmpDir, 'prefijo.md', `---
title: Mi Nota
---

## Detalles

Información importante.
`);
        const indexer = new VaultIndexer({ vaultPath: tmpDir });
        const chunks = await indexer.buildChunks(fp, 1000);
        expect(chunks[0].text).toMatch(/^Mi Nota — Detalles/);
    });

    test('excluye archivos con tag de exclusión', async () => {
        const fp = await writeFixture(tmpDir, 'skill-file.md', `---
tags: [skill]
---

Este es un skill, no debe indexarse.
`);
        const indexer = new VaultIndexer({ vaultPath: tmpDir, excludeTags: ['skill'] });
        const chunks = await indexer.buildChunks(fp, 1000);
        expect(chunks).toHaveLength(0);
    });

    test('cuerpo sin secciones produce un chunk con section vacía', async () => {
        const fp = await writeFixture(tmpDir, 'sin-secciones.md', `---
title: Flat
---

Un párrafo sin headings de nivel 2.
`);
        const indexer = new VaultIndexer({ vaultPath: tmpDir });
        const chunks = await indexer.buildChunks(fp, 1000);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].section).toBe('');
    });

    test('sección larga se divide en sub-chunks por párrafos', async () => {
        const manyWords = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(' ');
        const body = Array.from({ length: 12 }, () => manyWords).join('\n\n'); // ~720 palabras
        const fp = await writeFixture(tmpDir, 'largo.md', `---
title: Largo
---

## Sección grande

${body}
`);
        const indexer = new VaultIndexer({ vaultPath: tmpDir });
        const chunks = await indexer.buildChunks(fp, 1000);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0].section).toMatch(/^Sección grande/);
    });

    // ── getChangedFiles ──────────────────────────────────────────────────────

    test('archivos nuevos van a toIndex', async () => {
        const subDir = path.join(tmpDir, 'changed-test');
        await fs.mkdir(subDir, { recursive: true });
        await writeFixture(subDir, 'nuevo.md', `# Nuevo\n\nContenido.`);

        const indexer = new VaultIndexer({ vaultPath: subDir });
        const { toIndex, toRemove } = await indexer.getChangedFiles(new Map());
        expect(toIndex.some(f => f.filePath.endsWith('nuevo.md'))).toBe(true);
        expect(toRemove).toHaveLength(0);
    });

    test('archivos eliminados van a toRemove', async () => {
        const subDir = path.join(tmpDir, 'removed-test');
        await fs.mkdir(subDir, { recursive: true });

        const knownMtimes = new Map([
            [path.join(subDir, 'fantasma.md'), 1000], // ya no existe
        ]);

        const indexer = new VaultIndexer({ vaultPath: subDir });
        const { toRemove } = await indexer.getChangedFiles(knownMtimes);
        expect(toRemove).toContain(path.join(subDir, 'fantasma.md'));
    });

    test('archivos sin cambios no van a toIndex', async () => {
        const subDir = path.join(tmpDir, 'unchanged-test');
        await fs.mkdir(subDir, { recursive: true });
        const fp = await writeFixture(subDir, 'igual.md', `# Igual\n\nSin cambios.`);

        const stat = await fs.stat(fp);
        const knownMtimes = new Map([[fp, stat.mtimeMs]]);

        const indexer = new VaultIndexer({ vaultPath: subDir });
        const { toIndex } = await indexer.getChangedFiles(knownMtimes);
        expect(toIndex.some(f => f.filePath === fp)).toBe(false);
    });
});
