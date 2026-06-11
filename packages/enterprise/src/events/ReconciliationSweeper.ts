import * as fs from 'fs/promises';
import * as path from 'path';
import type { OrphanedEvent, ReconciliationReport } from './types';

export interface ReconciliationSweeperOptions {
    /** Absolute path to the shared vault. */
    vaultPath: string;
    /** Subfolder where EventPublisher writes event notes. Default: 'eventos' */
    eventsFolder?: string;
    /** Subfolder tree where consumers write audit notes. Default: 'auditoria' */
    auditFolder?: string;
}

/**
 * Compares published events (vault /eventos/) against audit notes (vault /auditoria/).
 *
 * Each event note written by EventPublisher contains a table row:
 *   | ID | `<event-uuid>` |
 *
 * The sweeper extracts these IDs and checks if the text appears anywhere in
 * the /auditoria/ subtree. Events without a matching audit note are "orphaned".
 *
 * This detects consistency gaps without an outbox transaction, using the vault
 * as the source of truth (ADR-1).
 */
export class ReconciliationSweeper {
    private readonly vaultPath: string;
    private readonly eventsFolder: string;
    private readonly auditFolder: string;

    constructor(opts: ReconciliationSweeperOptions) {
        this.vaultPath = opts.vaultPath;
        this.eventsFolder = opts.eventsFolder ?? 'eventos';
        this.auditFolder = opts.auditFolder ?? 'auditoria';
    }

    async sweep(): Promise<ReconciliationReport> {
        const eventNotes = await this.readEventNotes();
        const auditContent = await this.readAuditContent();

        const orphaned: OrphanedEvent[] = [];
        let matched = 0;

        for (const note of eventNotes) {
            if (auditContent.includes(note.eventId)) {
                matched++;
            } else {
                orphaned.push(note);
            }
        }

        return {
            checked: eventNotes.length,
            matched,
            orphaned,
            sweptAt: new Date().toISOString(),
        };
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async readEventNotes(): Promise<OrphanedEvent[]> {
        const dir = path.join(this.vaultPath, this.eventsFolder);
        let files: string[];
        try {
            const entries = await fs.readdir(dir);
            files = entries.filter(f => f.endsWith('.md'));
        } catch {
            return [];
        }

        const notes: OrphanedEvent[] = [];
        for (const file of files) {
            const filePath = path.join(dir, file);
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const eventId = this.extractTableField(content, 'ID');
                if (!eventId) continue;
                notes.push({
                    eventId,
                    type: this.extractTableField(content, 'Type') ?? 'unknown',
                    occurredAt: this.extractTableField(content, 'Occurred') ?? '',
                    source: this.extractTableField(content, 'Source') ?? '',
                    notePath: filePath,
                });
            } catch { /* skip unreadable files */ }
        }
        return notes;
    }

    private async readAuditContent(): Promise<string> {
        const dir = path.join(this.vaultPath, this.auditFolder);
        const chunks: string[] = [];
        try {
            await this.collectContent(dir, chunks);
        } catch { /* audit folder may not exist yet */ }
        return chunks.join('\n');
    }

    private async collectContent(dir: string, acc: string[]): Promise<void> {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await this.collectContent(full, acc);
            } else if (entry.name.endsWith('.md')) {
                try {
                    acc.push(await fs.readFile(full, 'utf-8'));
                } catch { /* skip */ }
            }
        }
    }

    /**
     * Extracts a value from a Markdown table row of the form:
     *   | FieldName | `value` |  or  | FieldName | value |
     */
    private extractTableField(content: string, field: string): string | undefined {
        const re = new RegExp(
            `\\|\\s*${field}\\s*\\|\\s*\`?([^|\`\\n]+?)\`?\\s*\\|`,
            'im',
        );
        return content.match(re)?.[1]?.trim();
    }
}
