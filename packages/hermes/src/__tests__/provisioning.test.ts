import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionContext, ToolDefinition } from '@backendkit-labs/agent-core';
import {
    FleetConfigError, Hermes, InProcessConnector, createFleetTools, createHermes, parseFleet,
    type AgentConnector, type AuditEvent, type HermesEvent, type Principal, type Provision,
} from '../index';
import { until } from './helpers';

const ops: Principal = { id: 'olga', roles: ['ops'] };
const operator: Principal = { id: 'oscar', roles: ['operator'] };
const guest: Principal = { id: 'gus', roles: ['guest'] };

const WRITERS = ['write_file', 'edit_file'];
// What Hermes may hand out, and a blueprint inside it. Note the explicit approval and writeTools: a bare `preset: read-only`
// would count as WIDER than an `ask` creator (read-only asks for nothing), and the file would be refused.
const CREATOR = { sandbox: { preset: 'ask', writeTools: WRITERS }, tools: ['read_file', 'search_files', 'list_directory'], budgetUsdPerDay: 5 };
const LOCKED = { preset: 'read-only', approval: 'writes-and-commands', writeTools: WRITERS };

const blueprint = (extra: Record<string, unknown> = {}) => ({
    id: 'report-writer', description: 'writes reports and summaries', template: 'single', tools: ['read_file', 'search_files'],
    sandbox: LOCKED, limits: { budgetUsdPerDay: 1 }, covers: ['write reports', 'summaries'], createRoles: ['ops'],
    access: { roles: ['ops'], controlRoles: ['sre'], approval: 'never' }, ...extra,
});

const fleetObject = (provisioning: Record<string, unknown> = {}, blueprints: unknown[] = [blueprint()], agents?: unknown[]) => ({
    fleet: 'test',
    agents: agents ?? [{ id: 'ledger', connector: { kind: 'in-process' }, description: 'keeps the books', access: { roles: ['ops'], approval: 'never' } }],
    blueprints,
    policies: { provisioning: { creator: CREATOR, operatorRoles: ['operator'], ...provisioning } },
});

const ledger = () => new InProcessConnector({ name: 'ledger', capabilities: { post_entry: { description: 'post an accounting entry', handler: async () => 'posted' } } });

let dir: string;
const live: Array<{ stop(): Promise<unknown> }> = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hermes-prov-')); });
afterEach(async () => { await Promise.all(live.splice(0).map(x => x.stop())); rmSync(dir, { recursive: true, force: true }); });

interface Rig { hermes: Hermes; built: string[]; closed: string[]; audit: AuditEvent[]; events: HermesEvent[]; provision: Provision }

async function boot(opts: { fleet?: Record<string, unknown>; approver?: () => boolean; provision?: boolean; files?: boolean; makeConnector?: (id: string) => AgentConnector } = {}): Promise<Rig> {
    const built: string[] = []; const closed: string[] = []; const audit: AuditEvent[] = []; const events: HermesEvent[] = [];
    const provision: Provision = (_bp, ctx) => {
        built.push(ctx.instanceId);
        if (opts.makeConnector) return opts.makeConnector(ctx.instanceId);
        const c = new InProcessConnector({
            name: ctx.instanceId,
            capabilities: {
                write_report: { description: 'writes a report', handler: async i => `report ${JSON.stringify(i)}` },
                hang: { async: true, handler: (_i, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))) },
            },
        });
        const close = c.close.bind(c);
        c.close = async () => { closed.push(ctx.instanceId); await close(); };
        return c;
    };
    const hermes = new Hermes({
        fleet: parseFleet(JSON.stringify(opts.fleet ?? fleetObject())),
        inProcess: { ledger: ledger() },
        ...(opts.provision === false ? {} : { provision }),
        ...(opts.approver ? { approver: opts.approver } : {}),
        ...(opts.files ? { provisioningFile: join(dir, 'prov.json'), storeFile: join(dir, 'runs.json') } : {}),
        onAudit: e => audit.push(e), onEvent: e => events.push(e),
    });
    live.push(hermes);
    await hermes.start();
    return { hermes, built, closed, audit, events, provision };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
    try { await p; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; }
    return 'resolved';
}
const issuesOf = (obj: unknown) => { try { parseFleet(JSON.stringify(obj)); } catch (e) { return (e as FleetConfigError).issues; } throw new Error('expected the file to be refused'); };

describe('blueprints are checked when the file is read', () => {
    it("the spec's bare example `sandbox: { preset: read-only }` is refused, and the message says which field to add", () => {
        const bare = fleetObject({}, [blueprint({ sandbox: { preset: 'read-only' } })]);
        const found = issuesOf(bare);
        expect(found[0].path).toBe('blueprints.0.sandbox');
        expect(found[0].message).toContain('wider than the creator');
        expect(found[0].message).toContain('approval');
    });

    it('refuses tools, budget and sandbox beyond what Hermes may hand out, and blueprints with no creator at all', () => {
        expect(issuesOf(fleetObject({}, [blueprint({ tools: ['read_file', 'run_command'] })])).map(i => i.path)).toContain('blueprints.0.tools');
        expect(issuesOf(fleetObject({}, [blueprint({ limits: { budgetUsdPerDay: 50 } })])).map(i => i.path)).toContain('blueprints.0.limits.budgetUsdPerDay');
        expect(issuesOf(fleetObject({}, [blueprint({ limits: {} })])).map(i => i.path)).toContain('blueprints.0.limits.budgetUsdPerDay'); // a budget must be set when the creator has one
        expect(issuesOf(fleetObject({}, [blueprint({ sandbox: { preset: 'full' } })])).map(i => i.path)).toContain('blueprints.0.sandbox');
        expect(issuesOf(fleetObject({}, [blueprint({ sandbox: { mode: 'everything' } })])).map(i => i.path)).toContain('blueprints.0.sandbox'); // a typo is an error too
        const noCreator = { ...fleetObject(), policies: {} };
        expect(issuesOf(noCreator)[0].message).toContain('policies.provisioning.creator');
    });

    it('refuses duplicate blueprint ids and unknown keys', () => {
        expect(issuesOf(fleetObject({}, [blueprint(), blueprint()])).some(i => i.message.includes('duplicate blueprint'))).toBe(true);
        expect(issuesOf(fleetObject({}, [blueprint({ canCreate: true })]))[0].path).toBe('blueprints.0');
    });
});

describe('creating an agent', () => {
    it('with approval it builds the agent, puts it in the fleet, and audits creator, blueprint and resulting policy', async () => {
        const asked: unknown[] = [];
        const rig = await boot({ approver: () => { asked.push(1); return true; } });
        const made = await rig.hermes.agentCreate(ops, { blueprint: 'report-writer', label: 'monthly close' });

        expect(made.id).toBe('report-writer-1');
        expect(asked).toHaveLength(1);
        expect(rig.hermes.registry.get(made.id)?.health.state).toBe('ok');
        expect(rig.hermes.list(ops).map(a => a.id)).toEqual(['ledger', 'report-writer-1']);
        expect((await rig.hermes.run(ops, { agentId: made.id, capability: 'write_report', input: { n: 1 } })).output).toBe('report {"n":1}');
        const created = rig.audit.find(e => e.action === 'provision' && e.outcome === 'created')!;
        expect(created).toMatchObject({ principalId: 'olga', blueprintId: 'report-writer', instanceId: 'report-writer-1' });
        expect(created.reason).toContain('"preset":"read-only"');
        expect(rig.events.find(e => e.type === 'fleet.agent.created')).toMatchObject({ instanceId: 'report-writer-1', createdBy: 'olga' });
        expect(rig.hermes.blueprintList(ops).instances).toHaveLength(1);
    });

    it('with no approver nothing is built and the fleet is unchanged', async () => {
        const rig = await boot();
        expect(await codeOf(rig.hermes.agentCreate(ops, { blueprint: 'report-writer' }))).toBe('APPROVAL_REQUIRED');
        expect(rig.built).toEqual([]);
        expect(rig.hermes.registry.list().map(a => a.id)).toEqual(['ledger']);
        expect(rig.audit.find(e => e.action === 'provision' && e.outcome === 'denied')?.reason).toContain('no approver');
    });

    it('when the approver says no, nothing is built either', async () => {
        const rig = await boot({ approver: () => false });
        expect(await codeOf(rig.hermes.agentCreate(ops, { blueprint: 'report-writer' }))).toBe('APPROVAL_REQUIRED');
        expect(rig.built).toEqual([]);
    });

    it('a blueprint that sets approval to never needs none', async () => {
        const rig = await boot({ fleet: fleetObject({}, [blueprint({ approval: 'never' })]) });
        expect((await rig.hermes.agentCreate(ops, { blueprint: 'report-writer' })).id).toBe('report-writer-1');
    });

    it('needs a role: no createRoles means nobody, and a principal without it is FORBIDDEN', async () => {
        const open = await boot({ approver: () => true });
        expect(await codeOf(open.hermes.agentCreate(guest, { blueprint: 'report-writer' }))).toBe('FORBIDDEN');
        const nobody = await boot({ approver: () => true, fleet: fleetObject({}, [blueprint({ createRoles: undefined })]) });
        expect(await codeOf(nobody.hermes.agentCreate(ops, { blueprint: 'report-writer' }))).toBe('FORBIDDEN');
        expect(open.built.concat(nobody.built)).toEqual([]);
    });

    it('an unknown blueprint, and a Hermes with no provisioner, cannot create', async () => {
        const rig = await boot({ approver: () => true });
        expect(await codeOf(rig.hermes.agentCreate(ops, { blueprint: 'nope' }))).toBe('BLUEPRINT_NOT_FOUND');
        const bare = await boot({ approver: () => true, provision: false });
        expect(await codeOf(bare.hermes.agentCreate(ops, { blueprint: 'report-writer' }))).toBe('CONTROL_UNSUPPORTED');
    });

    it('the blueprint is re-checked at the moment of creation, not only when the file was read', async () => {
        const rig = await boot({ approver: () => true });
        // the operator tightens what Hermes may hand out while it runs (the config object is shared)
        (rig.hermes as unknown as { options: { fleet: { policies: { provisioning: { creator: { tools: string[] } } } } } }).options.fleet.policies.provisioning.creator.tools = ['list_directory'];
        expect(await codeOf(rig.hermes.agentCreate(ops, { blueprint: 'report-writer' }))).toBe('POLICY_WIDER_THAN_PARENT');
        expect(rig.built).toEqual([]);
    });

    it('a built agent that runs wider than the creator is closed and never registered', async () => {
        const rig = await boot({
            approver: () => true,
            makeConnector: id => new InProcessConnector({
                name: id, capabilities: { noop: { handler: async () => 'ok' } },
                control: { actions: ['get_sandbox_policy'], control: async () => ({ version: 1, policy: { preset: 'full' } }) },
            }),
        });
        expect(await codeOf(rig.hermes.agentCreate(ops, { blueprint: 'report-writer' }))).toBe('POLICY_WIDER_THAN_PARENT');
        expect(rig.hermes.registry.list().map(a => a.id)).toEqual(['ledger']);
    });

    it('a failing provisioner leaves nothing behind', async () => {
        const rig = await boot({ approver: () => true, makeConnector: () => { throw new Error('no docker'); } });
        expect(await codeOf(rig.hermes.agentCreate(ops, { blueprint: 'report-writer' }))).toBe('PROVISION_FAILED');
        expect(rig.hermes.registry.list().map(a => a.id)).toEqual(['ledger']);
        expect(rig.hermes.blueprintList(ops).instances).toEqual([]);
    });

    it('the instance id is made by Hermes and never collides with an id of the operator', async () => {
        const fleet = fleetObject({}, [blueprint()], [
            { id: 'ledger', connector: { kind: 'in-process' }, access: { roles: ['ops'], approval: 'never' } },
            { id: 'report-writer-1', connector: { kind: 'in-process' }, access: { roles: ['ops'], approval: 'never' } },
        ]);
        const rig = new Hermes({ fleet: parseFleet(JSON.stringify(fleet)), inProcess: { ledger: ledger(), 'report-writer-1': ledger() }, approver: () => true, provision: (_b, c) => new InProcessConnector({ name: c.instanceId, capabilities: {} }) });
        live.push(rig);
        await rig.start();
        expect((await rig.agentCreate(ops, { blueprint: 'report-writer' })).id).toBe('report-writer-2');
    });

    it('a created agent is used under the roles of its blueprint', async () => {
        const rig = await boot({ approver: () => true });
        const { id } = await rig.hermes.agentCreate(ops, { blueprint: 'report-writer' });
        expect(await codeOf(rig.hermes.run(guest, { agentId: id, capability: 'write_report' }))).toBe('FORBIDDEN');
    });
});

describe('limits, retiring and lifetime', () => {
    it('stops at maxLive and has room again after one is retired', async () => {
        const rig = await boot({ approver: () => true, fleet: fleetObject({ maxLive: 1 }) });
        const first = await rig.hermes.agentCreate(ops, { blueprint: 'report-writer' });
        expect(await codeOf(rig.hermes.agentCreate(ops, { blueprint: 'report-writer' }))).toBe('LIMIT_REACHED');
        await rig.hermes.agentRetire(ops, first.id);
        expect((await rig.hermes.agentCreate(ops, { blueprint: 'report-writer' })).id).toBe('report-writer-2');
    });

    it('parallel creations cannot slip past the limit', async () => {
        const rig = await boot({ approver: () => true, fleet: fleetObject({ maxLive: 1 }) });
        const results = await Promise.allSettled([rig.hermes.agentCreate(ops, { blueprint: 'report-writer' }), rig.hermes.agentCreate(ops, { blueprint: 'report-writer' })]);
        expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(rig.built).toHaveLength(1);
    });

    it('retiring cancels the runs of the agent, takes it out of the fleet and closes it', async () => {
        const rig = await boot({ approver: () => true });
        const { id } = await rig.hermes.agentCreate(ops, { blueprint: 'report-writer' });
        const run = await rig.hermes.run(ops, { agentId: id, capability: 'hang' });
        expect(run.status).toBe('running');

        await rig.hermes.agentRetire(ops, id);
        expect(rig.hermes.registry.get(id)).toBeUndefined();
        expect(rig.hermes.status(ops, run.runId).status).toBe('cancelled');
        expect(rig.closed).toEqual([id]);
        expect(rig.audit.find(e => e.outcome === 'retired' && e.instanceId === id)).toMatchObject({ blueprintId: 'report-writer' });
        expect(rig.events.some(e => e.type === 'fleet.agent.retired')).toBe(true);
    });

    it("only agents Hermes created can be retired, and only by someone allowed to", async () => {
        const rig = await boot({ approver: () => true });
        expect(await codeOf(rig.hermes.agentRetire(ops, 'ledger'))).toBe('AGENT_NOT_FOUND');
        const { id } = await rig.hermes.agentCreate(ops, { blueprint: 'report-writer' });
        expect(await codeOf(rig.hermes.agentRetire(guest, id))).toBe('FORBIDDEN');
        expect(rig.hermes.registry.get('ledger')).toBeDefined();
    });

    it('an agent expires by its ttl, and that is audited', async () => {
        const rig = await boot({ approver: () => true, fleet: fleetObject({}, [blueprint({ limits: { budgetUsdPerDay: 1, ttlMinutes: 0.0005 } })]) });
        const { id } = await rig.hermes.agentCreate(ops, { blueprint: 'report-writer' });
        await until(() => rig.hermes.registry.get(id) === undefined, 3000, 10);
        await until(() => rig.audit.some(e => e.outcome === 'expired' && e.instanceId === id), 1000, 10);
        expect(rig.closed).toEqual([id]);
    });

    it('does not keep its created agents across a restart: they are retired, and their open runs are lost', async () => {
        const first = await boot({ approver: () => true, files: true });
        const { id } = await first.hermes.agentCreate(ops, { blueprint: 'report-writer' });
        const run = await first.hermes.run(ops, { agentId: id, capability: 'hang' });
        await first.hermes.stop();

        const second = await boot({ approver: () => true, files: true });
        expect(second.hermes.registry.get(id)).toBeUndefined();
        expect(second.hermes.provisioning.instances().find(i => i.id === id)).toMatchObject({ status: 'retired', retiredReason: 'did not outlive the Hermes process' });
        expect(second.hermes.status(ops, run.runId).status).toBe('lost');
    });
});

describe('what the model can and cannot choose', () => {
    const tools = (rig: Rig, principal: Principal | null = ops) => {
        const list = createFleetTools(rig.hermes, { principal: () => principal ?? undefined });
        return { names: list.map(t => t.name), call: (name: string, args: Record<string, unknown>) => (list.find(t => t.name === name) as ToolDefinition).execute(args, {} as ExecutionContext) };
    };

    it('agent_create takes a blueprint id, a label and a gap, and refuses anything else', async () => {
        const rig = await boot({ approver: () => true });
        const t = tools(rig);
        for (const extra of [{ sandbox: { preset: 'full' } }, { tools: ['run_command'] }, { limits: { ttlMinutes: 9999 } }, { access: { roles: ['guest'] } }]) {
            expect(await t.call('agent_create', { blueprint: 'report-writer', ...extra })).toMatch(/^Error: Invalid arguments/);
        }
        expect(rig.built).toEqual([]);
        expect(JSON.parse(await t.call('agent_create', { blueprint: 'report-writer', label: 'q3' }))).toMatchObject({ id: 'report-writer-1' });
    });

    it('there is no tool to approve a draft, to change what Hermes may hand out, or to widen a blueprint', async () => {
        const rig = await boot();
        const { names } = tools(rig);
        expect(names.filter(n => /approve|decide|reject|creator|ceiling/.test(n))).toEqual([]);
        expect(names).toEqual(expect.arrayContaining(['agent_create', 'agent_retire', 'fleet_find', 'fleet_gap', 'blueprint_list', 'blueprint_propose']));
    });

    it('without a principal the creation tools answer FORBIDDEN', async () => {
        const rig = await boot({ approver: () => true });
        const t = tools(rig, null);
        expect(await t.call('agent_create', { blueprint: 'report-writer' })).toMatch(/^Error: FORBIDDEN/);
        expect(await t.call('agent_retire', { agent: 'x' })).toMatch(/^Error: FORBIDDEN/);
    });
});

describe('gaps', () => {
    it('something the fleet covers is not a gap', async () => {
        const rig = await boot();
        const out = await rig.hermes.reportGap(ops, 'post an accounting entry');
        expect(out.gap).toBe(false);
        expect(out.matches[0]).toMatchObject({ agentId: 'ledger', capability: 'post_entry' });
        expect(rig.events.filter(e => e.type === 'fleet.gap')).toEqual([]);
    });

    it('by default a gap is only reported: an event, an audit line, and nothing created', async () => {
        const rig = await boot({ approver: () => true });
        const out = await rig.hermes.reportGap(ops, 'translate legal contracts into french');
        expect(out).toMatchObject({ gap: true, action: 'notified', gapId: 'gap-1' });
        expect(rig.events.find(e => e.type === 'fleet.gap')).toMatchObject({ gapId: 'gap-1', mode: 'notify', principalId: 'olga' });
        expect(rig.audit.find(e => e.action === 'gap')).toMatchObject({ gapId: 'gap-1', principalId: 'olga' });
        expect(rig.built).toEqual([]);
    });

    it('in create mode a blueprint that covers the gap is used, with its own roles and approval', async () => {
        const rig = await boot({ approver: () => true, fleet: fleetObject({ gap: { mode: 'create' } }) });
        const out = await rig.hermes.reportGap(ops, 'we need reports for the board');
        expect(out).toMatchObject({ action: 'created', instanceId: 'report-writer-1' });
        expect(rig.audit.find(e => e.outcome === 'created')).toMatchObject({ gapId: out.gapId, blueprintId: 'report-writer' });

        const denied = await boot({ approver: () => true, fleet: fleetObject({ gap: { mode: 'create' } }) });
        const refused = await denied.hermes.reportGap(guest, 'we need reports for the board');
        expect(refused.action).toBe('create-failed');
        expect(refused.detail).toContain('FORBIDDEN');
        expect(denied.built).toEqual([]);

        const noApprover = await boot({ fleet: fleetObject({ gap: { mode: 'create' } }) });
        expect((await noApprover.hermes.reportGap(ops, 'we need reports for the board')).detail).toContain('APPROVAL_REQUIRED');
        expect(noApprover.built).toEqual([]);
    });

    describe('in propose mode', () => {
        const draftBlueprint = (extra: Record<string, unknown> = {}) => blueprint({ id: 'contract-translator', description: 'translates legal contracts', covers: ['translate contracts'], ...extra });
        const proposeFleet = () => fleetObject({ gap: { mode: 'propose' } });

        it('a draft stays pending and cannot create anything until an operator approves it', async () => {
            const rig = await boot({ approver: () => true, fleet: proposeFleet() });
            const gap = await rig.hermes.reportGap(ops, 'translate legal contracts into french');
            expect(gap.action).toBe('propose');

            const draft = await rig.hermes.blueprintPropose(ops, draftBlueprint(), gap.gapId);
            expect(draft.status).toBe('pending');
            expect(rig.events.find(e => e.type === 'fleet.blueprint.proposed')).toMatchObject({ draftId: 'contract-translator', gapId: gap.gapId });
            expect(rig.hermes.blueprintList(ops).blueprints.map(b => b.id)).toEqual(['report-writer']);
            expect(rig.hermes.blueprintList(operator).drafts.map(d => d.id)).toEqual(['contract-translator']);

            expect(await codeOf(rig.hermes.agentCreate(ops, { blueprint: 'contract-translator' }))).toBe('BLUEPRINT_NOT_FOUND');
            expect(await codeOf(rig.hermes.blueprintDecide(ops, 'contract-translator', 'approved'))).toBe('FORBIDDEN');
            expect(rig.built).toEqual([]);

            await rig.hermes.blueprintDecide(operator, 'contract-translator', 'approved');
            expect(rig.audit.find(e => e.action === 'blueprint' && e.outcome === 'approved')).toMatchObject({ principalId: 'oscar', gapId: gap.gapId });
            expect((await rig.hermes.agentCreate(ops, { blueprint: 'contract-translator', gapId: gap.gapId })).id).toBe('contract-translator-1');
        });

        it('a draft that asks for more than Hermes may hand out is refused when proposed', async () => {
            const rig = await boot({ fleet: proposeFleet() });
            expect(await codeOf(rig.hermes.blueprintPropose(ops, draftBlueprint({ sandbox: { preset: 'full' } })))).toBe('POLICY_WIDER_THAN_PARENT');
            expect(await codeOf(rig.hermes.blueprintPropose(ops, draftBlueprint({ tools: ['run_command'] })))).toBe('POLICY_WIDER_THAN_PARENT');
            expect(await codeOf(rig.hermes.blueprintPropose(ops, { id: 'x' }))).toBe('INVALID_INPUT');
            expect(rig.hermes.blueprintList(operator).drafts).toEqual([]);
        });

        it('approval checks the bounds again', async () => {
            const rig = await boot({ fleet: proposeFleet() });
            await rig.hermes.blueprintPropose(ops, draftBlueprint());
            (rig.hermes as unknown as { options: { fleet: { policies: { provisioning: { creator: { tools: string[] } } } } } }).options.fleet.policies.provisioning.creator.tools = [];
            expect(await codeOf(rig.hermes.blueprintDecide(operator, 'contract-translator', 'approved'))).toBe('POLICY_WIDER_THAN_PARENT');
            expect(rig.hermes.blueprintList(ops).blueprints.map(b => b.id)).toEqual(['report-writer']);
        });

        it('a rejected draft is gone, and an id in use cannot be proposed again', async () => {
            const rig = await boot({ fleet: proposeFleet() });
            await rig.hermes.blueprintPropose(ops, draftBlueprint());
            expect(await codeOf(rig.hermes.blueprintPropose(ops, draftBlueprint()))).toBe('INVALID_INPUT');
            expect(await codeOf(rig.hermes.blueprintPropose(ops, draftBlueprint({ id: 'report-writer' })))).toBe('INVALID_INPUT');
            await rig.hermes.blueprintDecide(operator, 'contract-translator', 'rejected');
            expect(rig.hermes.blueprintList(operator).drafts).toEqual([]);
            expect(await codeOf(rig.hermes.agentCreate(ops, { blueprint: 'contract-translator' }))).toBe('BLUEPRINT_NOT_FOUND');
        });

        it('limits the drafts waiting, and only exists when the company chose propose', async () => {
            const rig = await boot({ fleet: fleetObject({ gap: { mode: 'propose' }, maxDrafts: 1 }) });
            await rig.hermes.blueprintPropose(ops, draftBlueprint());
            expect(await codeOf(rig.hermes.blueprintPropose(ops, draftBlueprint({ id: 'second' })))).toBe('LIMIT_REACHED');

            const notify = await boot();
            expect(await codeOf(notify.hermes.blueprintPropose(ops, draftBlueprint()))).toBe('FORBIDDEN');
        });

        it('drafts and decisions survive a restart, in a file of their own', async () => {
            const first = await boot({ fleet: proposeFleet(), files: true });
            await first.hermes.blueprintPropose(ops, draftBlueprint());
            await first.hermes.blueprintDecide(operator, 'contract-translator', 'approved');
            await first.hermes.stop();
            expect(JSON.parse(readFileSync(join(dir, 'prov.json'), 'utf8')).drafts['contract-translator'].status).toBe('approved');

            const second = await boot({ fleet: proposeFleet(), files: true, approver: () => true });
            expect((await second.hermes.agentCreate(ops, { blueprint: 'contract-translator' })).id).toBe('contract-translator-1');
        });
    });
});

describe('createHermes', () => {
    it('builds a validated Hermes from yaml text, with its tools and guardrails', async () => {
        const yaml = 'fleet: f\nagents:\n  - { id: a, connector: { kind: in-process }, access: { approval: never } }\n';
        const { hermes, tools, guardrails } = createHermes({ fleet: yaml, inProcess: { a: ledger() } });
        live.push(hermes);
        expect(tools({ principal: ops }).length).toBeGreaterThan(10);
        expect(guardrails().map(g => g.name)).toEqual(['secret-leak', 'prompt-injection']);
        expect(() => createHermes({ fleet: 'fleet: f\nagents: []\n' })).toThrow(FleetConfigError);
    });
});
