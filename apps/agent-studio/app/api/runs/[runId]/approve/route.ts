import { NextResponse } from 'next/server';
import { approveRun }   from '@/lib/gateway';

export async function POST(
    req: Request,
    { params }: { params: { runId: string } },
) {
    const body = await req.json().catch(() => ({})) as { feedback?: string };
    const result = await approveRun(params.runId, body.feedback);
    return NextResponse.json(result);
}
