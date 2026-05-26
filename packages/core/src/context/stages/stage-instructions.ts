import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { run, isOk } from '@backendkit-labs/result';
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

    const agentResult = await run(() => fs.readFile(agentMdPath, 'utf-8'));
    const agentMd = isOk(agentResult) ? agentResult.value : null;

    const userMdLocal = path.join(cwd, 'USER.md');
    const userMdGlobal = path.join(globalDir, 'USER.md');
    let userMd: string | null = null;
    let userMdPath: string | null = null;

    const localResult = await run(() => fs.readFile(userMdLocal, 'utf-8'));
    if (isOk(localResult)) {
        userMd = localResult.value;
        userMdPath = userMdLocal;
    } else {
        const globalResult = await run(() => fs.readFile(userMdGlobal, 'utf-8'));
        if (isOk(globalResult)) {
            userMd = globalResult.value;
            userMdPath = userMdGlobal;
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
