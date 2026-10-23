import { InProcessConnector } from '../connectors/InProcessConnector';
import type { InProcessFlow } from '../connectors/InProcessFlows';
import type { HermesPreset } from './applyPreset';

/**
 * The neutral reference preset: a pipeline of four stages — ingest, process, review, deliver — each an agent, plus a
 * `pipeline` agent that hosts the flow running them in order. It does nothing useful by itself; it shows what a preset
 * contains and is what the tests use to prove a preset loads. A real domain replaces the stage handlers.
 *
 * Roles: `pipeline-user` may use the agents. The operator maps it to their own roles with `roleMap`.
 */

export type StageHandler = (input: Record<string, unknown>) => Promise<unknown> | unknown;

export interface PipelineStages {
    ingest: StageHandler;
    process: StageHandler;
    review: StageHandler;
    deliver: StageHandler;
}

/** Stages that work on a list of text items: trimmed, normalised, checked for emptiness and length, counted. */
export const defaultStages = (): PipelineStages => ({
    ingest: input => ({ items: (Array.isArray(input.items) ? input.items : []).map(String).map(s => s.trim()).filter(Boolean) }),
    process: input => ({ items: (Array.isArray(input.items) ? input.items : []).map(s => String(s).toUpperCase()) }),
    review: input => {
        const items = (Array.isArray(input.items) ? input.items : []).map(String);
        const long = items.filter(s => s.length > 200);
        return { approved: items.length > 0 && long.length === 0, issues: long.length ? [`${long.length} item(s) over 200 characters`] : items.length ? [] : ['nothing to review'], items };
    },
    deliver: input => ({ delivered: Array.isArray(input.items) ? input.items.length : 0 }),
});

const STAGES = ['ingest', 'process', 'review', 'deliver'] as const;
const stageAgent = (id: string) => ({
    id, description: `pipeline stage: ${id}`, connector: { kind: 'in-process' as const },
    access: { roles: ['pipeline-user'], approval: 'never' as const },
});

export function pipelinePreset(stages: PipelineStages = defaultStages()): HermesPreset {
    const flow: InProcessFlow = {
        description: 'ingest, process, review and deliver a batch of items',
        steps: [...STAGES],
        run: async (input, ctl) => {
            let data: Record<string, unknown> = input;
            for (const stage of STAGES) {
                await ctl.step(stage);
                const out = await stages[stage](data) as Record<string, unknown>;
                if (stage === 'review' && out.approved === false) throw new Error(`review rejected the batch: ${((out.issues as string[]) ?? []).join('; ')}`);
                data = { ...data, ...out };
            }
            return JSON.stringify(data);
        },
    };

    return {
        name: 'pipeline',
        version: '1.0.0',
        description: 'Neutral reference preset: ingest, process, review, deliver.',
        agents: [
            ...STAGES.map(stageAgent),
            { id: 'pipeline', description: 'runs the four stages in order as one flow', connector: { kind: 'in-process' as const }, access: { roles: ['pipeline-user'], approval: 'never' as const } },
        ],
        connectors: {
            ...Object.fromEntries(STAGES.map(stage => [stage, () => new InProcessConnector({
                name: stage, description: `pipeline stage: ${stage}`,
                capabilities: { [stage]: { description: `${stage} a batch of items`, handler: async input => JSON.stringify(await stages[stage](input)) } },
            })])),
            pipeline: () => new InProcessConnector({ name: 'pipeline', capabilities: {}, flows: { 'run-pipeline': flow } }),
        },
    };
}
