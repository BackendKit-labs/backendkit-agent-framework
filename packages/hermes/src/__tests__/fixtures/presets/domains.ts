import { InProcessConnector } from '../../../connectors/InProcessConnector';
import type { InProcessFlow } from '../../../connectors/InProcessFlows';
import type { HermesPreset } from '../../../presets/applyPreset';

/**
 * Two presets from different domains, written the way a third party would write them. They live in the tests: Hermes itself knows
 * neither. Each brings agents, a flow and a blueprint, in its own words and its own role names.
 */

const LOCKED = { preset: 'read-only', approval: 'writes-and-commands', writeTools: ['write_file'] };

const agent = (id: string, description: string, role: string) => ({
    id, description, connector: { kind: 'in-process' as const }, access: { roles: [role], approval: 'never' as const },
});

export function accountingPreset(): HermesPreset {
    const closeMonth: InProcessFlow = {
        description: 'month-end close: collect entries, reconcile accounts, report',
        steps: ['collect', 'reconcile', 'report'],
        run: async (input, ctl) => {
            await ctl.step('collect');
            const entries = Number(input.entries ?? 0);
            await ctl.step('reconcile');
            const unmatched = Math.max(0, entries - 10);
            await ctl.step('report');
            return `closed ${String(input.month)}: ${entries} entries, ${unmatched} unmatched`;
        },
    };
    return {
        name: 'accounting-test',
        version: '0.1.0',
        description: 'Test double for an accounting company.',
        agents: [
            agent('ledger', 'posts journal entries and reports balances', 'accountant'),
            agent('reconciler', 'matches bank statements with ledger entries', 'accountant'),
            agent('books', 'runs the month-end close', 'accountant'),
        ],
        blueprints: [{
            id: 'audit-assistant', description: 'reviews journal entries for anomalies', template: 'single', tools: ['read_file'],
            sandbox: LOCKED, limits: { budgetUsdPerDay: 1 }, covers: ['audit journal entries', 'review anomalies'], createRoles: ['accountant'],
            access: { roles: ['accountant'], approval: 'never' },
        }],
        connectors: {
            ledger: () => new InProcessConnector({ name: 'ledger', capabilities: { post_entry: { description: 'post a journal entry', handler: async i => `posted ${JSON.stringify(i)}` } } }),
            reconciler: () => new InProcessConnector({ name: 'reconciler', capabilities: { reconcile_statement: { description: 'match a bank statement with ledger entries', handler: async () => 'matched' } } }),
            books: () => new InProcessConnector({ name: 'books', capabilities: {}, flows: { 'close-month': closeMonth } }),
        },
    };
}

export function supportPreset(): HermesPreset {
    const resolveTicket: InProcessFlow = {
        description: 'triage a customer ticket, draft the answer, close it',
        steps: ['triage', 'answer', 'close'],
        run: async (input, ctl) => {
            await ctl.step('triage');
            const urgent = /outage|down|urgent/i.test(String(input.subject ?? ''));
            await ctl.step('answer');
            await ctl.step('close');
            return `ticket ${String(input.ticket)} ${urgent ? 'escalated' : 'answered'}`;
        },
    };
    return {
        name: 'support-test',
        version: '0.1.0',
        description: 'Test double for a support desk.',
        agents: [
            agent('triage', 'classifies incoming customer tickets by urgency', 'agent'),
            agent('kb', 'searches the knowledge base for answers', 'agent'),
            agent('desk', 'runs the ticket resolution', 'agent'),
        ],
        blueprints: [{
            id: 'escalation-agent', description: 'handles urgent customer escalations', template: 'single', tools: ['read_file'],
            sandbox: LOCKED, limits: { budgetUsdPerDay: 1 }, covers: ['urgent escalation', 'customer outage'], createRoles: ['agent'],
            access: { roles: ['agent'], approval: 'never' },
        }],
        connectors: {
            triage: () => new InProcessConnector({ name: 'triage', capabilities: { classify_ticket: { description: 'classify a customer ticket by urgency', handler: async () => 'normal' } } }),
            kb: () => new InProcessConnector({ name: 'kb', capabilities: { search_articles: { description: 'search the knowledge base', handler: async () => '3 articles' } } }),
            desk: () => new InProcessConnector({ name: 'desk', capabilities: {}, flows: { 'resolve-ticket': resolveTicket } }),
        },
    };
}
