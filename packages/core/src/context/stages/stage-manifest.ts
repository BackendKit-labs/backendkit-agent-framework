import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import * as yaml from 'yaml';
import { run, isOk, fromThrowable } from '@backendkit-labs/result';
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

    const fileResult = await run(() => fs.readFile(filePath, 'utf-8'));
    const rawContent = isOk(fileResult) ? fileResult.value : null;
    const parseResult = rawContent ? fromThrowable(() => yaml.parse(rawContent) as Record<string, unknown>) : null;
    const parsed = parseResult && isOk(parseResult) ? parseResult.value ?? null : null;

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
