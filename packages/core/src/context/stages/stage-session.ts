import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { run, isOk } from '@backendkit-labs/result';
import { getProjectDir } from '../../shared/utils/project-key';

export interface SessionResult {
    content: string | null;
    filePath: string | null;
    checksum: string;
    currentFeature: string | null;
    progress: string | null;
}

function extractFeatureName(content: string): string | null {
    const match = content.match(/\*\*Nombre:\*\*\s*(.+?)(?:\n|$)/);
    return match ? match[1].trim() : null;
}

function extractProgress(content: string): string | null {
    const match = content.match(/\*\*Progreso:\*\*\s*(.+?)(?:\n|$)/);
    return match ? match[1].trim() : null;
}

export async function runStageSession(
    cwd: string,
    appName: string
): Promise<{ checksum: string; data: SessionResult }> {
    const memoryDir = path.join(getProjectDir(appName, cwd), 'memory');
    const filePath = path.join(memoryDir, 'session.md');

    const fileResult = await run(() => fs.readFile(filePath, 'utf-8'));
    const content = isOk(fileResult) ? fileResult.value : null;

    const checksum = content
        ? createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)
        : '';

    return {
        checksum,
        data: {
            content,
            filePath: content ? filePath : null,
            checksum,
            currentFeature: content ? extractFeatureName(content) : null,
            progress: content ? extractProgress(content) : null,
        },
    };
}
