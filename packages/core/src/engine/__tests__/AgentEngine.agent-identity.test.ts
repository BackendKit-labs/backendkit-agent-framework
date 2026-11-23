/**
 * SPEC-0044 F1: an agent that acts carries a digital identity and says on whose behalf it acts. Both are required BY DEFAULT.
 * `core` knows no identity provider: these tests use the reference providers and hand-made ones.
 */
import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import { MemoryAuditSink } from '../../governance/audit';
import { selfAssertedIdentities, staticAgentIdentities, type AgentIdentity, type AgentIdentityProvider } from '../../governance/agent-identity';
import type { ToolDefinition, ToolPolicy } from '../../index';
import type { AgentProfile } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const agent: AgentProfile = { ...testAgent, allowedTools: ['read_file', 'write_file'], delegatesTo: ['helper'] };
const helper: AgentProfile = { ...testAgent, id: 'helper', name: 'Helper', allowedTools: ['read_file'], delegatesTo: [] };

function build(script: Turn[], extra: Partial<BaseEngineOptions> = {}) {
    const sink = new MemoryAuditSink();
    const { transport, events } = createMockTransport();
    const ran: string[] = [];
    const tools: ToolDefinition[] = [
        { name: 'read_file', description: '', parameters: { type: 'object' }, readOnly: true, execute: async () => { ran.push('read_file'); return 'content'; } },
        { name: 'write_file', description: '', parameters: { type: 'object' }, execute: async () => { ran.push('write_file'); return 'written'; } },
    ];
    // NOTE: no `requireAgentIdentity` here. The default is what these tests are about.
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock',
        agents: [agent, helper], defaultAgent: agent.id, tools,
        transport, workingDir: process.cwd(), iterationMode: 'auto', audit: sink, sessionId: 'sess-1',
        ...extra,
    });
    return { engine, sink, events, ran };
}

const calls = (...c: Array<[string, Record<string, unknown>]>): Turn => ({ tool_calls: c.map(([name, args], i) => ({ id: `c${i}`, name, args })) });
const once = (name = 'read_file'): Turn[] => [calls([name, {}]), { content: 'done' }];
const alice = { userId: 'alice' };

describe('identity is required by default', () => {
    it('an agent with no identity provider does not act, and the reason says how to fix it', async () => {
        const { engine, sink, ran } = build(once(), { identity: alice });
        await engine.run('go');
        expect(ran).toEqual([]);
        expect(sink.events[0]).toMatchObject({ decision: 'deny', agentIdentityMissing: true });
        expect(sink.events[0]!.reason).toMatch(/no digital identity.*agentIdentity.*requireAgentIdentity: false/s);
    });

    it('an agent with an identity but no one to act for does not act either', async () => {
        const { engine, sink, ran } = build(once(), { agentIdentity: selfAssertedIdentities() });
        await engine.run('go');
        expect(ran).toEqual([]);
        expect(sink.events[0]).toMatchObject({ decision: 'deny', agentIdentity: { id: `urn:agent:${agent.id}` } });
        expect(sink.events[0]!.reason).toMatch(/on whose behalf.*identity\.userId/);
    });

    it('with an identity and a person to act for, it acts, and the call is attributed to that identity', async () => {
        const { engine, sink, ran } = build(once(), { agentIdentity: selfAssertedIdentities(), identity: alice });
        await engine.run('go');
        expect(ran).toEqual(['read_file']);
        expect(sink.events[0]).toMatchObject({ decision: 'allow', agentIdentity: { id: `urn:agent:${agent.id}`, assurance: 'self-asserted' } });
        expect(sink.events[0]).not.toHaveProperty('agentIdentityMissing');
    });

    it('also in an engine with a policy: the policy is not even asked for an agent with no identity', async () => {
        const decide = jest.fn(() => ({ effect: 'allow' as const }));
        const policy: ToolPolicy = { decide };
        const { engine, ran } = build(once(), { identity: alice, policy });
        await engine.run('go');
        expect(ran).toEqual([]);
        expect(decide).not.toHaveBeenCalled();
    });

    it('the policy sees the identity in the principal', async () => {
        const seen: Array<AgentIdentity | undefined> = [];
        const policy: ToolPolicy = { decide: (p) => { seen.push(p.agentIdentity); return { effect: 'allow' }; } };
        const { engine } = build(once(), { agentIdentity: selfAssertedIdentities(), identity: alice, policy });
        await engine.run('go');
        expect(seen).toEqual([{ id: `urn:agent:${agent.id}`, assurance: 'self-asserted' }]);
    });
});

describe('the explicit opt-out, for tests', () => {
    it('lets the agent act, and the audit says it had no identity instead of staying silent', async () => {
        const { engine, sink, ran, events } = build([calls(['read_file', {}], ['read_file', {}]), { content: 'done' }], { requireAgentIdentity: false });
        await engine.run('go');
        expect(ran).toEqual(['read_file', 'read_file']);
        expect(sink.events.every(e => e.agentIdentityMissing === true && e.decision === 'allow')).toBe(true);
        // warned once for the agent, not once per call
        expect(events.filter(e => e.type === 'system' && /no digital identity/.test((e as { text: string }).text))).toHaveLength(1);
    });
});

describe('a provider that cannot be trusted fails closed', () => {
    const failing = (resolve: AgentIdentityProvider['resolve']): Partial<BaseEngineOptions> => ({ agentIdentity: { resolve }, identity: alice, agentIdentityCacheMs: 0 });

    it('a provider that throws is a denial, not "no identity needed", even with the opt-out', async () => {
        for (const requireAgentIdentity of [true, false]) {
            const { engine, sink, ran } = build(once(), { ...failing(() => { throw new Error('down'); }), requireAgentIdentity });
            await engine.run('go');
            expect(ran).toEqual([]);
            expect(sink.events[0]).toMatchObject({ decision: 'deny', reason: expect.stringMatching(/identity provider failed: down/) });
        }
    });

    it('a provider that does not answer in time is a denial', async () => {
        const { engine, sink, ran } = build(once(), { ...failing(() => new Promise<never>(() => undefined)), agentIdentityTimeoutMs: 20 });
        await engine.run('go');
        expect(ran).toEqual([]);
        expect(sink.events[0]!.reason).toMatch(/no answer in 20 ms/);
    });

    it('a failure is not remembered: the next call asks the provider again', async () => {
        let n = 0;
        const { engine, sink } = build([calls(['read_file', {}]), calls(['read_file', {}]), { content: 'done' }], {
            agentIdentity: { resolve: (id) => { if (n++ === 0) throw new Error('blip'); return { id: `x:${id}` }; } }, identity: alice, agentIdentityCacheMs: 60_000,
        });
        await engine.run('go');
        expect(sink.events.map(e => e.decision)).toEqual(['deny', 'allow']);
    });

    it('an identity with no id is refused', async () => {
        const { engine, ran } = build(once(), failing(() => ({ id: '' })));
        await engine.run('go');
        expect(ran).toEqual([]);
    });
});

describe('what the provider is told, and how long its answer lives', () => {
    it('is given the agent, the session and who the agent acts for', async () => {
        const resolve = jest.fn((id: string): AgentIdentity => ({ id: `x:${id}` }));
        const { engine } = build(once(), { agentIdentity: { resolve }, identity: { userId: 'alice', tenantId: 't1' } });
        await engine.run('go');
        expect(resolve).toHaveBeenCalledWith(agent.id, { sessionId: 'sess-1', tenantId: 't1', userId: 'alice' });
    });

    it('an identity revoked at the provider stops being accepted: at once with cacheMs 0, within the cache time otherwise', async () => {
        let revoked = false;
        const provider: AgentIdentityProvider = { resolve: (id) => (revoked ? undefined : { id: `x:${id}` }) };
        const { engine, sink, ran } = build([calls(['read_file', {}]), calls(['read_file', {}]), { content: 'done' }], {
            agentIdentity: { resolve: (id, c) => { const r = provider.resolve(id, c); if (!revoked) revoked = true; return r; } },
            identity: alice, agentIdentityCacheMs: 0,
        });
        await engine.run('go');
        expect(ran).toEqual(['read_file']);
        expect(sink.events.map(e => e.decision)).toEqual(['allow', 'deny']);
    });

    it('a cached answer is reused, so the provider is not asked on every call', async () => {
        const resolve = jest.fn((id: string): AgentIdentity => ({ id: `x:${id}` }));
        const { engine } = build([calls(['read_file', {}], ['read_file', {}], ['read_file', {}]), { content: 'done' }], { agentIdentity: { resolve }, identity: alice, agentIdentityCacheMs: 60_000 });
        await engine.run('go');
        expect(resolve).toHaveBeenCalledTimes(1);
    });
});

describe('a delegation: each agent acts under its own identity', () => {
    it('the sub-agent is attributed to its identity, and denied if it has none', async () => {
        const provider = staticAgentIdentities({ [agent.id]: { id: 'did:ex:main' }, helper: { id: 'did:ex:helper' } });
        const script: Turn[] = [
            calls(['ask_agent', { agent_id: 'helper', question: 'q' }]),
            calls(['read_file', {}]),     // the helper's call
            { content: 'helper answer' },
            { content: 'done' },
        ];
        const { engine, sink } = build(script, { agentIdentity: provider, identity: alice });
        await engine.run('go');
        const byTool = Object.fromEntries(sink.events.map(e => [e.principal.agentId, e.agentIdentity?.id]));
        expect(byTool).toMatchObject({ [agent.id]: 'did:ex:main', helper: 'did:ex:helper' });

        const onlyMain = staticAgentIdentities({ [agent.id]: { id: 'did:ex:main' } });
        const second = build(script, { agentIdentity: onlyMain, identity: alice });
        await second.engine.run('go');
        expect(second.ran).toEqual([]);
        expect(second.sink.events.find(e => e.principal.agentId === 'helper')).toMatchObject({ decision: 'deny', agentIdentityMissing: true });
    });
});

describe('the reference providers', () => {
    it('static: gives what it holds, marks it self-asserted unless told otherwise, and has nothing for the rest', () => {
        const p = staticAgentIdentities({ a: { id: 'did:ex:a' }, b: { id: 'did:ex:b', assurance: 'high' } });
        const ctx = { sessionId: 's' };
        expect(p.resolve('a', ctx)).toEqual({ id: 'did:ex:a', assurance: 'self-asserted' });
        expect(p.resolve('b', ctx)).toMatchObject({ assurance: 'high' });
        expect(p.resolve('c', ctx)).toBeUndefined();
        // inherited property names are not agents
        expect(p.resolve('constructor', ctx)).toBeUndefined();
        expect(p.resolve('__proto__', ctx)).toBeUndefined();
    });
});
