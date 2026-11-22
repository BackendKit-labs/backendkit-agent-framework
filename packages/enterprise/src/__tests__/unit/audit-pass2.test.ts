/**
 * Audit 2026-11, second pass: what the general agent may search, where each department writes and who is told it was an agent,
 * notes that are not overwritten, and a compliance gate whose record is a chain.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HashChainAuditSink, verifyAuditChain, ProviderRegistry, createToolContext } from '@backendkit-labs/agent-core';
import type { AuditSink } from '@backendkit-labs/agent-core';
import { VaultIndexer } from '../../rag/VaultIndexer';
import { ObsidianRAGProvider } from '../../rag/ObsidianRAGProvider';
import { SimpleEmbedder } from '../../rag/SimpleEmbedder';
import { VaultWriter, MAX_NOTE_CHARS } from '../../rag/VaultWriter';
import { ComplianceGate } from '../../flow/ComplianceGate';
import { createEnterpriseSetup } from '../../factory';

let vault: string;
let work: string;
beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'ent-audit-'));
    vault = join(work, 'vault');
    for (const f of ['general', 'rrhh', 'finanzas', 'ventas', 'agentes']) mkdirSync(join(vault, f), { recursive: true });
    writeFileSync(join(vault, 'general', 'vacaciones.md'), '---\ntitle: Politica de vacaciones\n---\n\n## Vacaciones\n\nLos empleados tienen veintidos dias de vacaciones al año.\n');
    writeFileSync(join(vault, 'rrhh', 'nominas.md'), '---\ntitle: Nominas\n---\n\n## Salarios\n\nEl salario confidencial de la directora de operaciones es noventa mil euros.\n');
    writeFileSync(join(vault, 'finanzas', 'cuentas.md'), '---\ntitle: Cuentas\n---\n\n## Margen\n\nEl margen confidencial del tercer trimestre fue del cuarenta por ciento.\n');
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const embedder = new SimpleEmbedder();
const rag = (extra: Record<string, unknown> = {}) => new ObsidianRAGProvider({ vaultPath: vault, indexPath: join(work, `idx-${Math.random().toString(36).slice(2)}.json`), embedder, minScore: 0.01, ...extra });

describe('folders that are never indexed', () => {
    it('VaultIndexer leaves out an excluded top-level folder, also inside a vault scanned whole', async () => {
        const all = await new VaultIndexer({ vaultPath: vault }).getChangedFiles(new Map());
        expect(all.toIndex.map(f => f.filePath).some(p => p.includes('rrhh'))).toBe(true);
        const limited = await new VaultIndexer({ vaultPath: vault, excludeFolders: ['rrhh', 'finanzas'] }).getChangedFiles(new Map());
        const names = limited.toIndex.map(f => f.filePath.replace(/\\/g, '/'));
        expect(names.some(p => p.includes('/rrhh/') || p.includes('/finanzas/'))).toBe(false);
        expect(names.some(p => p.includes('/general/'))).toBe(true);
    });

    it('a search with the folder excluded does not find what is in it', async () => {
        const p = rag({ excludeFolders: ['rrhh'] });
        await p.index();
        expect(await p.search('salario confidencial directora de operaciones')).not.toContain('noventa mil');
        const open = rag();
        await open.index();
        expect(await open.search('salario confidencial directora de operaciones')).toContain('noventa mil');
    });
});

describe('the general agent of the enterprise setup', () => {
    const setup = (extra: Record<string, unknown> = {}) => {
        const providers = new ProviderRegistry();
        providers.register('main', { chat: async (_m: unknown, _t: unknown, cb: { onDone(m: unknown): void }) => cb.onDone({ role: 'assistant', content: 'x' }) } as never);
        return createEnterpriseSetup({ vaultPath: vault, providers, defaultProvider: 'main', embedder, indexDir: join(work, 'idx'), sessionsDir: join(work, 'sessions'), ...extra } as never);
    };
    const tool = (s: ReturnType<typeof setup>, name: string) => s.engineFactory('s1', { emit: () => undefined, close: () => undefined } as never).getTools().get(name)!;

    it('does not search the folders of HR and Finance by default, and does when asked to', async () => {
        const s = setup();
        await s.indexAll();
        const search = tool(s, 'search_knowledge');
        expect(await search.execute({ query: 'salario confidencial directora de operaciones' }, createToolContext())).not.toContain('noventa mil');
        expect(await search.execute({ query: 'margen confidencial tercer trimestre' }, createToolContext())).not.toContain('cuarenta por ciento');
        expect(await search.execute({ query: 'dias de vacaciones empleados' }, createToolContext())).toContain('veintidos');

        const wide = setup({ globalExcludeFolders: [], indexDir: join(work, 'idx2') });
        await wide.indexAll();
        expect(await tool(wide, 'search_knowledge').execute({ query: 'salario confidencial directora de operaciones' }, createToolContext())).toContain('noventa mil');
    });

    it('the HR agent still finds its own folder', async () => {
        const s = setup();
        await s.indexAll();
        expect(await tool(s, 'search_hr_kb').execute({ query: 'salario confidencial directora de operaciones' }, createToolContext())).toContain('noventa mil');
    });

    it('write_knowledge writes where the calling agent works, as that agent, and anyone else in agentes/', async () => {
        const s = setup();
        const write = tool(s, 'write_knowledge');
        const as = (agentId: string) => ({ ...createToolContext(), agentId });
        await write.execute({ title: 'Prorrata de bonus', content: 'Detalle del calculo.', tags: [], related_notes: [] }, as('hr'));
        await write.execute({ title: 'Cierre', content: 'Pasos.', tags: [], related_notes: [] }, as('finance'));
        await write.execute({ title: 'Idea', content: 'Algo.', tags: [], related_notes: [] }, as('someone-else'));
        expect(readdirSync(join(vault, 'rrhh')).some(f => f.includes('prorrata-de-bonus'))).toBe(true);
        expect(readdirSync(join(vault, 'finanzas')).some(f => f.includes('cierre'))).toBe(true);
        expect(readdirSync(join(vault, 'agentes')).some(f => f.includes('idea'))).toBe(true);
        const hrNote = readdirSync(join(vault, 'rrhh')).find(f => f.includes('prorrata'))!;
        expect(readFileSync(join(vault, 'rrhh', hrNote), 'utf8')).toContain('author: "agent/hr"');
    });
});

describe('a note an agent wrote says so when it is found', () => {
    it('the result of the search tells the reader it was written by an agent, and a note of a person does not', async () => {
        writeFileSync(join(vault, 'general', 'agente.md'), '---\ntitle: Aviso\nauthor: "agent/hr"\n---\n\n## Aviso\n\nLa cafeteria cierra los viernes por la tarde.\n');
        writeFileSync(join(vault, 'general', 'persona.md'), '---\ntitle: Horario\nauthor: "Ana"\n---\n\n## Horario\n\nLa oficina abre a las nueve de la mañana.\n');
        const p = rag();
        await p.index();
        expect(await p.search('cafeteria cierra viernes')).toMatch(/escrita por un agente \(agent\/hr\), no verificada/);
        expect(await p.search('oficina abre nueve mañana')).not.toMatch(/escrita por un agente/);
    });
});

describe('VaultWriter', () => {
    const note = (w: VaultWriter, title: string, content = 'cuerpo') => w.writeNote({ title, content, agentId: 'a', tags: [], related_notes: [] });

    it('the same title on the same day is not overwritten: the second gets a number', async () => {
        const w = new VaultWriter({ vaultPath: vault });
        const a = await note(w, 'Informe diario', 'primero');
        const b = await note(w, 'Informe diario', 'segundo');
        expect(a).not.toBe(b);
        expect(b).toMatch(/-2\.md$/);
        expect(readFileSync(a, 'utf8')).toContain('primero');
        expect(readFileSync(b, 'utf8')).toContain('segundo');
    });

    it('a title with nothing but symbols still gets a name of its own', async () => {
        const w = new VaultWriter({ vaultPath: vault });
        const a = await note(w, '???');
        const b = await note(w, '!!!');
        expect(a).toMatch(/-nota\.md$/);
        expect(b).toMatch(/-nota-2\.md$/);
    });

    it('a note over the limit is refused', async () => {
        const w = new VaultWriter({ vaultPath: vault });
        await expect(note(w, 'Enorme', 'x'.repeat(MAX_NOTE_CHARS + 1))).rejects.toThrow(/too long/);
    });

    it('a lock left by a dead process does not block the note for good', async () => {
        const w = new VaultWriter({ vaultPath: vault });
        const date = new Date().toISOString().slice(0, 10);
        const lock = join(vault, 'agentes', `${date}-bloqueada.md.lock`);
        writeFileSync(lock, '');
        const old = new Date(Date.now() - 10 * 60_000);
        utimesSync(lock, old, old);
        const path = await note(w, 'Bloqueada');
        expect(existsSync(path)).toBe(true);
    });
});

describe('ComplianceGate with an audit sink', () => {
    const gate = (audit?: AuditSink) => new ComplianceGate({ stepId: 's1', flowId: 'onboarding', runId: 'r1', executor: 'hr', criteria: ['contrato firmado'], evidenceMode: 'required', ...(audit ? { audit } : {}) });

    it('every event is a link of a chain that verifies, and the attempt of self-evaluation is in it', () => {
        const file = join(work, 'gate.ndjson');
        const g = gate(new HashChainAuditSink(file));
        expect(() => g.evaluateCriterion(0, 'hr', true, 'x')).toThrow(/self-evaluation/);
        g.evaluateCriterion(0, 'legal', true, 'contrato.pdf');
        const check = verifyAuditChain(file);
        expect(check).toMatchObject({ ok: true, entries: 2 });
        const lines = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
        expect(lines[0].event.tool).toBe('compliance_gate.self_evaluation_attempt');
        expect(lines[0].event.decision).toBe('deny');
        expect(lines[1].event.tool).toBe('compliance_gate.criterion_evaluated');
        expect(lines[1].event.principal.agentId).toBe('legal');
    });

    it('editing the chain is detected, which the markdown note of the vault cannot offer', () => {
        const file = join(work, 'gate.ndjson');
        const g = gate(new HashChainAuditSink(file));
        g.evaluateCriterion(0, 'legal', true, 'contrato.pdf');
        writeFileSync(file, readFileSync(file, 'utf8').replace('"allow"', '"deny"'));
        expect(verifyAuditChain(file).ok).toBe(false);
    });

    it('a sink that throws stops the evaluation: a decision that cannot be recorded is not taken', () => {
        const g = gate({ write: () => { throw new Error('disk full'); } });
        expect(() => g.evaluateCriterion(0, 'legal', true, 'x')).toThrow('disk full');
    });

    it('a sink that fails asynchronously fails persist, not silently', async () => {
        const g = gate({ write: () => Promise.reject(new Error('network down')) });
        g.evaluateCriterion(0, 'legal', true, 'x');
        await expect(g.persist(vault)).rejects.toThrow('network down');
    });

    it('without a sink nothing changes', async () => {
        const g = gate();
        g.evaluateCriterion(0, 'legal', true, 'x');
        expect(g.verdict).toBe('passed');
        expect(existsSync(await g.persist(vault))).toBe(true);
    });
});
