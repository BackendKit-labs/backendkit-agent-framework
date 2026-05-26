import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import * as yaml from 'yaml';
import { getFrameworkDir } from '../../shared/utils/project-key';

export interface ManifestResult {
    rawContent: string | null;
    parsed: Record<string, unknown> | null;
    filePath: string | null;
    checksum: string;
}

export async function runStageManifest(
    appName: string
): Promise<{ checksum: string; data: ManifestResult }> {
    const filePath = path.join(getFrameworkDir(appName), 'manifest.yaml');

    let rawContent: string | null = null;
    let parsed: Record<string, unknown> | null = null;

    try {
        rawContent = await fs.readFile(filePath, 'utf-8');
        parsed = (yaml.parse(rawContent) as Record<string, unknown>) ?? null;
    } catch {
        // not present or unparseable
    }

    const checksum = rawContent
        ? createHash('sha256').update(rawContent, 'utf-8').digest('hex').slice(0, 16)
        : '';

    return {
        checksum,
        data: {
            rawContent,
            parsed,
            filePath: rawContent ? filePath : null,
            checksum,
        },
    };
}
