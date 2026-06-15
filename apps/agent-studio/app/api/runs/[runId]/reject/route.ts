import { NextResponse } from 'next/server';
import { rejectRun }    from '@/lib/gateway';

export async function POST(
    req: Request,
    { params }: { params: { runId: string } },
) {
    const body = await req.json().catch(() => ({})) as { reason?: string };
    const result = await rejectRun(params.runId, body.reason);
    return NextResponse.json(result);
}
