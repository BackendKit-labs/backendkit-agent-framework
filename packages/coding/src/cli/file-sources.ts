import { isOk } from '@backendkit-labs/result';
import type { AgentSource, InstructionLayer, InstructionSource } from '@backendkit-labs/agent-core';
import { discoverAgents } from './agent-discovery';
import type { AgentDiscoveryConfig } from './agent-discovery';
import { runContextPipeline, StageCache } from './context';

/** Agents from `~/.{appName}/agents`, `{workingDir}/.{appName}/agents` and, if configured, a remote registry. */
export function fileAgentSource(config: AgentDiscoveryConfig): AgentSource {
    return { list: () => discoverAgents(config) };
}

export interface FileInstructionSourceOptions {
    /** Names `~/.{appName}/` (USER.md, lessons, manifest). */
    appName: string;
    cwd?: string;
    cache?: StageCache;
}

/**
 * Instruction layers from the files of a terminal app: `AGENT.md`, `USER.md`, the project context, the session
 * notes and the lessons memo. Add it to `instructionSources` of `createBaseEngine`.
 */
export function fileInstructionSource(opts: FileInstructionSourceOptions): InstructionSource {
    const cache = opts.cache ?? new StageCache();
    return {
        async load(ctx) {
            const result = await runContextPipeline({ appName: opts.appName, cwd: ctx.cwd ?? opts.cwd, cache });
            if (!isOk(result)) throw result.error;
            const r = result.value;
            const layers: InstructionLayer[] = [];
            if (r.instructions.agentMd) layers.push({ title: 'Project Instructions (AGENT.md)', content: r.instructions.agentMd });
            if (r.instructions.userMd) layers.push({ title: 'Developer Preferences (USER.md)', content: r.instructions.userMd });
            if (r.project.content) layers.push({ title: 'Project Context', content: r.project.content });
            if (r.session.content) layers.push({ title: 'Active Session', content: r.session.content });
            if (r.lessons.memo) {
                // The memo is generated text: strip every tag, not only the role ones.
                const memo = r.lessons.memo.replace(/<\/?[a-zA-Z][^>]*>/g, '');
                layers.push({ title: 'Lessons Learned (from previous audits)', content: memo, maxChars: 3000 });
            }
            return layers;
        },
    };
}
