/**
 * An identity nobody vouches for works, and the audit says so; the person who starts the agent hears it too, once. These run with NODE_ENV set to
 * something other than "test", because under a test runner the warning is silent on purpose (it would be noise on every run).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBaseEngine } from '../../engine/createBaseEngine';
import { createToolServer } from '../../mcp/tool-server';
import { IdentityResolver, ed25519AgentIdentities, selfAssertedIdentities, staticAgentIdentities, type AgentIdentityProvider } from '../agent-identity';
import { defineTool, z } from '../../tools/defineTool';
import type { AgentProfile } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';
import { generateKeyPairSync } from 'node:crypto';

const ctx = { sessionId: 's', userId: 'alice' };
const ENV = process.env.NODE_ENV;
beforeEach(() => { process.env.NODE_ENV = 'development'; });
afterEach(() => { process.env.NODE_ENV = ENV; });

const resolver = (provider: AgentIdentityProvider, extra: { require?: boolean } = {}) => {
    const warnings: string[] = [];
    return { warnings, resolver: new IdentityResolver({ provider, warn: (t) => warnings.push(t), ...extra }) };
};

describe('the self-asserted identity warning', () => {
    it('says it once, however many calls and agents there are, and says what it means', async () => {
        const { warnings, resolver: r } = resolver(selfAssertedIdentities());
        await r.check('a', ctx); await r.check('a', ctx); await r.check('b', ctx);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/self-asserted identity.*nobody vouches.*not for a regulated environment/s);
    });

    it('also when the identity is signed with a key you hold: it is still not vouched for by anyone', async () => {
        const { warnings, resolver: r } = resolver(ed25519AgentIdentities({ a: { id: 'did:ex:a', privateKey: generateKeyPairSync('ed25519').privateKey } }));
        await r.check('a', ctx);
        expect(warnings).toHaveLength(1);
    });

    it('not when someone vouches for it (an assurance level other than self-asserted)', async () => {
        const { warnings, resolver: r } = resolver(staticAgentIdentities({ a: { id: 'did:ex:a', assurance: 'high' } }));
        await r.check('a', ctx);
        expect(warnings).toEqual([]);
    });

    it('not when the call is refused anyway (no one to act for): it warns about what runs', async () => {
        const { warnings, resolver: r } = resolver(selfAssertedIdentities());
        expect(await r.check('a', { sessionId: 's' })).toMatchObject({ ok: false });
        expect(warnings).toEqual([]);
    });

    it('also with the requirement off, where an identity is still given', async () => {
        const { warnings, resolver: r } = resolver(selfAssertedIdentities(), { require: false });
        await r.check('a', ctx);
        expect(warnings).toHaveLength(1);
    });

    it('is silent under a test runner (NODE_ENV=test)', async () => {
        process.env.NODE_ENV = 'test';
        const { warnings, resolver: r } = resolver(selfAssertedIdentities());
        await r.check('a', ctx);
        expect(warnings).toEqual([]);
    });
});

describe('where the person who starts the agent hears it', () => {
    const tool = defineTool({ name: 'ping', description: '', readOnly: true, input: z.object({}), execute: async () => 'pong' });
    const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['ping'], delegatesTo: [] };

    it('the engine: one system warning in the transport, on the first call', async () => {
        const { transport, events } = createMockTransport();
        const engine = createBaseEngine({
            providers: { mock: createScriptedProvider([{ tool_calls: [{ id: 'c1', name: 'ping', args: {} }] }, { tool_calls: [{ id: 'c2', name: 'ping', args: {} }] }, { content: 'done' }]) }, defaultProvider: 'mock',
            agents: [main], defaultAgent: 'main', tools: [tool], transport, workingDir: process.cwd(), iterationMode: 'auto',
            agentIdentity: selfAssertedIdentities(), identity: { userId: 'alice' },
        } as never);
        await engine.run('ping twice');
        const warns = events.filter((e: { type: string; level?: string; text?: string }) => e.type === 'system' && e.level === 'warn' && /self-asserted/.test(e.text ?? ''));
        expect(warns).toHaveLength(1);
    });

    it('the direct tool server: one line on stderr, tagged with the name of the server', async () => {
        const lines: string[] = [];
        const write = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => { lines.push(String(chunk)); return true; });
        try {
            const server = createToolServer({ name: 'srv', tools: [tool], identity: { userId: 'alice' }, agentIdentity: selfAssertedIdentities() });
            const [c, s] = InMemoryTransport.createLinkedPair();
            await server.connect(s);
            const client = new Client({ name: 'c', version: '0' });
            await client.connect(c);
            try { await client.callTool({ name: 'ping', arguments: {} }); await client.callTool({ name: 'ping', arguments: {} }); } finally { await client.close(); await server.close(); }
        } finally { write.mockRestore(); }
        const warned = lines.filter(l => /\[srv\].*self-asserted/.test(l));
        expect(warned).toHaveLength(1);
    });
});
