import { run, type Result } from '@backendkit-labs/result';
import { runStageInstructions, InstructionsResult } from './stages/stage-instructions';
import { runStageProject, ProjectResult } from './stages/stage-project';
import { runStageSession, SessionResult } from './stages/stage-session';
import { runStageManifest, ManifestResult } from './stages/stage-manifest';
import { runStageLessons, LessonsResult } from './stages/stage-lessons';

export type { Result };

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

export async function runContextPipeline(config: PipelineConfig): Promise<Result<PipelineResult, Error>> {
    return run(async () => {
        const start = Date.now();
        const { appName } = config;
        const cache = config.cache ?? new StageCache();
        const cwd = config.cwd ?? process.cwd();
        const forceRefresh = config.forceRefresh ?? false;

        const changedStages: string[] = [];

        const instructions = await runStageWithCache(
            'instructions', cache, forceRefresh,
            () => runStageInstructions(cwd, appName),
            () => changedStages.push('instructions'),
        );

        const project = await runStageWithCache(
            'project', cache, forceRefresh,
            () => runStageProject(cwd, appName),
            () => changedStages.push('project'),
        );

        const session = await runStageWithCache(
            'session', cache, forceRefresh,
            () => runStageSession(cwd, appName),
            () => changedStages.push('session'),
        );

        const manifest = await runStageWithCache(
            'manifest', cache, forceRefresh,
            () => runStageManifest(appName),
            () => changedStages.push('manifest'),
        );

        const lessons = await runStageWithCache(
            'lessons', cache, forceRefresh,
            () => runStageLessons(cwd, appName),
            () => changedStages.push('lessons'),
        );

        return {
            instructions,
            project,
            session,
            manifest,
            lessons,
            meta: {
                executedAt: new Date().toISOString(),
                changedStages,
                elapsedMs: Date.now() - start,
            },
        };
    });
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

/**
 * Files on disk (AGENT.md, USER.md, project context, session notes, lessons) end up inside the
 * system prompt and anyone who can write a file in the repo can write them. Remove what lets a
 * file impersonate the conversation: chat-template delimiters ([INST], <<SYS>>, <|im_start|>),
 * role tags (<system>, <assistant>...) and line-leading role prefixes (SYSTEM:, ASSISTANT:, USER:).
 * Ordinary markup and generics (Promise<void>, <details>) are kept, and so are the instructions
 * themselves: AGENT.md is meant to guide the agent.
 */
export function sanitizeDiskContent(content: string): string {
    return content
        .replace(/\[\/?INST\]|<<\/?SYS>>/g, '')
        .replace(/<\|[a-z_]+\|>/gi, '')
        .replace(/<\/?(?:system|assistant|user|human|instructions?|tool_call|function_calls?)\b[^>]*>/gi, '')
        .replace(/^(?:SYSTEM|ASSISTANT|USER|HUMAN):[ \t]*/gim, '');
}

export function formatPipelineForPrompt(result: PipelineResult): string[] {
    const sections: string[] = [];

    if (result.instructions.agentMd) {
        sections.push(formatSection('Project Instructions (AGENT.md)', sanitizeDiskContent(result.instructions.agentMd)));
    }
    if (result.instructions.userMd) {
        sections.push(formatSection('Developer Preferences (USER.md)', sanitizeDiskContent(result.instructions.userMd)));
    }
    if (result.project.content) {
        sections.push(formatSection('Project Context', sanitizeDiskContent(result.project.content)));
    }
    if (result.session.content) {
        sections.push(formatSection('Active Session', sanitizeDiskContent(result.session.content)));
    }
    if (result.lessons.memo) {
        const sanitized = result.lessons.memo
            .replace(/<\/?[a-zA-Z][^>]*>/g, '')
            .replace(/\[INST\]|\[\/INST\]/g, '')
            .replace(/<<SYS>>|<\/SYS>/g, '')
            .replace(/^(SYSTEM:|ASSISTANT:|USER:)\s*/gim, '')
            .slice(0, 3000);
        sections.push(formatSection('Lessons Learned (from previous audits)', sanitized));
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
