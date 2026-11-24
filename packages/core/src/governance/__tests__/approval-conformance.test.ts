/**
 * ONE rule, every way an approval is given. An `ask` that names a role is approved only by someone who holds it, and the person who asked does not
 * approve it either (four eyes); with no directory the roles cannot be checked, so nobody approves. These five scenarios run through every path
 * that accepts an approval: the engine with an approver in process, the engine with a stored approval run later, a flow with an approver in
 * process, a flow decided out of process through the handler and then resumed, and the direct tool server.
 *
 * It exists because the check had been copied three times and the copies drifted: the engine enforced roles and four eyes, and the flow, the handler
 * and the tool server did not. A path that checks less than the others is a way around them, and one parameterised test is what catches the next one.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBaseEngine } from '../../engine/createBaseEngine';
import { createToolServer } from '../../mcp/tool-server';
import { createApprovalHandler } from '../../flow/approval-handler';
import { parseFlow } from '../../flow/loader';
import { runFlow } from '../../flow/run';
import { stepApprovalId } from '../../flow/approval';
import { selfAssertedIdentities } from '../agent-identity';
import { MemoryApprovalStore } from '../approval-store';
import { defineTool, z } from '../../tools/defineTool';
import type { ApprovalOutcome, Approver, ApproverDirectory, ApproverRef, ToolPolicy } from '../types';
import type { AgentProfile } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const REQUESTER = 'carlos';
const people: Record<string, { roles: string[] }> = { ana: { roles: ['finance'] }, carlos: { roles: ['finance'] }, intern: { roles: ['intern'] } };
const directory: ApproverDirectory = { describe: (by: ApproverRef) => people[by.id] };

/** The `ask` every path faces: it names a role. */
const asksFinance: ToolPolicy = { decide: () => ({ effect: 'ask', reason: 'above 10k', accepts: ['human'], approverRoles: ['finance'] }) };
const human = (id: string): ApproverRef => ({ kind: 'human', id });
const outcome = (id: string): ApprovalOutcome => ({ decision: 'approve', by: human(id), at: new Date().toISOString() });
const approverAs = (id: string): Approver => ({ ref: human(id), request: async () => outcome(id) });

interface Scenario { name: string; who: string; directory: boolean; runs: boolean }
const scenarios: Scenario[] = [
    { name: 'a person of finance approves', who: 'ana', directory: true, runs: true },
    { name: 'an intern, who is a person and not the requester, does not', who: 'intern', directory: true, runs: false },
    { name: 'the requester does not, even with the role (four eyes)', who: REQUESTER, directory: true, runs: false },
    { name: 'a person the directory does not know does not', who: 'stranger', directory: true, runs: false },
    { name: 'with no directory nobody can: roles that cannot be checked are not roles', who: 'ana', directory: false, runs: false },
];

/** Each path answers one question: did the action run? */
type Path = (s: Scenario) => Promise<boolean>;

const payTool = (counter: { n: number }) => defineTool({ name: 'pay', description: '', destructive: true, input: z.object({ n: z.number() }), execute: async () => { counter.n++; return 'paid'; } });
const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['pay'], delegatesTo: [] };

const paths: Record<string, Path> = {
    'the engine, with an approver in process': async (s) => {
        const counter = { n: 0 };
        const { transport } = createMockTransport();
        const engine = createBaseEngine({
            requireAgentIdentity: false, providers: { mock: createScriptedProvider([{ tool_calls: [{ id: 'c', name: 'pay', args: { n: 1 } }] }, { content: 'done' }]) }, defaultProvider: 'mock',
            agents: [main], defaultAgent: 'main', tools: [payTool(counter)], transport, workingDir: process.cwd(), iterationMode: 'auto', identity: { userId: REQUESTER },
            policy: asksFinance, approver: approverAs(s.who), forbidSelfApproval: true, ...(s.directory ? { approverDirectory: directory } : {}),
        } as never);
        await engine.run('pay');
        return counter.n > 0;
    },

    'the engine, with a stored approval run later': async (s) => {
        const counter = { n: 0 };
        const store = new MemoryApprovalStore();
        const { transport } = createMockTransport();
        const engine = createBaseEngine({
            requireAgentIdentity: false, providers: { mock: createScriptedProvider([{ tool_calls: [{ id: 'c', name: 'pay', args: { n: 1 } }] }, { content: 'pending' }]) }, defaultProvider: 'mock',
            agents: [main], defaultAgent: 'main', tools: [payTool(counter)], transport, workingDir: process.cwd(), iterationMode: 'auto', identity: { userId: REQUESTER },
            policy: asksFinance, approvals: store, forbidSelfApproval: true, ...(s.directory ? { approverDirectory: directory } : {}),
        } as never);
        await engine.run('pay');
        const [pending] = await store.list({ status: 'pending' });
        await store.resolve(pending!.id, outcome(s.who));          // decided elsewhere, with no checks of its own
        await engine.runApproved(pending!.id);
        return counter.n > 0;
    },

    'a flow, with an approver in process': async (s) => {
        const counter = { n: 0 };
        const result = await runFlow(parseFlow(FLOW), {
            executor: { run: async () => { counter.n++; return { content: 'done' }; } }, runId: 'r1',
            approvals: {
                store: new MemoryApprovalStore(), identity: { userId: REQUESTER }, policy: asksFinance, approver: approverAs(s.who), forbidSelfApproval: true,
                ...(s.directory ? { approverDirectory: directory } : {}),
            },
        });
        return counter.n > 0 && result.status === 'completed';
    },

    'a flow decided out of process through the handler, then resumed': async (s) => {
        const counter = { n: 0 };
        const store = new MemoryApprovalStore();
        const options = {
            executor: { run: async () => { counter.n++; return { content: 'done' }; } }, runId: 'r2',
            approvals: { store, identity: { userId: REQUESTER }, policy: asksFinance, forbidSelfApproval: true, ...(s.directory ? { approverDirectory: directory } : {}) },
        };
        await runFlow(parseFlow(FLOW), options);                                           // stops: awaiting approval
        const handler = createApprovalHandler(store, { forbidSelfApproval: true, ...(s.directory ? { approverDirectory: directory } : {}) });
        await handler.decide(stepApprovalId('r2', 's1'), { decision: 'approve', by: human(s.who) }).catch(() => undefined);   // refused: the request stays open
        const second = await runFlow(parseFlow(FLOW), options);
        return counter.n > 0 && second.status === 'completed';
    },

    'the direct tool server': async (s) => {
        const counter = { n: 0 };
        const server = createToolServer({
            name: 'srv', tools: [payTool(counter)], identity: { userId: REQUESTER }, agentIdentity: selfAssertedIdentities(), policy: asksFinance,
            approver: approverAs(s.who), forbidSelfApproval: true, ...(s.directory ? { approverDirectory: directory } : {}),
        });
        const [c, srv] = InMemoryTransport.createLinkedPair();
        await server.connect(srv);
        const client = new Client({ name: 'c', version: '0' });
        await client.connect(c);
        try { await client.callTool({ name: 'pay', arguments: { n: 1 } }); } finally { await client.close(); await server.close(); }
        return counter.n > 0;
    },
};

const FLOW = `
flow: one
version: 1
trigger: { type: manual }
steps:
  - id: s1
    agent: main
    prompt: "pay"
    gate: { approval: human }
`;

describe.each(Object.entries(paths))('who may approve, in %s', (_name, path) => {
    it.each(scenarios)('$name', async (s) => {
        expect(await path(s)).toBe(s.runs);
    });
});
