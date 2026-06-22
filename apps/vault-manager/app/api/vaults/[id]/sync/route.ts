import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq, and } from 'drizzle-orm';
import { canAccessVault } from '@/lib/permissions';
import type { UserRole } from '@/lib/permissions';
import fs from 'fs';
import path from 'path';
import { reindexVault } from '@/lib/curator-codex-client';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const role = session.user.role as UserRole;
    if (role !== 'admin' && role !== 'technical') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const vault = await db.query.vaultDefinitions.findFirst({
        where: eq(schema.vaultDefinitions.id, params.id),
    });
    if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });

    if (!canAccessVault(role, vault.ownerRole as 'admin' | 'technical' | 'business')) {
        return NextResponse.json({ error: 'No access to this vault' }, { status: 403 });
    }

    const vaultPath = vault.path;
    if (!vaultPath || !fs.existsSync(vaultPath)) {
        return NextResponse.json({ error: `Vault path not found: ${vaultPath}` }, { status: 422 });
    }

    // Collect all .md files recursively
    const mdFiles = collectMdFiles(vaultPath);
    if (mdFiles.length === 0) {
        return NextResponse.json({ imported: 0, skipped: 0, message: 'No .md files found' });
    }

    // Fetch already-imported filenames for this vault
    const existing = await db
        .select({ sourceFileName: schema.auditItems.sourceFileName })
        .from(schema.auditItems)
        .where(eq(schema.auditItems.vaultId, vault.id));
    const existingNames = new Set(existing.map(r => r.sourceFileName));

    let imported = 0;
    let skipped  = 0;

    for (const filePath of mdFiles) {
        const fileName = path.relative(vaultPath, filePath).replace(/\\/g, '/');

        if (existingNames.has(fileName)) {
            skipped++;
            continue;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const title   = extractTitle(content, fileName);
        const tags    = extractTags(content);
        const area    = inferArea(fileName);

        await db.insert(schema.auditItems).values({
            id:               crypto.randomUUID(),
            vaultId:          vault.id,
            sourceFileName:   fileName,
            sourceText:       content.slice(0, 5000),
            generatedContent: content,
            generatedTitle:   title,
            area,
            tags:             JSON.stringify(tags),
            curatorScore:     1.0,
            status:           'approved',
            reviewedBy:       session.user.id,
            reviewedAt:       new Date(),
        });
        imported++;
    }

    // Update noteCount
    const total = await db
        .select({ id: schema.auditItems.id })
        .from(schema.auditItems)
        .where(and(
            eq(schema.auditItems.vaultId, vault.id),
            eq(schema.auditItems.status, 'approved'),
        ));

    await db
        .update(schema.vaultDefinitions)
        .set({ noteCount: total.length, updatedAt: new Date() })
        .where(eq(schema.vaultDefinitions.id, vault.id));

    // Re-index vault in background (non-fatal if it fails)
    reindexVault(vaultPath).catch(err =>
        console.warn('[sync] RAG reindex failed (non-fatal):', (err as Error).message),
    );

    return NextResponse.json({ imported, skipped, total: total.length });
}

function collectMdFiles(dir: string): string[] {
    const results: string[] = [];
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return results;
    }
    for (const name of names) {
        if (name.startsWith('.')) continue;
        const full = path.join(dir, name);
        try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                results.push(...collectMdFiles(full));
            } else if (stat.isFile() && name.endsWith('.md')) {
                results.push(full);
            }
        } catch { /* skip unreadable entries */ }
    }
    return results;
}

function extractTitle(content: string, fallback: string): string {
    const h1 = content.match(/^#\s+(.+)/m);
    if (h1) return h1[1].trim();
    return fallback.replace(/\.md$/, '').split('/').pop() ?? fallback;
}

function extractTags(content: string): string[] {
    // Frontmatter tags: tags: [a, b] or tags:\n  - a
    const fmMatch = content.match(/^---[\s\S]*?^tags:\s*(.+?)(?=\n\w|\n---)/m);
    if (fmMatch) {
        const raw = fmMatch[1];
        if (raw.startsWith('[')) {
            return raw.replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean);
        }
    }
    const listTags = content.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
    if (listTags) {
        return listTags[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
    }
    // Inline #tags
    const inline = content.match(/#(\w[\w-]*)/g);
    if (inline) return inline.map(t => t.slice(1));
    return [];
}

function inferArea(filePath: string): string {
    const parts = filePath.split('/');
    return parts.length > 1 ? parts[0] : 'general';
}
