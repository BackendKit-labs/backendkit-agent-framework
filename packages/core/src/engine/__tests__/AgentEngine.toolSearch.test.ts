import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import type { AgentProfile, LLMProvider, ToolDefinition } from '../../types';
import type { ToolPolicy } from '../../governance/types';
import { MemoryAuditSink } from '../../governance/audit';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

/** 30 tools of a made-up CRM. `crm_find_contact` and `crm_find_deal` answer to "find"; the rest have their own words. */
function crmTools(executed: string[], defer = true): ToolDefinition[] {
    const make = (name: string, description: string): ToolDefinition => ({
        name, description, parameters: { type: 'object', properties: {} }, ...(defer ? { defer: true } : {}),
        execute: async () => { executed.push(name); return `${name} ran`; },
    });
    return [
        make('crm_find_contact', 'Find a contact by email or name'),
        make('crm_find_deal', 'Find a deal by its title'),
        ...Array.from({ length: 28 }, (_, i) => make(`crm_op_${i}`, `Operation number ${i} on invoices`)),
    ];
}

const plain: ToolDefinition = { name: 'read_file', description: 'Read a file', parameters: { type: 'object' }, execute: async () => 'text' };

/** A provider that records the names of the tools of each call, then plays the script. */
function recording(script: Turn[]) {
    const inner = createScriptedProvider(script);
    const lists: string[][] = [];
    const provider: LLMProvider = { chat: async (m, tools, cb, o) => { lists.push(tools.map(t => t.name)); return inner.chat(m, tools, cb, o); } };
    return { provider, lists };
}

function build(script: Turn[], opts: { agent?: Partial<AgentProfile>; tools?: ToolDefinition[]; extra?: Partial<BaseEngineOptions>; executed?: string[] } = {}) {
    const executed = opts.executed ?? [];
    const { provider, lists } = recording(script);
    const { transport, events } = createMockTransport();
    const tools = opts.tools ?? [plain, ...crmTools(executed)];
    const engine = createBaseEngine({ requireAgentIdentity: false,
        providers: { mock: provider }, defaultProvider: 'mock',
        agents: [{ ...testAgent, allowedTools: tools.map(t => t.name), delegatesTo: [], ...opts.agent }], defaultAgent: testAgent.id,
        tools, transport, workingDir: process.cwd(), ...opts.extra,
    });
    const results = () => events.filter((e): e is Extract<typeof e, { type: 'tool_result' }> => e.type === 'tool_result');
    return { engine, lists, executed, results };
}

const call = (name: string, args: Record<string, unknown> = {}, id = 'c1'): Turn => ({ tool_calls: [{ id, name, args }] });
const done: Turn = { content: 'done' };

describe('tool_search: tools the model finds when it needs them', () => {
    it('the first call carries only the tools that are not deferred and tool_search; the search brings the match, which then runs', async () => {
        const { engine, lists, executed, results } = build([call('tool_search', { query: 'find contact' }), call('crm_find_contact', {}, 'c2'), done]);
        await engine.run('look up Ana');
        expect(lists[0]).toEqual(['read_file', 'tool_search']);                         // 30 deferred tools, none listed
        expect(lists[1]).toContain('crm_find_contact');                                // found, so listed from the next step
        expect(lists[1].slice(0, 2)).toEqual(['read_file', 'tool_search']);            // the prefix is unchanged: the list only grows at the end
        expect(lists[1].length).toBeLessThanOrEqual(2 + 5);                            // at most maxResults tools come with it
        expect(executed).toEqual(['crm_find_contact']);
        expect(results().map(r => [r.name, r.success])).toEqual([['tool_search', true], ['crm_find_contact', true]]);
    });

    it('a name outranks a description, and the answer says what was found', async () => {
        const { engine, results } = build([call('tool_search', { query: 'deal' }), done]);
        await engine.run('x');
        expect(results()[0].preview).toContain('crm_find_deal');
    });

    it('when nothing matches the model is told so, and nothing new is listed', async () => {
        const { engine, lists, results } = build([call('tool_search', { query: 'zebra' }), done]);
        await engine.run('x');
        expect(results()[0].preview).toContain('No tool matches');
        expect(lists[1]).toEqual(['read_file', 'tool_search']);
    });

    it('a second search adds to the end of the list, in the order found; nothing already listed moves', async () => {
        const { engine, lists } = build([call('tool_search', { query: 'contact' }), call('tool_search', { query: 'deal' }, 'c2'), done]);
        await engine.run('x');
        const afterFirst = lists[1];
        expect(lists[2].slice(0, afterFirst.length)).toEqual(afterFirst);
        expect(lists[2]).toContain('crm_find_deal');
    });

    it('what was found lasts to the end of the run and no longer: the next run starts again from the short list', async () => {
        const { engine, lists } = build([call('tool_search', { query: 'contact' }), done, done]);
        await engine.run('one');
        await engine.run('two');
        expect(lists[lists.length - 1]).toEqual(['read_file', 'tool_search']);
    });

    it('an agent with no deferred tool gets neither tool_search nor a changed list', async () => {
        const executed: string[] = [];
        const { engine, lists } = build([done], { tools: [plain, ...crmTools(executed, false)] });
        await engine.run('x');
        expect(lists[0]).toHaveLength(31);
        expect(lists[0]).not.toContain('tool_search');
        expect(lists[0][0]).toBe('read_file');
    });

    it('tool_search is not a tool of agents without deferred tools: calling it by name finds nothing', async () => {
        const { engine, results } = build([call('tool_search', { query: 'x' }), done], { tools: [plain] });
        await engine.run('x');
        expect(results()[0]).toMatchObject({ name: 'tool_search', success: false });
    });
});

describe('tool_search: it does not widen what the agent may do', () => {
    it('a deferred tool called before it was found fails and does not run', async () => {
        const { engine, executed, results } = build([call('crm_find_contact'), done]);
        await engine.run('x');
        expect(executed).toEqual([]);
        expect(results()[0]).toMatchObject({ name: 'crm_find_contact', success: false });
        expect(results()[0].preview).toContain('tool_search');
    });

    it('a tool outside allowedTools is never found, though it is deferred and registered', async () => {
        const executed: string[] = [];
        const tools = [plain, ...crmTools(executed)];
        const { engine, results } = build([call('tool_search', { query: 'find contact' }), call('crm_find_contact', {}, 'c2'), done], {
            tools, agent: { allowedTools: ['read_file', 'crm_find_deal'] },
        });
        await engine.run('x');
        expect(results()[0].preview).not.toContain('crm_find_contact');
        expect(executed).toEqual([]);
        expect(results()[1].preview).toContain('not authorized');
    });

    it('a tool the policy denies is not offered by the search, and calling it is refused anyway', async () => {
        const denyContacts: ToolPolicy = { decide: (_p, c) => (c.tool.name === 'crm_find_contact' ? { effect: 'deny', reason: 'contacts are off limits' } : { effect: 'allow' }) };
        const { engine, executed, results } = build([call('tool_search', { query: 'find contact' }), call('crm_find_contact', {}, 'c2'), done], { extra: { policy: denyContacts } });
        await engine.run('x');
        expect(results()[0].preview).not.toContain('crm_find_contact');
        expect(results()[0].preview).toContain('crm_find_deal');   // the search still works for what is allowed
        expect(executed).toEqual([]);
    });

    it('finding a tool does not skip approval: a destructive deferred tool still asks', async () => {
        const executed: string[] = [];
        const erase: ToolDefinition = { name: 'crm_erase_contact', description: 'Erase a contact for good', parameters: { type: 'object' }, destructive: true, defer: true, execute: async () => { executed.push('erase'); return 'gone'; } };
        const rejected: string[] = [];
        const { engine, results } = build([call('tool_search', { query: 'erase contact' }), call('crm_erase_contact', {}, 'c2'), done], {
            tools: [erase], extra: { approver: { request: async (r) => { rejected.push(r.id); return { decision: 'reject', by: { id: 'u', kind: 'human' }, at: new Date().toISOString() }; } } },
        });
        await engine.run('x');
        expect(rejected).toHaveLength(1);
        expect(executed).toEqual([]);
        expect(results()[1].success).toBe(false);
    });

    it('the search is audited like any other call', async () => {
        const audit = new MemoryAuditSink();
        const { engine } = build([call('tool_search', { query: 'contact' }), done], { extra: { audit } });
        await engine.run('x');
        expect(audit.events.map(e => [e.tool, e.decision])).toContainEqual(['tool_search', 'allow']);
    });
});

describe('deferTools: defer the tools of an agent without touching their definitions', () => {
    it('a trailing * defers every tool with that prefix; the others stay listed', async () => {
        const executed: string[] = [];
        const { engine, lists } = build([call('tool_search', { query: 'contact' }), done], {
            tools: [plain, ...crmTools(executed, false)], agent: { deferTools: ['crm_*'] },
        });
        await engine.run('x');
        expect(lists[0]).toEqual(['read_file', 'tool_search']);
        expect(lists[1]).toContain('crm_find_contact');
    });

    it('an exact name defers just that tool', async () => {
        const executed: string[] = [];
        const { engine, lists } = build([done], { tools: [plain, ...crmTools(executed, false)], agent: { deferTools: ['crm_find_deal'] } });
        await engine.run('x');
        expect(lists[0]).toContain('crm_find_contact');
        expect(lists[0]).not.toContain('crm_find_deal');
        expect(lists[0]).toContain('tool_search');
    });
});

describe('toolSearch: a search of your own', () => {
    it('is used instead of the search by words, and its order and limit are respected', async () => {
        const seen: Array<[string, number]> = [];
        const { engine, lists } = build([call('tool_search', { query: 'anything' }), done], {
            extra: {
                toolSearch: {
                    maxResults: 2,
                    search: (q, candidates) => { seen.push([q, candidates.length]); return [...candidates].reverse(); },
                },
            },
        });
        await engine.run('x');
        expect(seen).toEqual([['anything', 30]]);
        // the last two candidates, in the order the search gave them, join the list
        expect(lists[1].slice(2)).toEqual(['crm_op_27', 'crm_op_26']);
    });

    it('cannot bring back a tool that governance hid: only candidates survive', async () => {
        const denyDeal: ToolPolicy = { decide: (_p, c) => (c.tool.name === 'crm_find_deal' ? { effect: 'deny', reason: 'no' } : { effect: 'allow' }) };
        const outsider: ToolDefinition = { name: 'crm_secret', description: 'x', parameters: { type: 'object' }, execute: async () => 'leak' };
        const { engine, lists } = build([call('tool_search', { query: 'deal' }), done], {
            extra: { policy: denyDeal, toolSearch: { search: (_q, c) => [outsider, ...c] } },
        });
        await engine.run('x');
        expect(lists[1]).toContain('crm_find_contact');
        expect(lists[1]).not.toContain('crm_find_deal');
        expect(lists[1]).not.toContain('crm_secret');
    });

    it('an async search works, and maxResults alone changes how many the words search returns', async () => {
        const a = build([call('tool_search', { query: 'op' }), done], { extra: { toolSearch: { search: async (_q, c) => c.slice(0, 1) } } });
        await a.engine.run('x');
        expect(a.lists[1].slice(2)).toEqual(['crm_find_contact']);
        const b = build([call('tool_search', { query: 'invoices' }), done], { extra: { toolSearch: { maxResults: 3 } } });
        await b.engine.run('x');
        expect(b.lists[1].length).toBe(2 + 3);
    });
});

describe("toolSearch mode 'message': the list of tools never changes", () => {
    const withParams = (executed: string[]): ToolDefinition[] => [plain, ...crmTools(executed).map(t =>
        t.name === 'crm_find_contact' ? { ...t, parameters: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] } } : t)];

    it('every request carries the same list, the answer carries the parameters, and the found tool runs', async () => {
        const executed: string[] = [];
        const { engine, lists, results } = build([call('tool_search', { query: 'find contact' }), call('crm_find_contact', { email: 'a@b.c' }, 'c2'), done],
            { tools: withParams(executed), extra: { toolSearch: { mode: 'message' } }, executed });
        await engine.run('look up Ana');
        expect(lists).toEqual([['read_file', 'tool_search'], ['read_file', 'tool_search'], ['read_file', 'tool_search']]);
        const found = results()[0];
        expect(found.preview).toContain('by name, with arguments that match its parameters');
        expect(executed).toEqual(['crm_find_contact']);
        expect(results().map(r => [r.name, r.success])).toEqual([['tool_search', true], ['crm_find_contact', true]]);
    });

    it('a tool that was not found still fails without running; finding does not skip governance', async () => {
        const executed: string[] = [];
        const denyContacts: ToolPolicy = { decide: (_p, c) => (c.tool.name === 'crm_find_contact' ? { effect: 'deny', reason: 'off limits' } : { effect: 'allow' }) };
        const a = build([call('crm_find_contact', {}, 'c1'), done], { extra: { toolSearch: { mode: 'message' } }, executed });
        await a.engine.run('x');
        expect(executed).toEqual([]);
        const b = build([call('tool_search', { query: 'find contact' }), call('crm_find_contact', {}, 'c2'), done], { extra: { toolSearch: { mode: 'message' }, policy: denyContacts }, executed });
        await b.engine.run('x');
        expect(executed).toEqual([]);
        expect(b.results()[0].preview).not.toContain('crm_find_contact');
    });

    it("the default mode is 'list': the found tool joins the list", async () => {
        const { engine, lists } = build([call('tool_search', { query: 'find contact' }), done]);
        await engine.run('x');
        expect(lists[1]).toContain('crm_find_contact');
    });
});
