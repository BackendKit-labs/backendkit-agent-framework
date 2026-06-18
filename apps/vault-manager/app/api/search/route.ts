import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { auth }              from '@/lib/auth';
import { isServiceRequest }  from '@/lib/service-auth';
import { db, schema }        from '@/db';
import { eq }                from 'drizzle-orm';
import { canAccessVault }    from '@/lib/permissions';
import type { UserRole }     from '@/db/schema';
import { searchVault }       from '@/lib/curator-codex-client';

// GET /api/search?q=...&vaultId=...&topK=8
export async function GET(req: NextRequest) {
    const isService = isServiceRequest(req);
    if (!isService) {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url     = new URL(req.url);
    const query   = url.searchParams.get('q')?.trim() ?? '';
    const vaultId = url.searchParams.get('vaultId');
    const topK    = Math.min(parseInt(url.searchParams.get('topK') ?? '8'), 20);

    if (!query) return NextResponse.json({ results: [] });

    // Resolve which vaults to search
    const candidates = vaultId
        ? await db.query.vaultDefinitions
            .findFirst({ where: eq(schema.vaultDefinitions.id, vaultId) })
            .then(v => (v ? [v] : []))
        : await db.select().from(schema.vaultDefinitions)
            .where(eq(schema.vaultDefinitions.active, true));

    const session = isService ? null : await auth();
    const accessible = candidates.filter(v =>
        isService || canAccessVault(
            session!.user.role as UserRole,
            v.ownerRole as 'admin' | 'technical' | 'business',
        ),
    );

    if (accessible.length === 0) return NextResponse.json({ results: [] });

    // Search all accessible vaults in parallel
    const settled = await Promise.allSettled(
        accessible.map(vault =>
            searchVault(vault.path, query, topK).then(r => ({ vault, r })),
        ),
    );

    const results = settled
        .filter((s): s is PromiseFulfilledResult<{ vault: typeof accessible[0]; r: Awaited<ReturnType<typeof searchVault>> }> =>
            s.status === 'fulfilled',
        )
        .flatMap(({ value: { vault, r } }) =>
            (r.results ?? []).map(res => ({
                title:      res.title,
                content:    res.content,
                relevance:  res.relevance,
                sourcePath: res.sourcePath,
                vaultId:    vault.id,
                vaultLabel: vault.label,
            })),
        )
        .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
        .slice(0, topK);

    return NextResponse.json({ results, query });
}
