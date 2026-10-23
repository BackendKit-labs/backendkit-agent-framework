import { AgentServer } from '@backendkit-labs/agent-protocol';
import { createEngineControl, createJobRegistry } from '@backendkit-labs/agent-core';
import { createSandboxPolicy, createSandboxService, NoneBackend, sandboxPolicyControl } from '@backendkit-labs/agent-sandbox';
import type { SandboxPolicyConfig } from '@backendkit-labs/agent-sandbox';
import { Hermes, InProcessConnector, createFleetTools, type Principal } from '../index';
import { fleetFor, freePort, until } from './helpers';
import type { ExecutionContext, ToolDefinition } from '@backendkit-labs/agent-core';

const ops: Principal = { id: 'olga', roles: ['ops'] };
const sre: Principal = { id: 'sam', roles: ['ops', 'sre'] };

const WRITERS = ['write_file', 'edit_file'];
const OPEN: SandboxPolicyConfig = { preset: 'auto-edit', writeTools: WRITERS };
// A read-only policy that keeps asking for commands and keeps the writers listed: narrower than OPEN in every dimension.
const LOCKDOWN: SandboxPolicyConfig = { preset: 'read-only', approval: 'commands', writeTools: WRITERS };

interface ControlledAgent { url: string; port: number; policy: ReturnType<typeof createSandboxPolicy>; stop(): Promise<void> }
const live: Array<{ stop(): Promise<unknown> }> = [];
afterEach(async () => { await Promise.all(live.splice(0).map(x => x.stop())); });

/** A real agent-protocol server whose engine is controllable: `write` tells whether its sandbox policy lets it write today. */
async function startControlled(name: string, opts: { initial?: SandboxPolicyConfig; ceiling?: SandboxPolicyConfig; approveWidening?: () => boolean; controlKey?: string | null } = {}): Promise<ControlledAgent> {
    const policy = createSandboxPolicy(opts.initial ?? OPEN);
    const service = createSandboxService({ policy, backends: [new NoneBackend()] });
    const control = createEngineControl({ sandbox: service }, {
        policy: sandboxPolicyControl(policy, { ceiling: opts.ceiling }),
        ...(opts.approveWidening ? { approveWidening: opts.approveWidening } : {}),
    });
    const port = await freePort();
    const server = new AgentServer({
        name, version: '1.0.0', description: name, port,
        ...(opts.controlKey === null ? {} : { controlApiKey: opts.controlKey ?? 'ctl-key' }),
        control,
    });
    server.register({
        definition: { name: 'write', description: 'tries to write a file', async: false, input: {}, output: {} },
        execute: async () => {
            const verdict = service.authorizeTool!({ agentId: name, sessionId: 's' }, 'write_file');
            return verdict.ok ? 'written' : `refused: ${verdict.code}`;
        },
    });
    await server.start();
    let stopped = false;
    const agent = { url: `http://127.0.0.1:${port}`, port, policy, stop: async () => { if (!stopped) { stopped = true; await server.stop(); } } };
    live.push(agent);
    return agent;
}

const agentEntry = (id: string, url: string, access: Record<string, unknown> = {}) => ({
    id, connector: { kind: 'protocol', url, controlApiKey: { env: 'CTL_KEY' } }, health: { intervalSec: 30 },
    access: { roles: ['ops'], controlRoles: ['sre'], approval: 'never', ...access },
});

async function boot(agents: Array<Record<string, unknown>>, extra: { approver?: () => boolean; env?: Record<string, string>; inProcess?: Record<string, InProcessConnector> } = {}) {
    const hermes = new Hermes({
        fleet: fleetFor(agents), env: { CTL_KEY: 'ctl-key', ...(extra.env ?? {}) },
        ...(extra.approver ? { approver: extra.approver } : {}),
        ...(extra.inProcess ? { inProcess: extra.inProcess } : {}),
    });
    live.push(hermes);
    await hermes.start();
    return hermes;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
    try { await p; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; }
    return 'resolved';
}

describe('Hermes controls how an agent executes', () => {
    it('setting read-only from Hermes changes what the agent does on its very next call, and leaves an audited decision with the version', async () => {
        const agent = await startControlled('coder');
        const hermes = await boot([agentEntry('coder', agent.url)]);
        expect((await hermes.run(ops, { agentId: 'coder', capability: 'write' })).output).toBe('written');

        const before = await hermes.policyGet(ops, 'coder');
        expect(before).toMatchObject({ version: 1, policy: OPEN });

        const set = await hermes.policySet(sre, 'coder', LOCKDOWN, before.version);
        expect(set.version).toBe(2);
        expect((await hermes.run(ops, { agentId: 'coder', capability: 'write' })).output).toBe('refused: SANDBOX_DENIED');
        expect(await hermes.policyGet(ops, 'coder')).toMatchObject({ version: 2, policy: LOCKDOWN });

        const { entries } = await hermes.auditView(ops, { agentId: 'coder' });
        const change = entries.find(e => e.source === 'coder' && e.tool === 'set_sandbox_policy');
        expect(change).toMatchObject({ outcome: 'applied', by: 'sam', version: 2 });
        const denial = entries.find(e => e.source === 'coder' && e.kind === 'sandbox' && e.outcome === 'SANDBOX_DENIED');
        expect(denial).toBeDefined();
        expect(entries.find(e => e.source === 'hermes' && e.capability === 'set_sandbox_policy')).toMatchObject({ principalId: 'sam', agentId: 'coder', outcome: 'allowed', reason: 'policy version 2' });
    });

    it('widening is refused by the agent when nobody there approves, and it stays as it was', async () => {
        const agent = await startControlled('coder', { initial: LOCKDOWN });
        const hermes = await boot([agentEntry('coder', agent.url)]);
        expect(await codeOf(hermes.policySet(sre, 'coder', OPEN))).toBe('APPROVAL_REQUIRED');
        expect(agent.policy.snapshot()).toEqual(LOCKDOWN);
        expect((await hermes.run(ops, { agentId: 'coder', capability: 'write' })).output).toBe('refused: SANDBOX_DENIED');
    });

    it("nothing goes past the agent's own ceiling, even with its approver saying yes", async () => {
        const agent = await startControlled('coder', { initial: LOCKDOWN, ceiling: OPEN, approveWidening: () => true });
        const hermes = await boot([agentEntry('coder', agent.url)]);
        await hermes.policySet(sre, 'coder', OPEN); // within the ceiling and approved there
        expect(await codeOf(hermes.policySet(sre, 'coder', { preset: 'full' }))).toBe('POLICY_WIDER_THAN_PARENT');
        expect(agent.policy.snapshot()).toEqual(OPEN);
    });

    it('a stale expected version fails and a bad policy is rejected', async () => {
        const agent = await startControlled('coder');
        const hermes = await boot([agentEntry('coder', agent.url)]);
        await hermes.policySet(sre, 'coder', LOCKDOWN);
        expect(await codeOf(hermes.policySet(sre, 'coder', LOCKDOWN, 1))).toBe('INVALID_INPUT');
        expect(await codeOf(hermes.policySet(sre, 'coder', { mode: 'everything' }))).toBe('INVALID_INPUT');
    });

    describe('who may do it', () => {
        it('reading the policy needs access to the agent; changing it needs a control role', async () => {
            const agent = await startControlled('coder');
            const hermes = await boot([agentEntry('coder', agent.url)]);
            expect((await hermes.policyGet(ops, 'coder')).version).toBe(1);
            expect(await codeOf(hermes.policySet(ops, 'coder', LOCKDOWN))).toBe('FORBIDDEN');
            expect(await codeOf(hermes.policyGet({ id: 'gus', roles: ['guest'] }, 'coder'))).toBe('FORBIDDEN');
            expect(agent.policy.version).toBe(1);
        });

        it('an agent with no controlRoles cannot be changed by anyone through Hermes', async () => {
            const agent = await startControlled('coder');
            const hermes = await boot([agentEntry('coder', agent.url, { controlRoles: undefined })]);
            expect(await codeOf(hermes.policySet(sre, 'coder', LOCKDOWN))).toBe('FORBIDDEN');
            expect(await codeOf(hermes.jobCancel(sre, 'coder', 'bash-1'))).toBe('FORBIDDEN');
        });

        it('Hermes asks for approval first when the agent is set to, and a refusal reaches the agent as nothing', async () => {
            const agent = await startControlled('coder');
            const strict = agentEntry('coder', agent.url, { approval: 'always' });
            const none = await boot([strict]);
            expect(await codeOf(none.policySet(sre, 'coder', LOCKDOWN))).toBe('APPROVAL_REQUIRED');
            expect(agent.policy.version).toBe(1);

            const asked: unknown[] = [];
            const yes = await boot([strict], { approver: () => { asked.push(1); return true; } });
            await yes.policySet(sre, 'coder', LOCKDOWN);
            expect(asked).toHaveLength(1);
            expect(agent.policy.version).toBe(2);
        });

        it('an agent with no control key configured, or one the agent rejects, cannot be controlled', async () => {
            const agent = await startControlled('coder');
            const bare = { id: 'coder', connector: { kind: 'protocol', url: agent.url }, access: { roles: ['ops'], controlRoles: ['sre'], approval: 'never' } };
            expect(await codeOf((await boot([bare])).policyGet(ops, 'coder'))).toBe('CONTROL_UNSUPPORTED');

            const wrong = await boot([agentEntry('coder', agent.url)], { env: { CTL_KEY: 'not-the-key' } });
            const err = await wrong.policyGet(ops, 'coder').catch((e: Error) => e);
            expect((err as Error).message).toContain('control key');
            expect(agent.policy.version).toBe(1);
        });

        it('the run key does not open the control channel', async () => {
            const agent = await startControlled('coder', { controlKey: null });
            const hermes = await boot([agentEntry('coder', agent.url)]);
            expect(await codeOf(hermes.policyGet(ops, 'coder'))).toBe('FORBIDDEN'); // the agent keeps its control endpoints closed without a control key
        });
    });

    describe('one trail for the fleet', () => {
        it('joins the decisions of two agents and Hermes in time order, and says which agent had nothing to give', async () => {
            const a = await startControlled('alpha');
            const b = await startControlled('beta');
            const quiet = new InProcessConnector({ name: 'quiet', capabilities: { noop: { handler: async () => 'ok' } } });
            const hermes = await boot([agentEntry('alpha', a.url), agentEntry('beta', b.url), { id: 'quiet', connector: { kind: 'in-process' }, access: { roles: ['ops'], approval: 'never' } }], { inProcess: { quiet } });

            await hermes.policySet(sre, 'alpha', LOCKDOWN);
            await new Promise(r => setTimeout(r, 5));
            await hermes.policySet(sre, 'beta', LOCKDOWN);
            await hermes.run(ops, { agentId: 'alpha', capability: 'write' });

            const { entries, unavailable } = await hermes.auditView(ops);
            const changes = entries.filter(e => e.tool === 'set_sandbox_policy' && e.source !== 'hermes');
            expect(changes.map(e => e.source)).toEqual(['alpha', 'beta']);
            expect(entries.some(e => e.source === 'hermes')).toBe(true);
            expect([...entries].map(e => e.ts)).toEqual([...entries].map(e => e.ts).sort());
            expect(unavailable).toEqual([{ agentId: 'quiet', reason: 'no audit trail' }]);

            const onlyBeta = await hermes.auditView(ops, { agentId: 'beta', limit: 1 });
            expect(onlyBeta.entries).toHaveLength(1);
            expect(await codeOf(hermes.auditView(ops, { since: 'yesterday-ish' }))).toBe('INVALID_INPUT');
            expect(await codeOf(hermes.auditView({ id: 'gus', roles: ['guest'] }, { agentId: 'alpha' }))).toBe('FORBIDDEN');
        });

        it('an agent that cannot be reached is reported, not fatal', async () => {
            const a = await startControlled('alpha');
            const b = await startControlled('beta');
            const hermes = await boot([agentEntry('alpha', a.url), agentEntry('beta', b.url)]);
            await b.stop();
            const { entries, unavailable } = await hermes.auditView(ops);
            expect(unavailable.map(u => u.agentId)).toEqual(['beta']);
            expect(Array.isArray(entries)).toBe(true);
        });
    });

    describe('background jobs', () => {
        it('lists the jobs of an agent and cancels one from outside', async () => {
            const jobs = createJobRegistry({ cancelGraceMs: 50 });
            const control = createEngineControl({}, { jobs });
            const worker = new InProcessConnector({ name: 'worker', capabilities: { noop: { handler: async () => 'ok' } }, control });
            const hermes = await boot([{ id: 'worker', connector: { kind: 'in-process' }, access: { roles: ['ops'], controlRoles: ['sre'], approval: 'never' } }], { inProcess: { worker } });

            const job = jobs.start({ kind: 'bash', owner: 'worker', run: signal => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))) });
            const listed = await hermes.jobList(ops, 'worker') as { jobs: Array<{ id: string; status: string }> };
            expect(listed.jobs).toEqual([expect.objectContaining({ id: job.id, status: 'running' })]);

            expect(await codeOf(hermes.jobCancel(ops, 'worker', job.id))).toBe('FORBIDDEN');
            expect(await hermes.jobCancel(sre, 'worker', job.id)).toEqual({ id: job.id, cancelled: true });
            await until(() => jobs.get(job.id, 'worker')?.status === 'cancelled');
            expect(await codeOf(hermes.jobCancel(sre, 'worker', 'bash-99'))).toBe('RUN_NOT_FOUND');
        });
    });

    describe('as tools', () => {
        it('exposes policy_get, policy_set, job_list, job_cancel and fleet_audit, and reports failures as text', async () => {
            const agent = await startControlled('coder');
            const hermes = await boot([agentEntry('coder', agent.url)]);
            const principal = { current: ops };
            const tools = createFleetTools(hermes, { principal: () => principal.current });
            const byName = Object.fromEntries(tools.map(t => [t.name, t])) as Record<string, ToolDefinition>;
            const call = (name: string, args: Record<string, unknown>) => byName[name].execute(args, {} as ExecutionContext);

            expect(Object.keys(byName)).toEqual(expect.arrayContaining(['policy_get', 'policy_set', 'job_list', 'job_cancel', 'fleet_audit']));
            expect(JSON.parse(await call('policy_get', { agent: 'coder' }))).toMatchObject({ version: 1 });
            expect(await call('policy_set', { agent: 'coder', policy: LOCKDOWN })).toMatch(/^Error: FORBIDDEN/);

            principal.current = sre;
            expect(JSON.parse(await call('policy_set', { agent: 'coder', policy: LOCKDOWN, expected_version: 1 }))).toMatchObject({ version: 2 });
            expect(await call('policy_set', { agent: 'coder', policy: OPEN })).toMatch(/^Error: APPROVAL_REQUIRED/);
            expect(JSON.parse(await call('fleet_audit', { agent: 'coder' })).entries.length).toBeGreaterThan(0);
        });
    });
});
