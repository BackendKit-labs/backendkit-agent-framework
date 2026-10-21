import { defineTool, z } from '@backendkit-labs/agent-core';

export const saveAuditTool = defineTool({
    name: 'save_audit',
    description: "Save the results of a project audit (security, QA, architecture, etc.) with today's date.",
    input: z.object({
        agent_id: z.string().min(1).describe('Agent ID performing the audit (e.g. security, qa-engineer)'),
        content:  z.string().min(1).describe('Full audit report in markdown'),
    }),
    execute: async ({ agent_id, content }, ctx) => {
        if (!ctx.store) return 'Error: no persistent store configured';
        ctx.store.saveAudit(agent_id, content);
        return `Audit saved for agent "${agent_id}".`;
    },
});

export const getLatestAuditTool = defineTool({
    name: 'get_latest_audit',
    concurrencySafe: true,
    description: 'Retrieve the most recent audit report for a given agent type.',
    input: z.object({
        agent_id: z.string().min(1).describe('Agent ID to retrieve audit for (e.g. security, qa-engineer)'),
    }),
    execute: async ({ agent_id }, ctx) => {
        if (!ctx.store) return 'Error: no persistent store configured';
        return ctx.store.getLatestAudit(agent_id) ?? `No previous audit found for "${agent_id}".`;
    },
});

export const listAuditsTool = defineTool({
    name: 'list_audits',
    concurrencySafe: true,
    description: 'List all saved audit files for this project.',
    input: z.object({}),
    execute: async (_args, ctx) => {
        if (!ctx.store) return 'Error: no persistent store configured';
        const audits = ctx.store.listAudits();
        return audits.length > 0 ? audits.join('\n') : 'No audits saved yet.';
    },
});
