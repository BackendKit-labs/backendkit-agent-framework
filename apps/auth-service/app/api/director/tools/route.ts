import { NextResponse } from 'next/server';
import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';
import { DIRECTOR_TOOL_GROUPS, ALL_TOOLS } from '@/lib/tools';

const REGISTRY_PATH = process.env['DIRECTOR_REGISTRY_PATH']
    ?? path.join(os.homedir(), '.backendkit', 'auth', 'director-registry.json');

export async function GET() {
    try {
        const raw      = await fs.readFile(REGISTRY_PATH, 'utf-8');
        const registry = JSON.parse(raw);
        return NextResponse.json({ ...registry, fallback: false });
    } catch {
        // El director aún no corrió o el archivo no existe — fallback a tools estáticas
        return NextResponse.json({
            generated:       null,
            directorVersion: null,
            groups:          DIRECTOR_TOOL_GROUPS,
            allTools:        ALL_TOOLS,
            fallback:        true,
        });
    }
}
