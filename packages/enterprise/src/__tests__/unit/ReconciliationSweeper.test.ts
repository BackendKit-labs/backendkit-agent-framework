import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ReconciliationSweeper } from '../../events/ReconciliationSweeper';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeTmpVault(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweeper-'));
    await fs.mkdir(path.join(dir, 'eventos'), { recursive: true });
    await fs.mkdir(path.join(dir, 'auditoria'), { recursive: true });
    return dir;
}

function eventNote(eventId: string, type = 'contratacion', source = 'hr-system'): string {
    return [
        '---',
        `title: "Event: ${type} (${eventId})"`,
        `author: "agent/${source}"`,
        `date: 2026-06-11`,
        `tags: ["evento"]`,
        '---',
        '',
        `## Event: ${type}`,
        '',
        '| Field | Value |',
        '|-------|-------|',
        `| ID | \`${eventId}\` |`,
        `| Type | \`${type}\` |`,
        `| Occurred | 2026-06-11T10:00:00.000Z |`,
        `| Source | \`${source}\` |`,
        `| Version | 1 |`,
    ].join('\n');
}

function auditNote(eventId: string): string {
    return `# Audit\n\nProcessed event ${eventId} successfully.\n`;
}

async function writeEventNote(vault: string, eventId: string, type = 'contratacion'): Promise<void> {
    const file = path.join(vault, 'eventos', `${eventId}.md`);
    await fs.writeFile(file, eventNote(eventId, type), 'utf-8');
}

async function writeAuditNote(vault: string, eventId: string, subfolder = ''): Promise<void> {
    const dir = subfolder
        ? path.join(vault, 'auditoria', subfolder)
        : path.join(vault, 'auditoria');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${eventId}-audit.md`), auditNote(eventId), 'utf-8');
}

// ── sweep — empty / missing folders ──────────────────────────────────────────

describe('ReconciliationSweeper — empty vault', () => {
    it('returns empty report when eventos folder is missing', async () => {
        const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-'));
        try {
            const sweeper = new ReconciliationSweeper({ vaultPath: vault });
            const report = await sweeper.sweep();
            expect(report.checked).toBe(0);
            expect(report.orphaned).toEqual([]);
        } finally {
            await fs.rm(vault, { recursive: true, force: true });
        }
    });

    it('returns empty report when both folders are empty', async () => {
        const vault = await makeTmpVault();
        try {
            const sweeper = new ReconciliationSweeper({ vaultPath: vault });
            const report = await sweeper.sweep();
            expect(report.checked).toBe(0);
            expect(report.matched).toBe(0);
        } finally {
            await fs.rm(vault, { recursive: true, force: true });
        }
    });
});

// ── sweep — matching ──────────────────────────────────────────────────────────

describe('ReconciliationSweeper — matched events', () => {
    let vault: string;
    beforeEach(async () => { vault = await makeTmpVault(); });
    afterEach(async () => { await fs.rm(vault, { recursive: true, force: true }); });

    it('reports checked=1, matched=1, orphaned=[] when event has an audit note', async () => {
        const id = 'evt-abc-001';
        await writeEventNote(vault, id);
        await writeAuditNote(vault, id);
        const sweeper = new ReconciliationSweeper({ vaultPath: vault });
        const report = await sweeper.sweep();
        expect(report.checked).toBe(1);
        expect(report.matched).toBe(1);
        expect(report.orphaned).toEqual([]);
    });

    it('matches event IDs in nested audit subfolders', async () => {
        const id = 'evt-abc-002';
        await writeEventNote(vault, id);
        await writeAuditNote(vault, id, 'onboarding/run-xyz');
        const sweeper = new ReconciliationSweeper({ vaultPath: vault });
        const report = await sweeper.sweep();
        expect(report.matched).toBe(1);
        expect(report.orphaned).toEqual([]);
    });

    it('handles multiple events — all with audit notes', async () => {
        for (let i = 0; i < 3; i++) {
            const id = `evt-abc-${i}`;
            await writeEventNote(vault, id);
            await writeAuditNote(vault, id);
        }
        const sweeper = new ReconciliationSweeper({ vaultPath: vault });
        const report = await sweeper.sweep();
        expect(report.checked).toBe(3);
        expect(report.matched).toBe(3);
        expect(report.orphaned).toHaveLength(0);
    });
});

// ── sweep — orphaned events ───────────────────────────────────────────────────

describe('ReconciliationSweeper — orphaned events', () => {
    let vault: string;
    beforeEach(async () => { vault = await makeTmpVault(); });
    afterEach(async () => { await fs.rm(vault, { recursive: true, force: true }); });

    it('reports an orphaned event when no audit note exists', async () => {
        const id = 'evt-orphan-001';
        await writeEventNote(vault, id, 'contratacion');
        const sweeper = new ReconciliationSweeper({ vaultPath: vault });
        const report = await sweeper.sweep();
        expect(report.checked).toBe(1);
        expect(report.matched).toBe(0);
        expect(report.orphaned).toHaveLength(1);
        expect(report.orphaned[0].eventId).toBe(id);
        expect(report.orphaned[0].type).toBe('contratacion');
    });

    it('reports partial orphans: 1 matched, 1 orphaned', async () => {
        const matched = 'evt-matched-001';
        const orphan = 'evt-orphan-002';
        await writeEventNote(vault, matched);
        await writeAuditNote(vault, matched);
        await writeEventNote(vault, orphan);
        const sweeper = new ReconciliationSweeper({ vaultPath: vault });
        const report = await sweeper.sweep();
        expect(report.checked).toBe(2);
        expect(report.matched).toBe(1);
        expect(report.orphaned.map(o => o.eventId)).toEqual([orphan]);
    });

    it('includes notePath pointing to the event note file', async () => {
        const id = 'evt-orphan-path';
        await writeEventNote(vault, id);
        const sweeper = new ReconciliationSweeper({ vaultPath: vault });
        const report = await sweeper.sweep();
        expect(report.orphaned[0].notePath).toContain('eventos');
        expect(report.orphaned[0].notePath).toContain('.md');
    });

    it('report.sweptAt is a valid ISO timestamp', async () => {
        const sweeper = new ReconciliationSweeper({ vaultPath: vault });
        const report = await sweeper.sweep();
        expect(report.sweptAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

// ── Custom folders ────────────────────────────────────────────────────────────

describe('ReconciliationSweeper — custom folders', () => {
    it('respects custom eventsFolder and auditFolder options', async () => {
        const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-custom-'));
        try {
            const id = 'evt-custom-001';
            await fs.mkdir(path.join(vault, 'pub'), { recursive: true });
            await fs.mkdir(path.join(vault, 'logs'), { recursive: true });
            await fs.writeFile(path.join(vault, 'pub', `${id}.md`), eventNote(id), 'utf-8');

            const sweeper = new ReconciliationSweeper({
                vaultPath: vault,
                eventsFolder: 'pub',
                auditFolder: 'logs',
            });
            const report = await sweeper.sweep();
            expect(report.checked).toBe(1);
            expect(report.orphaned).toHaveLength(1);
        } finally {
            await fs.rm(vault, { recursive: true, force: true });
        }
    });
});

// ── Criterio de salida fase 3 ─────────────────────────────────────────────────

describe('Fase 3 — criterio de salida (sweeper detects injected orphan)', () => {
    it('detects an event without an audit note injected on purpose', async () => {
        const vault = await makeTmpVault();
        try {
            // 2 events with audit notes (normal flow)
            for (const id of ['evt-ok-1', 'evt-ok-2']) {
                await writeEventNote(vault, id);
                await writeAuditNote(vault, id);
            }

            // 1 orphan injected on purpose — no audit note
            await writeEventNote(vault, 'evt-orphan-injected', 'solicitud-compra');

            const sweeper = new ReconciliationSweeper({ vaultPath: vault });
            const report = await sweeper.sweep();

            expect(report.checked).toBe(3);
            expect(report.matched).toBe(2);
            expect(report.orphaned).toHaveLength(1);
            expect(report.orphaned[0].eventId).toBe('evt-orphan-injected');
            expect(report.orphaned[0].type).toBe('solicitud-compra');
        } finally {
            await fs.rm(vault, { recursive: true, force: true });
        }
    });
});
