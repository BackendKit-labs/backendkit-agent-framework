import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { getProjectDir } from '../../shared/utils/project-key';

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

    let content: string | null = null;
    try {
        content = await fs.readFile(filePath, 'utf-8');
    } catch {
        // not present
    }

    const checksum = content
        ? createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)
        : '';

    return {
        checksum,
        data: { content, filePath: content ? filePath : null, checksum },
    };
}
