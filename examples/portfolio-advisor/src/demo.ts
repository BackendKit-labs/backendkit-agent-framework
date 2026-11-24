/**
 * A session you can watch: `npm run demo`. The model is SCRIPTED (it does what the script says, no key and no network), so what you see is what the
 * framework decides around it: who may do what, what asks a person, what is refused, and what the audit can prove afterwards.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAuditChain, type ApprovalRequest, type Approver, type AuditEvent } from '@backendkit-labs/agent-core';
import { mockTransport, scriptedProvider, type Turn } from '@backendkit-labs/agent-testkit';
import { ANALYST, EXECUTOR, REBALANCER, buildOperator, createAdvisor, SimulatedBroker } from './index';

const ask = (agent: string, question: string): Turn => ({ tool_calls: [{ id: `a-${agent}`, name: 'ask_agent', args: { agent_id: agent, question } }] });
const call = (name: string, args: Record<string, unknown> = {}): Turn => ({ tool_calls: [{ id: `c-${name}`, name, args }] });
const say = (content: string): Turn => ({ content });
const order = (symbol: string, side: 'buy' | 'sell', quantity: number, price: number) => ({ symbol, side, quantity, amount: quantity * price, currency: 'EUR' });

const line = (text = '') => process.stdout.write(`${text}\n`);
const title = (text: string) => line(`\n\x1b[1m── ${text}\x1b[0m`);

/** A person who answers an ask; it prints what they were shown, so you see what a real approver would see. */
const person = (id: string): Approver => ({
    ref: { kind: 'human', id },
    request: async (req: ApprovalRequest) => {
        line(`   ? asks ${id}: ${req.reason ?? '(no reason)'}`);
        return { decision: 'approve', by: { kind: 'human', id }, at: new Date().toISOString() };
    },
});
const nobody: Approver = { ref: { kind: 'human', id: 'nobody' }, request: async () => ({ decision: 'reject', by: { kind: 'human', id: 'nobody' }, at: new Date().toISOString() }) };

async function main() {
    const dir = mkdtempSync(join(tmpdir(), 'portfolio-demo-'));
    const op = buildOperator({ userId: 'carlos' });
    const broker = new SimulatedBroker({ cash: 10_000, holdings: { AAA: 60, BBB: 20 } });
    const targets = { AAA: 0.2, BBB: 0.4 };
    const auditLogPath = join(dir, 'audit.ndjson');
    const events = (): AuditEvent[] => !existsSync(auditLogPath) ? [] : readFileSync(auditLogPath, 'utf8').split('\n').filter(Boolean).map(l => (JSON.parse(l) as { event: AuditEvent }).event);

    const scene = async (heading: string, script: Turn[], approver: Approver, userId = 'carlos') => {
        title(heading);
        const before = broker.executed.length;
        const seen = events().length;
        const { engine } = createAdvisor({
            provider: scriptedProvider(script), transport: mockTransport().transport, userId, broker, targets,
            identities: op.identities, credentials: op.credentials(), trustedIssuers: op.trustedIssuers, directory: op.directory,
            approver, auditLogPath,
        });
        await engine.run('go');
        for (const e of events().slice(seen)) {
            if (e.tool === 'ask_agent') continue;
            const why = e.decision === 'allow' ? '' : `  (${e.reason ?? ''})`.slice(0, 110);
            const power = e.mandate ? `  under the mandate of ${e.mandate.issuer}` : e.exceeded ? '  beyond its mandate' : '';
            const by = e.approval ? `  approved by ${e.approval.by.id} as ${e.approval.authority?.matched ?? '?'}` : '';
            line(`   ${e.principal.agentId.padEnd(10)} ${e.tool.padEnd(15)} → ${e.decision.toUpperCase()}${power}${by}${why}`);
        }
        line(`   broker: ${broker.executed.length - before} order(s) sent`);
    };

    line('portfolio-advisor: a scripted model, a simulated market, the real framework around them.');
    line(`The person asking is carlos (trader). The executor may send up to 5,000 EUR and 100 shares per order, alone. Above that a person of finance decides.`);

    await scene('1. Reading and planning needs no power', [ask(ANALYST, 'signals?'), call('get_portfolio'), call('get_signal', { symbol: 'AAA' }), say('analysis'), ask(REBALANCER, 'plan'), call('plan_rebalance'), say('plan'), say('done')], nobody);
    await scene('2. A small order (1,000 EUR, 20 shares) goes alone', [ask(EXECUTOR, 'send'), call('place_order', order('BBB', 'buy', 20, 50)), say('sent'), say('done')], nobody);
    await scene('3. An order of 6,000 EUR is above the limit: it asks, and ana (finance) approves', [ask(EXECUTOR, 'send'), call('place_order', order('AAA', 'sell', 60, 100)), say('sent'), say('done')], person('ana'));
    await scene('4. 150 shares cost only 3,000 EUR but are above the 100 shares cap: it asks', [ask(EXECUTOR, 'send'), call('place_order', order('CCC', 'buy', 150, 20)), say('sent'), say('done')], person('laura'));
    await scene('5. The same large order, but the one who answers is the intern: refused', [ask(EXECUTOR, 'send'), call('place_order', order('AAA', 'sell', 60, 100)), say('refused'), say('done')], person('intern'));
    await scene('6. The intern asks for a small order: the power is carlos\'s, not the intern\'s', [ask(EXECUTOR, 'send'), call('place_order', order('BBB', 'buy', 20, 50)), say('refused'), say('done')], nobody, 'intern');

    title('7. What the audit can prove');
    const verdict = verifyAuditChain(auditLogPath, { agentSignatures: { keyOf: op.keyOf } });
    line(verdict.ok ? `   ${verdict.entries} entries, ${verdict.signedEvents} signed by the agent that acted: the chain and every signature verify with the keys of the operator.` : `   DOES NOT VERIFY: ${verdict.reason}`);
    line(`   log: ${auditLogPath}`);
    line(`\n   final: cash ${broker.cash.toFixed(0)} EUR, holdings ${JSON.stringify(Object.fromEntries(['AAA', 'BBB', 'CCC'].map(s => [s, broker.quantityOf(s)])))}`);
    if (process.argv.includes('--clean')) rmSync(dir, { recursive: true, force: true });
}

main().catch(err => { process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`); process.exit(1); });
