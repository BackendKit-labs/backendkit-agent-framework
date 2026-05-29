import * as fs from 'fs/promises';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CheckpointSummary {
    filename: string;
    date: string;
    time: string;
    feature: string;
    path: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSION_MAX_BYTES = 8192;

// ── Filename helpers ──────────────────────────────────────────────────────────

function buildCheckpointFilename(featureName: string): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5).replace(':', '');
    if (!featureName) return `checkpoint-${date}-${time}.md`;
    const safeName = featureName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
    return `checkpoint-${safeName}-${date}-${time}.md`;
}

function parseCheckpointFilename(filename: string): { date: string; time: string; feature: string } | null {
    if (!filename.startsWith('checkpoint-') || !filename.endsWith('.md')) return null;
    const base = filename.slice('checkpoint-'.length, -'.md'.length);

    // New format: {feature?}-YYYY-MM-DD-HHmm
    const newFmt = base.match(/^(.*?)(\d{4}-\d{2}-\d{2})-(\d{4})$/);
    if (newFmt) {
        const feature = (newFmt[1] ?? '').replace(/-$/, '');
        return { date: newFmt[2] ?? '', time: newFmt[3] ?? '', feature };
    }

    // Old format: YYYY-MM-DD-{feature} — parse for backwards compatibility
    const oldFmt = base.match(/^(\d{4}-\d{2}-\d{2})-(.*)$/);
    if (oldFmt) {
        return { date: oldFmt[1] ?? '', time: '0000', feature: oldFmt[2] ?? '' };
    }

    return null;
}

// ── Checkpoint CRUD ───────────────────────────────────────────────────────────

export async function createCheckpoint(
    projectDir: string,
    featureName: string,
    description: string,
    sessionContent: string,
): Promise<string> {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const timeDisplay = now.toTimeString().slice(0, 5);
    const label = featureName || '(unnamed)';
    const cpFile = path.join(projectDir, 'checkpoints', buildCheckpointFilename(featureName));

    const content = [
        '---',
        `tags: [memory, checkpoint${featureName ? `, ${featureName.replace(/\s+/g, '-').toLowerCase()}` : ''}]`,
        `date: ${date}`,
        `time: ${timeDisplay}`,
        `feature: "${featureName}"`,
        '---',
        '',
        `# Checkpoint: ${label}`,
        '',
        `**Date:** ${date} ${timeDisplay}`,
        description ? `**Description:** ${description}` : '',
        '',
        '---',
        '',
        '## Session state at checkpoint creation',
        '',
        sessionContent || '*(session.md is empty)*',
    ].filter(l => l !== null).join('\n');

    await fs.mkdir(path.dirname(cpFile), { recursive: true });
    await fs.writeFile(cpFile, content, 'utf-8');

    const logFile = path.join(projectDir, 'project-log.md');
    try {
        const log = await fs.readFile(logFile, 'utf-8');
        const row = `| ${date} ${timeDisplay} | ${label} | Checkpoint |`;
        if (log.includes('## Project Milestones')) {
            const updated = log.replace(
                /(## Project Milestones[\s\S]*?\|---.*?\n)/,
                `$1${row}\n`
            );
            await fs.writeFile(logFile, updated, 'utf-8');
        }
    } catch { /* no log file */ }

    return cpFile;
}

export async function listCheckpoints(projectDir: string): Promise<CheckpointSummary[]> {
    const dir = path.join(projectDir, 'checkpoints');
    try {
        const files = await fs.readdir(dir);
        return files
            .filter(f => f.startsWith('checkpoint-') && f.endsWith('.md'))
            .map(f => {
                const parsed = parseCheckpointFilename(f);
                if (!parsed) return null;
                return { filename: f, date: parsed.date, time: parsed.time, feature: parsed.feature, path: path.join(dir, f) };
            })
            .filter((x): x is CheckpointSummary => x !== null)
            .sort((a, b) => `${b.date}-${b.time}`.localeCompare(`${a.date}-${a.time}`));
    } catch {
        return [];
    }
}

/** Returns the most recent checkpoint per unique feature name. */
export function getLatestCheckpoints(checkpoints: CheckpointSummary[]): CheckpointSummary[] {
    const seen = new Map<string, CheckpointSummary>();
    for (const cp of checkpoints) {
        const key = cp.feature || '__unnamed__';
        if (!seen.has(key)) seen.set(key, cp);
    }
    return Array.from(seen.values());
}

export async function readCheckpoint(projectDir: string, filename: string): Promise<string | null> {
    try {
        return await fs.readFile(path.join(projectDir, 'checkpoints', filename), 'utf-8');
    } catch {
        return null;
    }
}

/** Extracts only the session state body from a checkpoint file (strips frontmatter + headers). */
export function extractSessionFromCheckpoint(content: string): string {
    const marker = '## Session state at checkpoint creation';
    const idx = content.indexOf(marker);
    if (idx === -1) return content;
    return content.slice(idx + marker.length).trim();
}

// ── Session compaction ────────────────────────────────────────────────────────

export async function compactSession(
    projectDir: string,
    featureName: string,
    checkpointRef: string
): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const sessionFile = path.join(projectDir, 'memory', 'session.md');

    let content: string;
    try {
        content = await fs.readFile(sessionFile, 'utf-8');
    } catch {
        return;
    }

    content = compactSessionContent(content);

    content = content.replace(/^updated_at: .+$/m, `updated_at: ${date}`);

    if (/^last_checkpoint:/m.test(content)) {
        content = content.replace(/^last_checkpoint: .+$/m, `last_checkpoint: "${featureName}"`);
    } else {
        content = content.replace(
            /^(updated_at: .+)$/m,
            `$1\nlast_checkpoint: "${featureName}"`
        );
    }

    content = content.replace(
        /\*(?:Created|Updated|Compacted) by .+ on .+\*/,
        `*Compacted on ${date} (checkpoint: ${checkpointRef})*`
    );

    await fs.writeFile(sessionFile, content, 'utf-8');
}

export function compactSessionContent(content: string): string {
    content = truncateSectionItems(content, 'Decisions', 5, 'bullet');
    content = truncateSectionItems(content, 'Active Issues', 5, 'numbered');
    if (Buffer.byteLength(content, 'utf-8') > SESSION_MAX_BYTES) {
        content = truncateSectionItems(content, 'Engine Learnings', 3, 'bullet');
    }
    return content;
}

function truncateSectionItems(
    content: string,
    title: string,
    maxItems: number,
    style: 'bullet' | 'numbered',
): string {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n---\\s*\\n|\\n## |$)`);
    const match = re.exec(content);
    if (!match) return content;

    const body = match[1] ?? '';
    const pattern = style === 'bullet' ? /^-\s+.+$/gm : /^\d+\.\s+.+$/gm;
    const items = body.match(pattern) ?? [];

    if (items.length <= maxItems) return content;

    const kept = items.slice(-maxItems);
    const newBody = style === 'numbered'
        ? kept.map((line, i) => `${i + 1}. ${line.replace(/^\d+\.\s*/, '')}`).join('\n')
        : kept.join('\n');

    const sectionRe = new RegExp(`(## ${escaped}\\n)[\\s\\S]*?(?=\\n---\\s*\\n|\\n## |$)`);
    return content.replace(sectionRe, `$1${newBody}\n`);
}
