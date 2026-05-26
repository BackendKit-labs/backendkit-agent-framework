import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

export const saveAuditTool: ToolDefinition = {
    name: 'save_audit',
    description: 'Save the results of a project audit (security, QA, architecture, etc.) with today\'s date. Use get_latest_audit to retrieve previous audits before repeating work.',
    parameters: {
        type: 'object',
        properties: {
            agent_id: { type: 'string', description: 'ID of the agent performing the audit (e.g. security, qa-engineer, architecture)' },
            content:  { type: 'string', description: 'Full audit report in markdown' },
        },
        required: ['agent_id', 'content'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { agent_id, content } = args as { agent_id: string; content: string };
        if (!ctx.store) return 'Error: no persistent store configured';
        ctx.store.saveAudit(agent_id, content);
        return `Audit saved for agent "${agent_id}".`;
    },
};

export const getLatestAuditTool: ToolDefinition = {
    name: 'get_latest_audit',
    description: 'Retrieve the most recent audit report for a given agent type.',
    parameters: {
        type: 'object',
        properties: {
            agent_id: { type: 'string', description: 'Agent ID to retrieve audit for (e.g. security, qa-engineer)' },
        },
        required: ['agent_id'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { agent_id } = args as { agent_id: string };
        if (!ctx.store) return 'Error: no persistent store configured';
        const audit = ctx.store.getLatestAudit(agent_id);
        return audit ?? `No previous audit found for "${agent_id}".`;
    },
};

export const listAuditsTool: ToolDefinition = {
    name: 'list_audits',
    description: 'List all saved audit files for this project.',
    parameters: { type: 'object', properties: {} },
    async execute(_args: unknown, ctx: ExecutionContext) {
        if (!ctx.store) return 'Error: no persistent store configured';
        const audits = ctx.store.listAudits();
        return audits.length > 0 ? audits.join('\n') : 'No audits saved yet.';
    },
};
