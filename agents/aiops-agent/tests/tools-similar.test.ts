import { loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db';
import { SimilarIncidents, type Embedder } from '../src/similar';
import { createTools, runTool } from '../src/tools';
import { FakeEmbedder } from './helpers';

const counts = (db: Db) => ({
    servers: db.prepare('SELECT COUNT(*) c FROM servers').get(),
    tickets: db.prepare('SELECT COUNT(*) c FROM tickets').get(),
    incidents: db.prepare('SELECT COUNT(*) c FROM incidents').get(),
    policies: db.prepare('SELECT COUNT(*) c FROM policies').get(),
});

describe('mock tools have no effects', () => {
    it('dry-run restart/scale leave the DB untouched; unknown server → needs_human', async () => {
        const db = openDb(':memory:');
        const tools = createTools({ db, similar: new SimilarIncidents(db, null) });
        const before = JSON.stringify(counts(db));
        const a = await runTool(tools, 'scale_cpu', { server: 'prod-01', delta_vcpu: 2, dry_run: true });
        const b = await runTool(tools, 'restart_service', { server: 'prod-01', service: 'api' });
        const c = await runTool(tools, 'restart_service', { server: 'nope', service: 'api' });
        expect(a['status']).toBe('pending_approval');
        expect(b['status']).toBe('simulated');
        expect(c['status']).toBe('needs_human');
        expect(JSON.stringify(counts(db))).toBe(before);
    });

    it('only upsert_ticket writes, and only to the simulated tickets table', async () => {
        const db = openDb(':memory:');
        const tools = createTools({ db, similar: new SimilarIncidents(db, null) });
        const before = counts(db);
        const r = await runTool(tools, 'upsert_ticket', { mode: 'open', alert_id: 'a1', body: 'x' });
        expect(r['status']).toBe('simulated');
        const after = counts(db);
        expect(after.tickets).toEqual({ c: 1 });
        expect({ ...after, tickets: null }).toEqual({ ...before, tickets: null });
        const upd = await runTool(tools, 'upsert_ticket', { mode: 'update', alert_id: 'a1', body: 'y' });
        expect(upd['status']).toBe('needs_human'); // missing ticket_id
    });

    it('unknown tool → needs_human', async () => {
        const db = openDb(':memory:');
        const tools = createTools({ db, similar: new SimilarIncidents(db, null) });
        expect((await runTool(tools, 'rm_rf', {}))['status']).toBe('needs_human');
    });
});

describe('similar incident search', () => {
    it('ranks the CPU-saturation incident first and stays under 30 ms', async () => {
        const db = openDb(':memory:');
        const sim = new SimilarIncidents(db, new FakeEmbedder());
        await sim.ensureEmbeddings(); // indexing is not part of the query path
        const r = await sim.search('CPU al 99% en servidor de producción api con autoscale', 3);
        expect(r.method).toBe('embedding');
        expect(r.matches[0]!.id).toBe('INC-014');
        expect(r.search_ms).toBeLessThan(30);
    });

    it('falls back to keywords when the embedder fails', async () => {
        const db = openDb(':memory:');
        const broken: Embedder = { embed: async () => { throw new Error('ollama down'); } };
        const r = await new SimilarIncidents(db, broken).search('CPU saturada producción api', 3);
        expect(r.method).toBe('keyword');
        expect(r.matches.length).toBeGreaterThan(0);
    });
});

describe('config', () => {
    it('refuses non-local Ollama unless explicitly allowed', () => {
        expect(() => loadConfig({ OLLAMA_BASE_URL: 'http://evil.example.com:11434' })).toThrow(/no local/);
        expect(() => loadConfig({ OLLAMA_BASE_URL: 'http://evil.example.com:11434', ALLOW_REMOTE_OLLAMA: '1' })).not.toThrow();
        expect(loadConfig({}).modelName).toBe('llama3.2:3b');
    });
});
