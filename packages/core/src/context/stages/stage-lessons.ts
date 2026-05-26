import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { getFrameworkDir, getProjectDir } from '../../shared/utils/project-key';

export interface LessonsResult {
    memo: string | null;
    fingerprints: Record<string, unknown> | null;
    fingerprintCount: number;
    memoPath: string | null;
    fingerprintsPath: string | null;
    checksum: string;
}

async function loadLessonsMemo(cwd: string, appName: string): Promise<string | null> {
    const auditsDir = path.join(getProjectDir(appName, cwd), 'audits');
    const filePath = path.join(auditsDir, 'lecciones-aprendidas.md');
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const sections = content.split('---');
        if (sections.length >= 3) {
            return sections[2]?.trim() ?? null;
        }
        return content.trim() || null;
    } catch {
        return null;
    }
}

async function loadLessonsFingerprints(appName: string): Promise<Record<string, unknown> | null> {
    const filePath = path.join(getFrameworkDir(appName), 'lessons-fingerprints.json');
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export async function runStageLessons(
    cwd: string,
    appName: string
): Promise<{ checksum: string; data: LessonsResult }> {
    const [memo, fingerprints] = await Promise.all([
        loadLessonsMemo(cwd, appName),
        loadLessonsFingerprints(appName),
    ]);

    const rawForHash = (memo ?? '') + '|' + JSON.stringify(fingerprints ?? {});
    const checksum = createHash('sha256').update(rawForHash, 'utf-8').digest('hex').slice(0, 16);

    const auditsDir = path.join(getProjectDir(appName, cwd), 'audits');

    return {
        checksum,
        data: {
            memo,
            fingerprints,
            fingerprintCount: fingerprints ? Object.keys(fingerprints).length : 0,
            memoPath: memo ? path.join(auditsDir, 'lecciones-aprendidas.md') : null,
            fingerprintsPath: fingerprints
                ? path.join(getFrameworkDir(appName), 'lessons-fingerprints.json')
                : null,
            checksum,
        },
    };
}
