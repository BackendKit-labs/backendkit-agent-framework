import { defineTool, z } from '@backendkit-labs/agent-core';

// Example tool — replace with tools that connect to your business systems
// e.g. CRM lookup, ticketing system, internal APIs, databases

export const exampleAction = defineTool({
    name:        'create_ticket',
    description: 'Creates a support ticket in the ticketing system (example — replace with your integration)',
    input: z.object({
        title:    z.string().describe('Short description of the issue'),
        priority: z.enum(['low', 'medium', 'high']).describe('Ticket priority'),
        details:  z.string().optional().describe('Additional details'),
    }),
    execute: async ({ title, priority, details }) => {
        // TODO: integrate with your ticketing system (Jira, ServiceNow, Linear, etc.)
        const id = `TICKET-${Date.now()}`;
        return `Ticket created: ${id} — "${title}" [${priority}]${details ? `\nDetails: ${details}` : ''}`;
    },
});
