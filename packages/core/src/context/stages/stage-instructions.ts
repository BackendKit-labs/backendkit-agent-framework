import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { getFrameworkDir } from '../../shared/utils/project-key';

export interface InstructionsResult {
    agentMd: string | null;
    userMd: string | null;
    agentMdPath: string | null;
    userMdPath: string | null;
    checksum: string;
}

export async function runStageInstructions(
    cwd: string,
    appName: string
): Promise<{ checksum: string; data: InstructionsResult }> {
    const globalDir = getFrameworkDir(appName);

    const agentMdPath = path.join(cwd, 'AGENT.md');
    let agentMd: string | null = null;
    try {
        agentMd = await fs.readFile(agentMdPath, 'utf-8');
    } catch {
        // not present
    }

    const userMdLocal = path.join(cwd, 'USER.md');
    const userMdGlobal = path.join(globalDir, 'USER.md');
    let userMd: string | null = null;
    let userMdPath: string | null = null;

    try {
        userMd = await fs.readFile(userMdLocal, 'utf-8');
        userMdPath = userMdLocal;
    } catch {
        try {
            userMd = await fs.readFile(userMdGlobal, 'utf-8');
            userMdPath = userMdGlobal;
        } catch {
            // not present
        }
    }

    const combined = (agentMd ?? '') + '|' + (userMd ?? '');
    const checksum = createHash('sha256').update(combined, 'utf-8').digest('hex').slice(0, 16);

    return {
        checksum,
        data: {
            agentMd,
            userMd,
            agentMdPath: agentMd ? agentMdPath : null,
            userMdPath,
            checksum,
        },
    };
}
