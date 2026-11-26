import { AgentEngine } from '../AgentEngine';
import type { AgentProfile, LLMMessage, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport, createScriptedProvider, createTextProvider, testAgent } from '../../__tests__/helpers';

function specialist(id: string): AgentProfile {
    return { id, name: id, icon: '·', description: `${id} specialist`, systemPrompt: '', allowedTools: [], delegatesTo: [], provider: id };
}

/** An engine whose default agent asks `target` once, then answers; each specialist answers "from <id>". */
function setup(orchestrator: AgentProfile, target: string) {
    const prompts: string[] = [];
    const script = createScriptedProvider([
        { tool_calls: [{ id: 'c1', name: 'ask_agent', args: { agent_id: target, question: 'q' } }] },
        { content: 'done' },
    ]);
    const recording: LLMProvider = {
        chat: (messages: LLMMessage[], tools, cb, opts) => {
            prompts.push(String(messages[0]?.content ?? ''));
            return script.chat(messages, tools, cb, opts);
        },
    };
    const { agents, tools, providers } = buildRegistries(recording, orchestrator);
    const ran: string[] = [];
    for (const id of ['allowed', 'other']) {
        agents.upsert(specialist(id));
        const text = createTextProvider(`from ${id}`);
        providers.register(id, { chat: (m, t, cb, o) => { ran.push(id); return text.chat(m, t, cb, o); } });
    }
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({
        requireAgentIdentity: false,
        model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
        defaultProvider: 'mock', transport, defaultAgentId: orchestrator.id, iterationMode: 'auto', maxIterations: 5,
    });
    return { engine, ran, events, prompts, agents };
}

describe('AgentEngine — delegatesTo is enforced', () => {
    it('refuses a delegation outside the list and never runs that agent', async () => {
        const { engine, ran, events } = setup({ ...testAgent, delegatesTo: ['allowed'] }, 'other');
        await engine.run('go');
        expect(ran).toEqual([]);
        const result = events.find(e => e.type === 'tool_result' && e.name === 'ask_agent');
        expect(result).toMatchObject({ success: false });
        expect((result as { preview: string }).preview).toContain('may not delegate to "other"');
    });

    it('lets a delegation inside the list through', async () => {
        const { engine, ran } = setup({ ...testAgent, delegatesTo: ['allowed'] }, 'allowed');
        await engine.run('go');
        expect(ran).toEqual(['allowed']);
    });

    it('lists only the agents it may delegate to in the roster', async () => {
        const { engine, prompts } = setup({ ...testAgent, delegatesTo: ['allowed'] }, 'allowed');
        await engine.run('go');
        expect(prompts[0]).toContain('- allowed');
        expect(prompts[0]).not.toContain('- other');
    });

    it('keeps the old behaviour for a default agent without delegatesTo: any other agent', async () => {
        const { engine, ran } = setup({ ...testAgent, delegatesTo: [] }, 'other');
        await engine.run('go');
        expect(ran).toEqual(['other']);
    });

    it('always lets the agents an MCP server registered through a list', async () => {
        const { engine, ran, agents } = setup({ ...testAgent, delegatesTo: ['allowed'] }, 'other');
        agents.upsert({ ...specialist('other'), source: 'mcp' });
        await engine.run('go');
        expect(ran).toEqual(['other']);
    });

    it("accepts ['*'] as every other agent", async () => {
        const { engine, ran } = setup({ ...testAgent, delegatesTo: ['*'] }, 'other');
        await engine.run('go');
        expect(ran).toEqual(['other']);
    });

    it('does not offer ask_agent to a sub-agent, nor tell it to use it', async () => {
        const seen: string[][] = [];
        const orchestrator = { ...testAgent, delegatesTo: ['worker'] };
        const { agents, tools, providers } = buildRegistries(createScriptedProvider([
            { tool_calls: [{ id: 'c1', name: 'ask_agent', args: { agent_id: 'worker', question: 'q' } }] },
            { content: 'done' },
        ]), orchestrator);
        agents.upsert({ ...specialist('worker'), delegatesTo: ['allowed'] });
        agents.upsert(specialist('allowed'));
        const workerScript = createScriptedProvider([
            { tool_calls: [{ id: 'w1', name: 'not_mine', args: {} }] },
            { content: 'ok' },
        ]);
        providers.register('worker', { chat: (m, t, cb, o) => { seen.push(t.map(x => x.name)); return workerScript.chat(m, t, cb, o); } });
        const { transport, events } = createMockTransport();
        tools.register({ name: 'not_mine', description: 'x', parameters: { type: 'object', properties: {} }, execute: async () => 'ran' });
        const engine = new AgentEngine({
            requireAgentIdentity: false,
            model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
            defaultProvider: 'mock', transport, defaultAgentId: orchestrator.id, iterationMode: 'auto', maxIterations: 5,
        });
        await engine.run('go');
        expect(seen[0]).not.toContain('ask_agent');
        const refused = events.find(e => e.type === 'tool_result' && e.name === 'not_mine') as { preview: string } | undefined;
        expect(refused?.preview).not.toContain('ask_agent');
    });
});
