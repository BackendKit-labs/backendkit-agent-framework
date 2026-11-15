import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { run, isOk } from '@backendkit-labs/result';
import { getProjectDir } from '@backendkit-labs/agent-core';

export interface ProjectResult {
    content: string | null;
    filePath: string | null;
    checksum: string;
}

export async function runStageProject(
    cwd: string,
    appName: string
): Promise<{ checksum: string; data: ProjectResult }> {
    const memoryDir = path.join(getProjectDir(appName, cwd), 'memory');
    const filePath = path.join(memoryDir, 'contexto-proyecto.md');

    const fileResult = await run(() => fs.readFile(filePath, 'utf-8'));
    const content = isOk(fileResult) ? fileResult.value : null;

    const checksum = content
        ? createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)
        : '';

    return {
        checksum,
        data: { content, filePath: content ? filePath : null, checksum },
    };
}
