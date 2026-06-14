import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { auth }                      from '@/lib/auth';
import { db, schema }                from '@/db';
import { eq }                        from 'drizzle-orm';
import { canIngest, canAccessVault } from '@/lib/permissions';
import type { UserRole }             from '@/db/schema';
import { curateFile }                from '@/lib/curator-codex-client';

// ── POST /api/ingest ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session?.user || !canIngest(session.user.role as UserRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const form     = await req.formData();
    const file     = form.get('file')     as File;
    const vaultId  = form.get('vaultId')  as string;
    const areaHint = (form.get('areaHint') as string) ?? 'general';

    if (!file || !vaultId) return NextResponse.json({ error: 'Missing file or vaultId' }, { status: 400 });

    const vault = await db.query.vaultDefinitions.findFirst({ where: eq(schema.vaultDefinitions.id, vaultId) });
    if (!vault)   return NextResponse.json({ error: 'Vault not found' }, { status: 404 });
    if (!canAccessVault(session.user.role as UserRole, vault.ownerRole as 'admin' | 'technical' | 'business')) {
        return NextResponse.json({ error: 'No access to this vault' }, { status: 403 });
    }

    const jobId = crypto.randomUUID();
    await db.insert(schema.ingestJobs).values({
        id:        jobId,
        vaultId,
        fileName:  file.name,
        fileSize:  file.size,
        areaHint,
        status:    'queued',
        createdBy: session.user.id,
    });

    // Fire-and-forget — client polls GET /api/ingest?jobId=...
    processIngestJob(jobId, file, vault.path, vaultId, areaHint, session.user.id).catch(console.error);

    return NextResponse.json({ jobId });
}

// ── GET /api/ingest?jobId=... ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const jobId = new URL(req.url).searchParams.get('jobId');
    if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

    const job = await db.query.ingestJobs.findFirst({ where: eq(schema.ingestJobs.id, jobId) });
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ status: job.status, error: job.error, auditItemId: job.auditItemId });
}

// ── Background processing ─────────────────────────────────────────────────────

async function processIngestJob(
    jobId:     string,
    file:      File,
    vaultPath: string,
    vaultId:   string,
    areaHint:  string,
    userId:    string,
) {
    try {
        await db.update(schema.ingestJobs)
            .set({ status: 'processing' })
            .where(eq(schema.ingestJobs.id, jobId));

        const text   = await file.text();
        const result = await curateFile(text, file.name, vaultPath);

        const hasDuplicate = result.notesSkipped.length > 0 && result.notesWritten.length === 0;
        const hasError     = result.errors.length > 0;
        const auditStatus  = hasError     ? 'pending'  :
                             hasDuplicate ? 'rejected' :
                             result.notesWritten.length > 0 ? 'approved' : 'pending';

        // Use content from the written file; fall back to error / duplicate message
        const generatedContent = result.generatedContent
            ?? result.errors[0]
            ?? 'Skipped — duplicate detected';

        const generatedTitle = result.generatedTitle
            ?? file.name.replace(/\.[^.]+$/, '');

        // Prefer curator-inferred area; fall back to upload hint
        const area = result.area !== 'general' ? result.area : areaHint;

        const auditId = crypto.randomUUID();
        await db.insert(schema.auditItems).values({
            id:               auditId,
            vaultId,
            sourceFileName:   file.name,
            sourceText:       text.slice(0, 5000),
            generatedContent,
            generatedTitle,
            area,
            tags:             JSON.stringify(result.tags.length > 0 ? result.tags : [`area/${area}`]),
            curatorScore:     hasDuplicate || hasError ? 0.0 : 1.0,
            status:           auditStatus,
            feedback:         hasDuplicate
                ? 'Duplicate detected — similar note already exists in vault.'
                : hasError
                ? `Curation error: ${result.errors[0]}`
                : undefined,
            reviewedBy:  auditStatus === 'approved' ? userId  : undefined,
            reviewedAt:  auditStatus === 'approved' ? new Date() : undefined,
        });

        await db.update(schema.ingestJobs)
            .set({ status: 'done', auditItemId: auditId, finishedAt: new Date() })
            .where(eq(schema.ingestJobs.id, jobId));

    } catch (err) {
        await db.update(schema.ingestJobs)
            .set({ status: 'failed', error: (err as Error).message })
            .where(eq(schema.ingestJobs.id, jobId));
    }
}
