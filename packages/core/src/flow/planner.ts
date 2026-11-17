import { z } from 'zod';
import { generateObject, generateObjectWith } from '../structured/generateObject';
import type { StructuredChat, GenerateObjectOptions } from '../structured/generateObject';
import type { LLMProvider } from '../types';
import { flowFromTaskPlan } from './convert';
import type { FlowDefinition } from './types';

export type { StructuredChat };

/**
 * The planner (SPEC-0023 F6b): from a task and the agents available, a model produces a plan that becomes a `FlowDefinition`,
 * ready for `runFlow`. A plan a model writes and a flow written in YAML are then the same object.
 *
 * The plan is validated before anything runs: duplicate ids, a dependency on an unknown step, an agent that does not exist
 * and cycles are rejected, and the model is told what was wrong and asked again (`retries`). An agent id invented by the
 * model would otherwise run as a no-op and look like success.
 */

export interface PlannerAgent {
    id: string;
    name?: string;
    description?: string;
    capabilities?: string[];
    domain?: string;
    /** Every step of this agent needs a person to review its output (`gate.approval: human`), whatever the model says. */
    gate?: boolean;
    /** Criteria the reviewer checks; added to those the model proposes. Only count when the step is gated. */
    gateCriteria?: string[];
}

/** The marker for a needed capability no agent covers. The step stays in the flow and is reported in `unresolved`. */
export const UNRESOLVED_AGENT = 'unresolved';

export interface PlanFlowOptions {
    agents: PlannerAgent[];
    /** The model: a provider, or any chat function (`StructuredChat`). One of the two. */
    provider?: LLMProvider;
    chat?: StructuredChat;
    /** Knowledge the plan should take into account (retrieved by the caller). */
    context?: string;
    /** Policy text for the planner, e.g. a MANDATORY GATES section: which domains need a gate and with what criteria. */
    policyContext?: string;
    /** Name of the flow. Default: the summary the model wrote. */
    flow?: string;
    /** Extra attempts after an invalid plan, each told what was wrong. Default 1. */
    retries?: number;
    signal?: AbortSignal;
    onMetrics?: GenerateObjectOptions['onMetrics'];
}

export interface PlannedFlow {
    flow: FlowDefinition;
    summary: string;
    /** Steps the model could not assign to any agent (`agent_id: "unresolved"`). Empty when the plan is complete. */
    unresolved: string[];
}

export const PLANNER_SYSTEM = `You are a task decomposition expert.
Given a task and a list of available specialist agents, produce a JSON execution plan.

Rules:
- Use only agent IDs from the provided list.
- depends_on: [] means the sub-task can start immediately; ["t1"] waits for t1 to finish.
- If no agent matches a needed capability, use agent_id="unresolved" and note the gap in the task.
- Keep each task description focused and self-contained.
- gate: set to true when a MANDATORY GATES section is present and the step's agent domain matches a governed domain. Always false otherwise.
- gate_criteria: when gate is true, copy the suggested criteria from the MANDATORY GATES section verbatim and add any task-specific criteria that the human approver should verify.`;

/** First dependency cycle as a path (a -> b -> a), or undefined. */
function findCycle(steps: Array<{ id: string; depends_on: string[] }>): string[] | undefined {
    const deps = new Map(steps.map(s => [s.id, s.depends_on]));
    const state = new Map<string, 'visiting' | 'done'>();
    const path: string[] = [];
    const visit = (id: string): string[] | undefined => {
        if (state.get(id) === 'done') return undefined;
        if (state.get(id) === 'visiting') return [...path.slice(path.indexOf(id)), id];
        state.set(id, 'visiting');
        path.push(id);
        for (const dep of deps.get(id) ?? []) {
            const found = visit(dep);
            if (found) return found;
        }
        path.pop();
        state.set(id, 'done');
        return undefined;
    };
    for (const s of steps) {
        const found = visit(s.id);
        if (found) return found;
    }
    return undefined;
}

function planSchema(agentIds: Set<string>) {
    return z.object({
        summary: z.string().min(1).describe('one-line description of the overall plan'),
        subtasks: z.array(z.object({
            id: z.string().min(1),
            agent_id: z.string().min(1).describe('id from the list of available agents, or "unresolved"'),
            task: z.string().min(1).describe('specific, actionable instruction for this specialist'),
            depends_on: z.array(z.string()).default([]),
            gate: z.boolean().optional(),
            gate_criteria: z.array(z.string()).optional(),
        })).min(1),
    }).superRefine((plan, ctx) => {
        const ids = new Set<string>();
        for (const st of plan.subtasks) {
            if (ids.has(st.id)) ctx.addIssue({ code: 'custom', message: `duplicate sub-task id: ${st.id}` });
            ids.add(st.id);
        }
        for (const st of plan.subtasks) {
            for (const dep of st.depends_on) {
                if (!ids.has(dep)) ctx.addIssue({ code: 'custom', message: `sub-task ${st.id} depends on unknown id: ${dep}` });
            }
            if (st.agent_id !== UNRESOLVED_AGENT && !agentIds.has(st.agent_id)) {
                ctx.addIssue({ code: 'custom', message: `sub-task ${st.id} uses unknown agent_id: ${st.agent_id}` });
            }
        }
        const cycle = findCycle(plan.subtasks);
        if (cycle) ctx.addIssue({ code: 'custom', message: `dependency cycle: ${cycle.join(' -> ')}` });
    });
}

export async function planFlow(task: string, opts: PlanFlowOptions): Promise<PlannedFlow> {
    if (!opts.provider && !opts.chat) throw new Error('planFlow needs a provider or a chat function');
    if (opts.agents.length === 0) throw new Error('planFlow needs at least one agent');

    const agentList = opts.agents.map(a => {
        const lines = [`- id: ${a.id}`];
        if (a.name) lines.push(`  name: ${a.name}`);
        if (a.description) lines.push(`  description: ${a.description}`);
        if (a.capabilities?.length) lines.push(`  capabilities: [${a.capabilities.join(', ')}]`);
        if (a.domain) lines.push(`  domain: ${a.domain}`);
        return lines.join('\n');
    }).join('\n');

    const prompt = [
        `Task: ${task}`,
        opts.context ? `\nKnowledge base context (use to inform the plan):\n${opts.context}\n` : '',
        opts.policyContext ? `\n${opts.policyContext}\n` : '',
        'Available agents:',
        agentList,
        '',
        'Produce the execution plan.',
    ].filter(Boolean).join('\n');

    const schema = planSchema(new Set(opts.agents.map(a => a.id)));
    const genOpts: GenerateObjectOptions = {
        system: PLANNER_SYSTEM, name: 'plan', retries: opts.retries ?? 1,
        ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.onMetrics ? { onMetrics: opts.onMetrics } : {}),
    };
    const plan = opts.chat
        ? await generateObjectWith(opts.chat, prompt, schema, genOpts)
        : await generateObject(opts.provider!, prompt, schema, genOpts);

    // An agent configured as gated gets its gate whatever the model said (as the executor did: `subtask.gate ?? agent.gate`).
    const byId = new Map(opts.agents.map(a => [a.id, a]));
    const subtasks = plan.subtasks.map(st => {
        const agent = byId.get(st.agent_id);
        const gated = st.gate === true || agent?.gate === true;
        return {
            ...st,
            gate: gated,
            gate_criteria: gated ? [...(agent?.gateCriteria ?? []), ...(st.gate_criteria ?? [])] : [],
        };
    });

    return {
        flow: flowFromTaskPlan({ summary: plan.summary, subtasks }, opts.flow ? { flow: opts.flow } : {}),
        summary: plan.summary,
        unresolved: subtasks.filter(s => s.agent_id === UNRESOLVED_AGENT).map(s => s.id),
    };
}
