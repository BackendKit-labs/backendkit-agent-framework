import { runStageInstructions, InstructionsResult } from './stages/stage-instructions';
import { runStageProject, ProjectResult } from './stages/stage-project';
import { runStageSession, SessionResult } from './stages/stage-session';
import { runStageManifest, ManifestResult } from './stages/stage-manifest';
import { runStageLessons, LessonsResult } from './stages/stage-lessons';

export interface PipelineResult {
    instructions: InstructionsResult;
    project: ProjectResult;
    session: SessionResult;
    manifest: ManifestResult;
    lessons: LessonsResult;
    meta: {
        executedAt: string;
        changedStages: string[];
        elapsedMs: number;
    };
}

export interface PipelineChecksums {
    instructions: string;
    project: string;
    session: string;
    manifest: string;
    lessons: string;
}

interface StageCacheEntry<T> {
    checksum: string;
    data: T;
}

export class StageCache {
    private store = new Map<string, StageCacheEntry<unknown>>();

    get<T>(key: string): StageCacheEntry<T> | null {
        const entry = this.store.get(key);
        return entry ? (entry as StageCacheEntry<T>) : null;
    }

    set<T>(key: string, checksum: string, data: T): void {
        this.store.set(key, { checksum, data });
    }

    getChecksums(): PipelineChecksums {
        return {
            instructions: (this.store.get('instructions')?.checksum as string) ?? '',
            project: (this.store.get('project')?.checksum as string) ?? '',
            session: (this.store.get('session')?.checksum as string) ?? '',
            manifest: (this.store.get('manifest')?.checksum as string) ?? '',
            lessons: (this.store.get('lessons')?.checksum as string) ?? '',
        };
    }
}

export interface PipelineConfig {
    /** Application name — determines storage directory (e.g. 'deepseek-code' -> ~/.deepseek-code/) */
    appName: string;
    cwd?: string;
    cache?: StageCache;
    forceRefresh?: boolean;
}

export async function runContextPipeline(config: PipelineConfig): Promise<PipelineResult> {
    const start = Date.now();
    const { appName } = config;
    const cache = config.cache ?? new StageCache();
    const cwd = config.cwd ?? process.cwd();
    const forceRefresh = config.forceRefresh ?? false;

    const changedStages: string[] = [];

    const instructionsResult = await runStageWithCache(
        'instructions', cache, forceRefresh,
        () => runStageInstructions(cwd, appName),
        () => changedStages.push('instructions'),
    );

    const projectResult = await runStageWithCache(
        'project', cache, forceRefresh,
        () => runStageProject(cwd, appName),
        () => changedStages.push('project'),
    );

    const sessionResult = await runStageWithCache(
        'session', cache, forceRefresh,
        () => runStageSession(cwd, appName),
        () => changedStages.push('session'),
    );

    const manifestResult = await runStageWithCache(
        'manifest', cache, forceRefresh,
        () => runStageManifest(appName),
        () => changedStages.push('manifest'),
    );

    const lessonsResult = await runStageWithCache(
        'lessons', cache, forceRefresh,
        () => runStageLessons(cwd, appName),
        () => changedStages.push('lessons'),
    );

    return {
        instructions: instructionsResult,
        project: projectResult,
        session: sessionResult,
        manifest: manifestResult,
        lessons: lessonsResult,
        meta: {
            executedAt: new Date().toISOString(),
            changedStages,
            elapsedMs: Date.now() - start,
        },
    };
}

async function runStageWithCache<T>(
    key: string,
    cache: StageCache,
    forceRefresh: boolean,
    runner: () => Promise<{ checksum: string; data: T }>,
    onChanged: () => void,
): Promise<T> {
    if (!forceRefresh) {
        const cached = cache.get<T>(key);
        if (cached) {
            const fresh = await runner();
            if (fresh.checksum === cached.checksum) return cached.data;
            cache.set(key, fresh.checksum, fresh.data);
            onChanged();
            return fresh.data;
        }
    }

    const fresh = await runner();
    cache.set(key, fresh.checksum, fresh.data);
    onChanged();
    return fresh.data;
}

export function formatPipelineForPrompt(result: PipelineResult): string[] {
    const sections: string[] = [];

    if (result.instructions.agentMd) {
        sections.push(formatSection('Instrucciones del Proyecto (AGENT.md)', result.instructions.agentMd));
    }
    if (result.instructions.userMd) {
        sections.push(formatSection('Preferencias del Desarrollador (USER.md)', result.instructions.userMd));
    }
    if (result.project.content) {
        sections.push(formatSection('Contexto del Proyecto', result.project.content));
    }
    if (result.session.content) {
        sections.push(formatSection('Sesion Activa', result.session.content));
    }
    if (result.lessons.memo) {
        const sanitized = result.lessons.memo
            .replace(/<\/?[a-zA-Z][^>]*>/g, '')
            .replace(/\[INST\]|\[\/INST\]/g, '')
            .replace(/<<SYS>>|<\/SYS>/g, '')
            .replace(/^(SYSTEM:|ASSISTANT:|USER:)\s*/gim, '')
            .slice(0, 3000);
        sections.push(formatSection('Lecciones Aprendidas (de auditorias previas)', sanitized));
    }

    return sections;
}

function formatSection(title: string, content: string): string {
    return [
        '',
        `## ${title}`,
        '> Cargado por el Context Pipeline',
        '',
        content.trim(),
        '',
    ].join('\n');
}
