/** Shared by the tests: what the scripted model says, who answers an approval, and the advisor built the same way every time. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ApprovalRequest, type Approver, type AuditEvent } from '@backendkit-labs/agent-core';
import { mockTransport, scriptedProvider, type Turn } from '@backendkit-labs/agent-testkit';
import { EXECUTOR, createAdvisor, buildOperator, SimulatedBroker, type AdvisorOptions } from '../index';

// What the scripted model says, in the order the agents speak.
export const ask = (agent: string, question: string): Turn => ({ tool_calls: [{ id: `a-${agent}`, name: 'ask_agent', args: { agent_id: agent, question } }] });
export const call = (name: string, args: Record<string, unknown> = {}): Turn => ({ tool_calls: [{ id: `c-${name}`, name, args }] });
export const say = (content: string): Turn => ({ content });

/** The orchestrator sends an order through the executor: the three turns of the executor are the call and its answer. */
export const tradeScript = (order: Record<string, unknown>): Turn[] => [
    ask(EXECUTOR, 'send this order'), call('place_order', order), say('the executor answered'), say('finished'),
];
export const small = { symbol: 'BBB', side: 'buy', quantity: 20, amount: 1_000, currency: 'EUR' };         // within the 5,000 EUR the executor may do alone
export const large = { symbol: 'AAA', side: 'sell', quantity: 60, amount: 6_000, currency: 'EUR' };        // above it

/** An approver that answers as `id` and remembers what it was asked. */
export function answerAs(id: string, asked: ApprovalRequest[] = []): Approver {
    return {
        ref: { kind: 'human', id },
        request: async (req) => { asked.push(req); return { decision: 'approve', by: { kind: 'human', id }, at: new Date().toISOString() }; },
    };
}
export const nobody: Approver = { ref: { kind: 'human', id: 'nobody' }, request: async () => ({ decision: 'reject', by: { kind: 'human', id: 'nobody' }, at: new Date().toISOString() }) };

export interface Setup { script: Turn[]; /** The operator of a previous advisor: a restart keeps the keys of the agents and of the issuer. */ op?: ReturnType<typeof buildOperator>; /** The broker of a previous advisor: a restart keeps the money where it was. */ broker?: SimulatedBroker; /** The file of the audit log; one per advisor when a test builds two. */ audit?: string; approver?: Approver; userId?: string; mutate?: (o: AdvisorOptions, op: ReturnType<typeof buildOperator>) => void }

export function setup(s: Setup, dir: string) {
    const op = s.op ?? buildOperator({ userId: s.userId ?? 'carlos' });
    const broker = s.broker ?? new SimulatedBroker({ cash: 10_000, holdings: { AAA: 60, BBB: 20 } });
    const auditLogPath = join(dir, s.audit ?? 'audit.ndjson');
    const options: AdvisorOptions = {
        provider: scriptedProvider(s.script), transport: mockTransport().transport, userId: op.userId, broker, targets: { AAA: 0.2, BBB: 0.4 },
        identities: op.identities, credentials: op.credentials(), trustedIssuers: op.trustedIssuers, directory: op.directory,
        approver: s.approver ?? nobody, auditLogPath,
    };
    s.mutate?.(options, op);
    const advisor = createAdvisor(options);
    const events = (): AuditEvent[] => readFileSync(auditLogPath, 'utf8').split('\n').filter(Boolean).map(l => (JSON.parse(l) as { event: AuditEvent }).event);
    const order = () => events().find(e => e.tool === 'place_order');
    return { advisor, broker, op, auditLogPath, events, order, run: () => advisor.engine.run('rebalance my portfolio') };
}

