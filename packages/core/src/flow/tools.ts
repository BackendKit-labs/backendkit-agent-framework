import { z } from 'zod';
import { defineTool } from '../tools/defineTool';
import type { ToolDefinition } from '../types';
import type { ApproverRef } from '../governance/types';
import type { FlowHandlerPort } from './handler';
import type { ApprovalHandlerPort } from './approval-handler';

/**
 * The flows and approvals of an agent as MCP-ready tools (SPEC-0023 F6c): a client (a director agent, Claude, a console) starts,
 * watches, pauses, resumes and cancels flows and decides what waits for a person, with no code of its own. They are plain
 * `ToolDefinition`s: serve them as `directTools` of `AgentMCPServer` (or `createToolServer`) and they get its policy, `authorize`,
 * audit and output cap.
 *
 * `flow_cancel` and `approval_decide` are `destructive` (they cannot be undone), so the server refuses to start them without an
 * `authorize` or a `policy`: someone has to decide who may call them.
 *
 * Who decides an approval is not what the model says: it is the `approver` configured here. A tool server driven by a model should
 * configure `{ kind: 'service', id: ... }`, which cannot satisfy an approval that needs a human (`accepts: ['human']`); `kind: 'human'`
 * is for a server whose caller is really a person (a console that shows the request before calling).
 */
export interface FlowToolsOptions {
    flows?: FlowHandlerPort;
    approvals?: ApprovalHandlerPort;
    /** Who the decisions are made as. Required with `approvals`. */
    approver?: ApproverRef;
    /** Prefix for the tool names. Default none (`flow_start`, `approval_decide`...). */
    prefix?: string;
}

const text = (v: unknown): string => JSON.stringify(v, null, 2);

export function createFlowTools(opts: FlowToolsOptions): ToolDefinition[] {
    if (!opts.flows && !opts.approvals) throw new Error('createFlowTools needs flows, approvals or both');
    if (opts.approvals && !opts.approver) throw new Error('createFlowTools: approvals need an approver (who decisions are made as)');
    const n = (name: string): string => `${opts.prefix ?? ''}${name}`;
    const tools: ToolDefinition[] = [];
    const runId = z.string().min(1).describe('id of the flow run (flowRunId)');

    if (opts.flows) {
        const flows = opts.flows;
        tools.push(
            defineTool({
                name: n('flow_list'), description: 'List the flows this agent hosts, with their steps.',
                input: z.object({}), readOnly: true,
                execute: async () => text(flows.flows()),
            }),
            defineTool({
                name: n('flow_start'), description: 'Start a flow. Returns the flowRunId to follow it by. Starting twice starts two runs.',
                input: z.object({
                    flow: z.string().min(1).describe('name of the flow, from flow_list'),
                    input: z.record(z.string(), z.unknown()).optional().describe('input of the flow (the payload)'),
                }),
                execute: async ({ flow, input }) => text(await flows.start(flow, input ?? {})),
            }),
            defineTool({
                name: n('flow_status'), description: 'Where a flow run is: its status, the current step and each step\'s state.',
                input: z.object({ flowRunId: runId }), readOnly: true,
                execute: async ({ flowRunId }) => text(await flows.status(flowRunId)),
            }),
            defineTool({
                name: n('flow_pause'), description: 'Pause a flow run at its next step boundary. Steps already running finish.',
                input: z.object({ flowRunId: runId }), idempotent: true,
                execute: async ({ flowRunId }) => text(await flows.pause(flowRunId)),
            }),
            defineTool({
                name: n('flow_resume'), description: 'Resume a paused flow run.',
                input: z.object({ flowRunId: runId }), idempotent: true,
                execute: async ({ flowRunId }) => text(await flows.resume(flowRunId)),
            }),
            defineTool({
                name: n('flow_cancel'), description: 'Cancel a flow run. Running steps are told to stop; it cannot be resumed.',
                input: z.object({ flowRunId: runId }), destructive: true, idempotent: true,
                execute: async ({ flowRunId }) => text(await flows.cancel(flowRunId)),
            }),
        );
    }

    if (opts.approvals) {
        const approvals = opts.approvals;
        const by = opts.approver!;
        tools.push(
            defineTool({
                name: n('approval_list'), description: 'List what waits for a person to approve (status "pending"), or what was decided.',
                input: z.object({ status: z.enum(['pending', 'approved', 'rejected', 'executed']).optional() }), readOnly: true,
                execute: async ({ status }) => text(await approvals.list(status ? { status } : {})),
            }),
            defineTool({
                name: n('approval_get'), description: 'One approval: what is asked, why, and for a flow step the output to review.',
                input: z.object({ id: z.string().min(1) }), readOnly: true,
                execute: async ({ id }) => text(await approvals.get(id)),
            }),
            defineTool({
                name: n('approval_decide'),
                description: 'Approve or reject a pending approval. Read it with approval_get first. A decision is final.',
                input: z.object({
                    id: z.string().min(1),
                    decision: z.enum(['approve', 'reject']),
                    reason: z.string().optional().describe('why; shown in the audit trail and to the requester'),
                }),
                destructive: true,
                execute: async ({ id, decision, reason }) => text(await approvals.decide(id, { decision, by, ...(reason ? { reason } : {}) })),
            }),
        );
    }
    return tools;
}
