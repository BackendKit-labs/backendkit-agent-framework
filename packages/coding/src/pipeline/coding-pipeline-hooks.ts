import type { EngineHooks, RunContext } from '@backendkit-labs/agent-core';
import type { Orchestrator } from './orchestration/orchestrator';
import type { OrchestrationResult } from './orchestration/types';
import type { QAService } from './qa/qa-service';
import {
    advanceRequiredGates,
    activateQaEngineerIfNeeded,
    processQaEngineerResponse,
    processInlineQaReview,
    type QaContext,
} from './qa-orchestrator';

const STATE_KEY = 'coding-pipeline.orchestration';

export interface CodingPipelineHooksOptions {
    /** Classifies the task before the run (intent, risk, gates, agent pipeline) and drives the FSM. */
    orchestrator: Orchestrator;
    /** Reviews the final answer and records the QA gate. Without it only the brief and the classification apply. */
    qaService?: QAService;
    /** What `beforeRun` does when the orchestrator throws. 'closed' (default) fails the run; 'open' warns and runs without gates. */
    failureMode?: 'closed' | 'open';
    /** Skips the automatic QA review even when `qaService` is set. */
    noQA?: boolean;
    /** Called with every QA review. */
    onQAReview?: (review: string) => void;
    /** Agent that receives the orchestration brief. Default: the agent that starts the turn. */
    defaultAgentId?: string;
}

/** The orchestration brief for the default agent: which specialists to use, in what order, and which gates apply. */
export function buildOrchestrationBrief(result: OrchestrationResult): string {
    const { task, selectedAgents, agentPipeline, requiredGates } = result;

    const lines: string[] = ['## Orchestrator Analysis — Current Task'];

    const domains = task.domains.length > 0 ? task.domains.join(', ') : 'general';
    lines.push(`**Intent:** ${task.actionType} | **Risk:** ${task.riskLevel} | **Domains:** ${domains}`);

    // Only surface non-trivial agent selections (skip sole-fallback case)
    const nonFallback = selectedAgents.filter(a => !(a.agentId === 'general' && a.score <= 50));
    if (nonFallback.length > 0) {
        lines.push('\n**Recommended agents for this task (highest priority first):**');
        for (const a of nonFallback) {
            lines.push(`- ${a.agentId} — ${a.reason}`);
        }
        lines.push(
            '\nWhen delegating via ask_agent, prioritize the agents listed above. ' +
            'Do not delegate to unlisted agents unless the task explicitly requires it.'
        );
    }

    if (agentPipeline && agentPipeline.length > 0) {
        lines.push('\n**Suggested execution pipeline (respect this order):**');
        agentPipeline.forEach((phase, i) => {
            lines.push(`${i + 1}. [${phase.phase}] ${phase.agentId} — ${phase.purpose}`);
        });
    }

    if (requiredGates.length > 0) {
        lines.push(`\n**Required gates before commit:** ${requiredGates.join(', ')}`);
        lines.push('Ensure each gate is satisfied before considering the task complete.');
    }

    return lines.join('\n');
}

/**
 * The coding pipeline (orchestrator + QA gates) as engine hooks (SPEC-0015 F1):
 * - `beforeRun` classifies the task; the result lives in the turn's state.
 * - `systemPrompt` gives the default agent the brief.
 * - `afterTurn` advances the required gates and asks for a pass of the `qa-engineer` agent (or reviews inline).
 */
export function codingPipelineHooks(opts: CodingPipelineHooksOptions): EngineHooks {
    const get = (ctx: RunContext) => ctx.state.get(STATE_KEY) as OrchestrationResult | undefined;
    return {
        name: 'coding-pipeline',

        async beforeRun(ctx) {
            try {
                ctx.state.set(STATE_KEY, await opts.orchestrator.orchestrate(ctx.input));
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                if ((opts.failureMode ?? 'closed') === 'closed') {
                    throw new Error(`Orchestrator failed; refusing to run without its gates: ${reason}`);
                }
                ctx.emit({ type: 'system', level: 'warn', text: `[Orchestrator] failed (${reason}); running without classification or gates` });
            }
        },

        systemPrompt(ctx, profile) {
            const result = get(ctx);
            if (!result || profile.id !== (opts.defaultAgentId ?? ctx.principal.agentId)) return undefined;
            return buildOrchestrationBrief(result);
        },

        async afterTurn(ctx, turn) {
            const result = get(ctx);
            if (!result || !opts.qaService) return undefined;
            const qaAgentId = ctx.hasAgent('qa-engineer') ? 'qa-engineer' : undefined;
            const qaCtx: QaContext = {
                clean: turn.text,
                orchestrationResult: result,
                orchestrator: opts.orchestrator,
                qaService: opts.qaService,
                effectiveAgentId: turn.profile.id,
                hasAgent: ctx.hasAgent,
                qaAgentId,
                noQA: opts.noQA,
                onQAReview: opts.onQAReview,
            };

            await advanceRequiredGates(qaCtx);

            const qa = activateQaEngineerIfNeeded(qaCtx);
            if (qa) return { action: 'continue', agentId: qa.agentId, message: qa.message };

            if (qaAgentId && turn.profile.id === qaAgentId) await processQaEngineerResponse(qaCtx);
            else await processInlineQaReview(qaCtx);
            return undefined;
        },
    };
}
