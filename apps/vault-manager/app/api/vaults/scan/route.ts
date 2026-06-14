import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { UserRole } from '@/db/schema';
import fs   from 'node:fs';
import path from 'node:path';

// GET /api/vaults/scan?path=...
// Counts .md files in a directory — used to preview before import
export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const role = session.user.role as UserRole;
    if (role !== 'admin' && role !== 'technical') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const dirPath = new URL(req.url).searchParams.get('path')?.trim();
    if (!dirPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

    if (!fs.existsSync(dirPath)) {
        return NextResponse.json({ error: `Directory not found: ${dirPath}` }, { status: 422 });
    }

    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
        return NextResponse.json({ error: 'Path is not a directory' }, { status: 422 });
    }

    const count = countMdFiles(dirPath);
    return NextResponse.json({ count, path: dirPath });
}

function countMdFiles(dir: string): number {
    let count = 0;
    try {
        for (const name of fs.readdirSync(dir)) {
            if (name.startsWith('.')) continue;
            const full = path.join(dir, name);
            try {
                const s = fs.statSync(full);
                if (s.isDirectory()) count += countMdFiles(full);
                else if (s.isFile() && name.endsWith('.md')) count++;
            } catch { /* skip */ }
        }
    } catch { /* skip */ }
    return count;
}
