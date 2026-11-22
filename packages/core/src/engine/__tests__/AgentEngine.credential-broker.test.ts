/** A tool declares the credentials it needs; the broker leases them for one authorized call and takes them back (SPEC-0042 F4). */
import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import { MemoryAuditSink } from '../../governance/audit';
import { defineTool, z, ToolDefinitionError } from '../../tools/defineTool';
import { hashArgs } from '../../shared/utils/canonical-json';
import type { Approver, CredentialBroker, CredentialLease, CredentialRequest, ToolPolicy } from '../../governance/types';
import type { AgentProfile, ExecutionContext, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['pay', 'lookup'], delegatesTo: [] };

const SECRET = 'tok-SUPER-SECRET-123';

/** A broker for tests: it records what it was asked, hands out numbered leases and records what was released. */
function testBroker(options: { fail?: (req: CredentialRequest) => Error | undefined; lease?: (req: CredentialRequest, n: number) => Partial<CredentialLease>; releaseFails?: boolean } = {}) {
    const asked: CredentialRequest[] = [];
    const released: string[] = [];
    let n = 0;
    const broker: CredentialBroker = {
        lease: (req) => {
            asked.push(req);
            const failure = options.fail?.(req);
            if (failure) throw failure;
            n += 1;
            const id = `lease-${n}`;
            const custom = options.lease?.(req, n) ?? {};
            return {
                value: `${SECRET}-${req.name}`, id,
                release: () => { if (options.releaseFails) throw new Error('revocation endpoint down'); released.push(id); },
                ...custom,
            } as CredentialLease;
        },
    };
    return { broker, asked, released };
}

interface Seen { credentials: ExecutionContext['credentials']; secrets: ExecutionContext['secrets']; dryRun?: boolean }

function build(script: Turn[], extra: Partial<BaseEngineOptions> = {}, tools?: ToolDefinition[]) {
    const seen: Seen[] = [];
    const audit = new MemoryAuditSink();
    const pay: ToolDefinition = {
        name: 'pay', description: '', parameters: { type: 'object' }, destructive: true, credentials: ['treasury', 'ledger'],
        execute: async (_a, ctx) => { seen.push({ credentials: ctx.credentials, secrets: ctx.secrets, ...(ctx.dryRun ? { dryRun: true } : {}) }); return 'paid'; },
    };
    const lookup: ToolDefinition = {
        name: 'lookup', description: '', parameters: { type: 'object' }, readOnly: true,
        execute: async (_a, ctx) => { seen.push({ credentials: ctx.credentials, secrets: ctx.secrets }); return 'found'; },
    };
    const { transport } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock',
        agents: [{ ...main, secrets: { STRIPE: 'sk-agent-wide-secret' } }], defaultAgent: 'main',
        tools: tools ?? [pay, lookup], transport, workingDir: process.cwd(), iterationMode: 'auto', audit, ...extra,
    });
    return { engine, seen, audit };
}

const call = (name: string, args: Record<string, unknown> = {}): Turn => ({ tool_calls: [{ id: 'c1', name, args }] });
const lastEvent = (audit: MemoryAuditSink) => audit.events[audit.events.length - 1]!;
const approve: Approver = { ref: { kind: 'human', id: 'ana' }, request: async () => ({ decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() }) };

describe('credentials leased for one call', () => {
    it('the tool receives only what it declared, and the broker is asked for each one', async () => {
        const { broker, asked } = testBroker();
        const { engine, seen } = build([call('pay', { amount: 5 }), { content: 'done' }], { credentialBroker: broker, approver: approve });
        await engine.run('pay');
        expect(seen[0]!.credentials).toEqual({ treasury: `${SECRET}-treasury`, ledger: `${SECRET}-ledger` });
        expect(asked.map(r => r.name)).toEqual(['treasury', 'ledger']);
    });

    it('the request says which tool, for whom and for exactly which arguments, with the hash the audit event carries', async () => {
        const { broker, asked } = testBroker();
        const { engine, audit } = build([call('pay', { amount: 5 }), { content: 'done' }], { credentialBroker: broker, approver: approve, identity: { userId: 'carlos', tenantId: 'acme' } });
        await engine.run('pay');
        expect(asked[0]).toMatchObject({ name: 'treasury', tool: 'pay', argsHash: hashArgs({ amount: 5 }), principal: { agentId: 'main', userId: 'carlos', tenantId: 'acme' } });
        expect(asked[0]!.argsHash).toBe(lastEvent(audit).argsHash);
    });

    it('the broker is asked only AFTER the call is authorized, and it learns which approval authorized it', async () => {
        const denyAll: ToolPolicy = { decide: () => ({ effect: 'deny', reason: 'frozen' }) };
        const denied = testBroker();
        await build([call('pay'), { content: 'x' }], { credentialBroker: denied.broker, policy: denyAll }).engine.run('pay');
        expect(denied.asked).toEqual([]);

        const noOneToAsk = testBroker();
        await build([call('pay'), { content: 'x' }], { credentialBroker: noOneToAsk.broker, approver: { ref: { kind: 'human', id: 'ana' }, request: async () => ({ decision: 'reject', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() }) } }).engine.run('pay');
        expect(noOneToAsk.asked).toEqual([]);

        const approved = testBroker();
        await build([call('pay'), { content: 'x' }], { credentialBroker: approved.broker, approver: approve }).engine.run('pay');
        expect(approved.asked[0]).toMatchObject({ approval: { by: { kind: 'human', id: 'ana' } } });
    });

    it('the agent-wide secrets are untouched, and a tool that declares nothing gets no credentials and never calls the broker', async () => {
        const { broker, asked } = testBroker();
        const { engine, seen } = build([call('lookup'), { content: 'done' }], { credentialBroker: broker });
        await engine.run('look');
        expect(seen[0]!.credentials).toBeUndefined();
        expect(seen[0]!.secrets).toEqual({ STRIPE: 'sk-agent-wide-secret' });
        expect(asked).toEqual([]);
    });

    it('the leases are released when the call ends, and the audit event says which, never the value', async () => {
        const { broker, released } = testBroker();
        const { engine, audit } = build([call('pay'), { content: 'done' }], { credentialBroker: broker, approver: approve });
        await engine.run('pay');
        expect(released).toEqual(['lease-1', 'lease-2']);
        const event = lastEvent(audit);
        expect(event.credentials).toEqual([
            { name: 'treasury', id: 'lease-1', released: true },
            { name: 'ledger', id: 'lease-2', released: true },
        ]);
        expect(JSON.stringify(audit.events)).not.toContain(SECRET);
    });

    it('the leases are released when the tool fails too', async () => {
        const { broker, released } = testBroker();
        const failing: ToolDefinition = { name: 'pay', description: '', parameters: { type: 'object' }, destructive: true, credentials: ['treasury'], execute: async () => { throw new Error('treasury is down'); } };
        const { engine, audit } = build([call('pay'), { content: 'done' }], { credentialBroker: broker, approver: approve }, [failing]);
        const r = await engine.run('pay');
        expect(r.toolCalls[0]).toMatchObject({ success: false });
        expect(released).toEqual(['lease-1']);
        expect(lastEvent(audit)).toMatchObject({ outcome: 'error', credentials: [{ name: 'treasury', released: true }] });
    });

    it('the leases are released when the call times out', async () => {
        const { broker, released } = testBroker();
        const slow: ToolDefinition = { name: 'pay', description: '', parameters: { type: 'object' }, destructive: true, credentials: ['treasury'], timeoutMs: 20, execute: async () => { await new Promise(r => setTimeout(r, 120)); return 'late'; } };
        const { engine, audit } = build([call('pay'), { content: 'done' }], { credentialBroker: broker, approver: approve }, [slow]);
        await engine.run('pay');
        expect(released).toEqual(['lease-1']);
        expect(lastEvent(audit)).toMatchObject({ outcome: 'timeout' });
    });

    it('a release that fails is recorded as not released: it is not hidden, and the result of the tool stands', async () => {
        const { broker } = testBroker({ releaseFails: true });
        const { engine, audit } = build([call('pay'), { content: 'done' }], { credentialBroker: broker, approver: approve });
        const r = await engine.run('pay');
        expect(r.toolCalls[0]).toMatchObject({ success: true });
        expect(lastEvent(audit).credentials).toEqual([
            { name: 'treasury', id: 'lease-1', released: false },
            { name: 'ledger', id: 'lease-2', released: false },
        ]);
    });
});

describe('it fails closed', () => {
    it('a tool that declares credentials with no broker configured does not run', async () => {
        const { engine, seen, audit } = build([call('pay'), { content: 'done' }], { approver: approve });
        const r = await engine.run('pay');
        expect(seen).toEqual([]);
        expect(r.toolCalls[0]).toMatchObject({ success: false });
        expect(lastEvent(audit)).toMatchObject({ decision: 'deny', reason: expect.stringContaining('no credential broker is configured') });
    });

    it('a broker that refuses means the tool does not run, the refusal is audited, and what was already leased is released', async () => {
        const { broker, released, asked } = testBroker({ fail: req => (req.name === 'ledger' ? new Error('ledger credential denied for this tenant') : undefined) });
        const { engine, seen, audit } = build([call('pay'), { content: 'done' }], { credentialBroker: broker, approver: approve });
        await engine.run('pay');
        expect(seen).toEqual([]);
        expect(asked.map(r => r.name)).toEqual(['treasury', 'ledger']);
        expect(released).toEqual(['lease-1']);                                  // the first one was given back
        expect(lastEvent(audit)).toMatchObject({ decision: 'deny', reason: expect.stringContaining('ledger credential denied for this tenant') });
    });

    it('a lease with no value, no id, or already expired is refused, and given back', async () => {
        for (const bad of [{ value: '' }, { id: '' }, { expiresAt: new Date(Date.now() - 1000).toISOString() }, { expiresAt: 'not-a-date' }]) {
            const { broker, released } = testBroker({ lease: () => bad });
            const { engine, seen, audit } = build([call('pay'), { content: 'done' }], { credentialBroker: broker, approver: approve });
            await engine.run('pay');
            expect(seen).toEqual([]);
            expect(lastEvent(audit)).toMatchObject({ decision: 'deny', reason: expect.stringContaining('unusable lease') });
            expect(released.length).toBeGreaterThanOrEqual(1);
        }
    });

    it('a simulation (dry run) gets no credentials and does not ask the broker', async () => {
        const { broker, asked } = testBroker();
        const dryRun: ToolPolicy = { decide: () => ({ effect: 'allow', mode: 'dry_run' }) };
        const { engine, seen } = build([call('pay'), { content: 'done' }], { credentialBroker: broker, policy: dryRun });
        await engine.run('pay');
        expect(asked).toEqual([]);
        expect(seen[0]).toMatchObject({ credentials: undefined, dryRun: true });
    });
});

describe('declaring credentials on a tool', () => {
    it('defineTool carries them and refuses a malformed list', () => {
        const tool = defineTool({ name: 't', description: '', input: z.object({}), credentials: ['treasury'], execute: async () => 'ok' });
        expect(tool.credentials).toEqual(['treasury']);
        expect(() => defineTool({ name: 't', description: '', input: z.object({}), credentials: ['a', 'a'], execute: async () => 'ok' })).toThrow(ToolDefinitionError);
        expect(() => defineTool({ name: 't', description: '', input: z.object({}), credentials: [''], execute: async () => 'ok' })).toThrow(/distinct, non-empty/);
    });
});
