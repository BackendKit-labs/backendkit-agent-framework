import { defineTool, z } from '../tools/defineTool';
import type { JobInfo } from './JobRegistry';

const NO_JOBS = 'Error: background jobs are not enabled';

const describeJob = (j: JobInfo) => `${j.id} [${j.status}]${j.summary ? ` — ${j.summary}` : ''}`;

export const jobOutputTool = defineTool({
    name: 'job_output',
    description:
        'Read the output of a background job started by this agent. Pass `since_offset` (the `next_offset` of the previous read) ' +
        'to get only new output; `wait_ms` waits for new output or completion before answering.',
    input: z.object({
        id: z.string().describe('Job id, e.g. "bash-1"'),
        since_offset: z.number().int().min(0).optional(),
        wait_ms: z.number().int().min(0).max(60_000).optional(),
    }),
    execute: async ({ id, since_offset, wait_ms }, ctx) => {
        if (!ctx.jobs) return NO_JOBS;
        try {
            const out = await ctx.jobs.output(id, ctx.agentId, { sinceOffset: since_offset, waitMs: wait_ms });
            const info = ctx.jobs.get(id, ctx.agentId);
            return `[${id} ${info?.status ?? 'unknown'}${info?.summary ? ` — ${info.summary}` : ''} | next_offset=${out.nextOffset}${out.done ? ' | finished' : ''}]\n${out.text}`;
        } catch {
            return `Error: job ${id} not found`;
        }
    },
});

export const jobListTool = defineTool({
    name: 'job_list',
    description: "List this agent's background jobs (running and recently finished).",
    input: z.object({}),
    execute: async (_args, ctx) => {
        if (!ctx.jobs) return NO_JOBS;
        const jobs = ctx.jobs.list(ctx.agentId);
        return jobs.length ? jobs.map(describeJob).join('\n') : '(no background jobs)';
    },
});

export const jobKillTool = defineTool({
    name: 'job_kill',
    description: 'Cancel a running background job started by this agent.',
    input: z.object({ id: z.string() }),
    execute: async ({ id }, ctx) => {
        if (!ctx.jobs) return NO_JOBS;
        return (await ctx.jobs.cancel(id, ctx.agentId)) ? `Job ${id} cancelled` : `Error: job ${id} not found or not running`;
    },
});

export const JOB_TOOLS = [jobOutputTool, jobListTool, jobKillTool];
