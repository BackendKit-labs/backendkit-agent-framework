import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FailureCatalog } from '../failure-catalog';
import type { FailureRecord } from '../types';

const record = (id: string): FailureRecord => ({
    id, domain: 'security' as FailureRecord['domain'], failureType: 'xss', severity: 'high', dimension: 'd', gate: 'g',
    agenteResponsable: 'a', hallazgo: 'h', recomendacion: 'r', archivos: [], fecha: '2026-10-24',
});

describe('FailureCatalog write queue', () => {
    let root: string;
    let catalog: FailureCatalog;
    const dir = () => path.join(root, '.reflection');

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-catalog-'));
        catalog = new FailureCatalog({ projectRoot: root, useGlobalDir: false });
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    const onDisk = (): string[] =>
        (JSON.parse(fs.readFileSync(path.join(dir(), 'failures.json'), 'utf-8')) as FailureRecord[]).map(r => r.id);

    it('persists records added one after another and concurrently', async () => {
        await catalog.addRecord(record('a'));
        await Promise.all([catalog.addRecord(record('b')), catalog.addRecords([record('c'), record('d')])]);
        expect(onDisk().sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('a write that fails reports its own error and does not poison the ones after it', async () => {
        // a file where the catalog directory should be: mkdir fails, so the first save fails
        fs.writeFileSync(dir(), 'in the way');
        await expect(catalog.addRecord(record('lost'))).rejects.toThrow();

        fs.rmSync(dir());
        await expect(catalog.addRecord(record('kept'))).resolves.toMatchObject({ id: 'kept' });
        await expect(catalog.addRecords([record('kept-2')])).resolves.toHaveLength(1);

        // the failed record is still in memory (the push ran before the failed save), the later ones reached the disk
        expect(onDisk()).toEqual(expect.arrayContaining(['kept', 'kept-2']));
    });

    it('a failure in the middle of a burst only fails its own call', async () => {
        const save = jest.spyOn(catalog, 'save');
        save.mockRejectedValueOnce(new Error('disk full')); // the first write of the burst
        const settled = await Promise.allSettled([
            catalog.addRecord(record('boom')),
            catalog.addRecord(record('after-1')),
            catalog.updateRecord('after-1', { hallazgo: 'changed' }),
        ]);
        expect(settled.map(s => s.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
        expect((settled[0] as PromiseRejectedResult).reason.message).toBe('disk full');
        expect(onDisk()).toContain('after-1');
    });

    it('updateRecord and deleteRecord go through the same queue', async () => {
        await catalog.addRecords([record('u'), record('v')]);
        await Promise.all([catalog.updateRecord('u', { hallazgo: 'changed' }), catalog.deleteRecord('v')]);
        expect(onDisk()).toEqual(['u']);
        expect((await catalog.getRecordById('u'))?.hallazgo).toBe('changed');
        expect(await catalog.updateRecord('missing', {})).toBe(false);
        expect(await catalog.deleteRecord('missing')).toBe(false);
    });
});
