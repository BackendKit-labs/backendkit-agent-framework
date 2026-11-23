import { createBaseEngine, MemoryAuditSink } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport, testIdentity } from '../index';

describe('testIdentity', () => {
    it('is enough for an engine to act under the default requirement, and the audit shows it is self-asserted', async () => {
        const sink = new MemoryAuditSink();
        const engine = createBaseEngine({
            ...testIdentity(),
            providers: { mock: scriptedProvider([{ tool_calls: [{ id: 'c1', name: 'ping', args: {} }] }, { content: 'done' }]) }, defaultProvider: 'mock',
            agents: [{ id: 'a', name: 'A', icon: 'a', description: '', systemPrompt: '', allowedTools: ['ping'], delegatesTo: [] }], defaultAgent: 'a',
            tools: [{ name: 'ping', description: '', parameters: { type: 'object' }, readOnly: true, execute: async () => 'pong' }],
            transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto', audit: sink,
        });
        await engine.run('go');
        expect(sink.events[0]).toMatchObject({ decision: 'allow', principal: { userId: 'test-user' }, agentIdentity: { id: 'urn:test:agent:a', assurance: 'self-asserted' } });
    });
});
