import { randomUUID } from 'node:crypto';
import { defineTool, z } from '@backendkit-labs/agent-core';
import type { ToolDefinition } from '@backendkit-labs/agent-core';

export interface N8nTriggerOptions {
    /** n8n webhook URL. Falls back to the N8N_WEBHOOK_URL environment variable. */
    webhookUrl?: string;
}

/**
 * Creates the `n8n_trigger` tool.
 * POST to the configured n8n webhook with `{ event, correlationId, ...payload }`.
 * Throws if no URL is configured at construction time.
 */
export function createN8nTriggerTool(opts: N8nTriggerOptions = {}): ToolDefinition {
    const url = opts.webhookUrl ?? process.env.N8N_WEBHOOK_URL;
    if (!url) {
        throw new Error('n8n_trigger requires opts.webhookUrl or the N8N_WEBHOOK_URL env var');
    }

    return defineTool({
        name: 'n8n_trigger',
        description:
            'Trigger an n8n workflow by POSTing an event payload to a webhook. ' +
            'Returns the correlation ID so the workflow execution can be traced.',
        input: z.object({
            event: z.string().describe(
                'Event type / workflow trigger name (e.g. "employee.onboarded", "invoice.approved")',
            ),
            payload: z.record(z.string(), z.unknown()).describe(
                'Arbitrary data forwarded to n8n as the request body alongside the event and correlationId',
            ),
            correlation_id: z.string().optional().describe(
                'Correlation ID for distributed tracing — auto-generated (UUID v4) when omitted',
            ),
        }),
        execute: async ({ event, payload, correlation_id }) => {
            const corrId = correlation_id ?? randomUUID();
            const body   = JSON.stringify({ event, correlationId: corrId, ...payload });
            const res    = await fetch(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            if (!res.ok) {
                throw new Error(`n8n webhook failed (${res.status}): ${await res.text()}`);
            }
            const responseText = (await res.text()).slice(0, 500);
            return [
                `n8n workflow triggered — event: "${event}"`,
                `correlationId: ${corrId}`,
                ...(responseText ? [`n8n response: ${responseText}`] : []),
            ].join('\n');
        },
    });
}
