import { AgentEngine } from '../AgentEngine';
import type { SandboxRunner, SandboxToolFacts } from '../../sandbox/types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { buildRegistries, createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const params = { type: 'object', properties: {} };
const tool = (name: string, facts: Partial<ToolDefinition>, ran: string[]): ToolDefinition =>
    ({ name, description: name, parameters: params, ...facts, execute: async () => { ran.push(name); return 'ok'; } });

/** A runner that refuses, like `read-only`, everything that does not declare readOnly, and records what the engine told it. */
function readOnlyRunner(seen: Array<[string, SandboxToolFacts | undefined]>): SandboxRunner {
    return {
        run: async () => { throw new Error('not used'); },
        authorizeTool: (_caller, name, facts) => {
            seen.push([name, facts]);
            return facts?.readOnly === true ? { ok: true } : { ok: false, code: 'SANDBOX_DENIED', reason: `${name} may have an effect` };
        },
    };
}

describe('AgentEngine — the sandbox judges a tool by what it declares', () => {
    it('passes each tool\'s facts to authorizeTool, so read-only refuses a destructive or undeclared tool and lets a read through', async () => {
        const ran: string[] = [];
        const seen: Array<[string, SandboxToolFacts | undefined]> = [];
        const agent: AgentProfile = { ...testAgent, allowedTools: ['lookup', 'send_email', 'mystery'] };
        const { agents, tools, providers } = buildRegistries(createScriptedProvider([
            { tool_calls: [{ id: 'a', name: 'lookup', args: {} }, { id: 'b', name: 'send_email', args: {} }, { id: 'c', name: 'mystery', args: {} }] },
            { content: 'done' },
        ]), agent);
        tools.register(tool('lookup', { readOnly: true }, ran));
        tools.register(tool('send_email', { destructive: true }, ran));
        tools.register(tool('mystery', {}, ran));
        const { transport } = createMockTransport();
        const engine = new AgentEngine({
            requireAgentIdentity: false, model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
            defaultProvider: 'mock', transport, defaultAgentId: agent.id, iterationMode: 'auto', maxIterations: 5,
            sandbox: readOnlyRunner(seen),
        });
        await engine.run('go');
        expect(ran).toEqual(['lookup']);
        expect(seen).toEqual([['lookup', { readOnly: true }], ['send_email', { destructive: true }], ['mystery', {}]]);
    });

    it('passes the facts to approvalFor too', async () => {
        const asked: Array<[string, SandboxToolFacts | undefined]> = [];
        const agent: AgentProfile = { ...testAgent, allowedTools: ['pay'] };
        const { agents, tools, providers } = buildRegistries(createScriptedProvider([{ tool_calls: [{ id: 'a', name: 'pay', args: {} }] }, { content: 'done' }]), agent);
        tools.register(tool('pay', { destructive: true }, []));
        const { transport } = createMockTransport();
        const engine = new AgentEngine({
            requireAgentIdentity: false, model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
            defaultProvider: 'mock', transport, defaultAgentId: agent.id, iterationMode: 'auto', maxIterations: 5,
            sandbox: { run: async () => { throw new Error('not used'); }, approvalFor: (_c, name, facts) => { asked.push([name, facts]); return 'none'; } },
            onToolApproval: async () => 'approve',
        });
        await engine.run('go');
        expect(asked).toContainEqual(['pay', { destructive: true }]);
    });
});
