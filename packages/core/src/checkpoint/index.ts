import * as fs from 'fs/promises';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CheckpointSummary {
    filename: string;
    date: string;
    feature: string;
    path: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSION_MAX_BYTES = 8192;

// ── Checkpoint CRUD ───────────────────────────────────────────────────────────

export async function createCheckpoint(
    projectDir: string,
    featureName: string,
    description: string,
    sessionContent: string
): Promise<string> {
    const date = new Date().toISOString().split('T')[0];
    const safeName = featureName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
    const cpFile = path.join(projectDir, 'checkpoints', `checkpoint-${date}-${safeName}.md`);

    const content = [
        '---',
        `tags: [memoria, checkpoint, ${safeName}]`,
        `fecha: ${date}`,
        `feature: "${featureName}"`,
        '---',
        '',
        `# Checkpoint: ${featureName}`,
        '',
        `**Fecha:** ${date}  `,
        description ? `**Descripcion:** ${description}` : '',
        '',
        '---',
        '',
        '## Estado de la sesion al crear este checkpoint',
        '',
        sessionContent || '*(sesion-actual.md vacia)*',
    ].filter(l => l !== null).join('\n');

    await fs.mkdir(path.dirname(cpFile), { recursive: true });
    await fs.writeFile(cpFile, content, 'utf-8');

    const logFile = path.join(projectDir, 'proyecto-log.md');
    try {
        const log = await fs.readFile(logFile, 'utf-8');
        const row = `| ${date} | ${featureName} | Checkpoint |`;
        if (log.includes('## Hitos del Proyecto')) {
            const updated = log.replace(
                /(## Hitos del Proyecto[\s\S]*?\|---.*?\n)/,
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
                const base = f.slice('checkpoint-'.length, -'.md'.length);
                const date = base.slice(0, 10);
                const feature = base.slice(11);
                return { filename: f, date, feature, path: path.join(dir, f) };
            })
            .sort((a, b) => b.date.localeCompare(a.date));
    } catch {
        return [];
    }
}

export async function readCheckpoint(projectDir: string, filename: string): Promise<string | null> {
    try {
        return await fs.readFile(path.join(projectDir, 'checkpoints', filename), 'utf-8');
    } catch {
        return null;
    }
}

// ── Session compaction ────────────────────────────────────────────────────────

export async function compactSession(
    projectDir: string,
    featureName: string,
    checkpointRef: string
): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const sesionFile = path.join(projectDir, 'sesion-actual.md');

    let content: string;
    try {
        content = await fs.readFile(sesionFile, 'utf-8');
    } catch {
        return;
    }

    content = compactSessionContent(content);

    content = content.replace(/^fecha_actualizacion: .+$/m, `fecha_actualizacion: ${date}`);

    if (/^ultimo_checkpoint:/m.test(content)) {
        content = content.replace(/^ultimo_checkpoint: .+$/m, `ultimo_checkpoint: "${featureName}"`);
    } else {
        content = content.replace(
            /^(fecha_actualizacion: .+)$/m,
            `$1\nultimo_checkpoint: "${featureName}"`
        );
    }

    content = content.replace(
        /\*(?:Creado|Actualizado|Compactada) por DeepSeek Code el .+\*/,
        `*Compactada por DeepSeek Code el ${date} (checkpoint: ${checkpointRef})*`
    );

    await fs.writeFile(sesionFile, content, 'utf-8');
}

export function compactSessionContent(content: string): string {
    content = truncateSectionItems(content, 'Decisiones', 5, 'bullet');
    content = truncateSectionItems(content, 'Issues Activos', 5, 'numbered');
    if (Buffer.byteLength(content, 'utf-8') > SESSION_MAX_BYTES) {
        content = truncateSectionItems(content, 'Aprendizajes del Engine', 3, 'bullet');
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
