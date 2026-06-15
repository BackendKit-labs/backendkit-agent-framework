import { NextResponse } from 'next/server';
import { listAgents }   from '@/lib/gateway';

export async function GET() {
    const agents = await listAgents();
    return NextResponse.json(agents);
}
