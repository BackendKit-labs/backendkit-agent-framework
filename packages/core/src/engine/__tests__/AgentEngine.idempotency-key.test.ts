/** ctx.idempotencyKey: the same logical call carries the same key, so a repeat after a timeout is applied once. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBaseEngine } from '../createBaseEngine';
import { FileApprovalStore } from '../../governance/approval-store';
import type { AgentProfile, ToolDefinition } from '../../types';
import type { ToolPolicy } from '../../governance/types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const agent: AgentProfile = { ...testAgent, id: 'desk', allowedTools: ['pay'], delegatesTo: [] };
const call = (id: string, args: Record<string, unknown>) => ({ id, name: 'pay', args });

function build(script: Turn[], extra: Record<string, unknown> = {}, policy: ToolPolicy = { decide: () => ({ effect: 'allow' }) }) {
    const keys: Array<string | undefined> = [];
    const tool = { name: 'pay', description: '', parameters: { type: 'object' }, destructive: true,
        execute: async (_a: unknown, ctx: { idempotencyKey?: string }) => { keys.push(ctx.idempotencyKey); return 'paid'; } } as ToolDefinition;
    const { transport } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock', agents: [agent], defaultAgent: 'desk',
        tools: [tool], transport, workingDir: process.cwd(), iterationMode: 'auto', policy, ...extra,
    } as never);
    return { engine, keys };
}

describe('ctx.idempotencyKey', () => {
    it('the same call repeated in a run gets the same key; other arguments get another', async () => {
        const { engine, keys } = build([
            { tool_calls: [call('a', { amount: 5 })] },
            { tool_calls: [call('b', { amount: 5 })] },       // the model repeats it (for example after a timeout)
            { tool_calls: [call('c', { amount: 6 })] },
            { content: 'done' },
        ]);
        await engine.run('pay');
        expect(keys).toHaveLength(3);
        expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
        expect(keys[1]).toBe(keys[0]);
        expect(keys[2]).not.toBe(keys[0]);
    });

    it('the key does not depend on the order of the arguments', async () => {
        const { engine, keys } = build([
            { tool_calls: [call('a', { amount: 5, to: 'x' })] },
            { tool_calls: [call('b', { to: 'x', amount: 5 })] },
            { content: 'done' },
        ]);
        await engine.run('pay');
        expect(keys[1]).toBe(keys[0]);
    });

    it('another run is another purchase: another key', async () => {
        const first = build([{ tool_calls: [call('a', { amount: 5 })] }, { content: 'done' }]);
        await first.engine.run('pay');
        const second = build([{ tool_calls: [call('a', { amount: 5 })] }, { content: 'done' }]);
        await second.engine.run('pay');
        expect(second.keys[0]).not.toBe(first.keys[0]);
    });

    describe('a call resumed from a stored approval', () => {
        let dir: string;
        beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'idem-')); });
        afterEach(() => rmSync(dir, { recursive: true, force: true }));

        it('carries the id of the approval', async () => {
            const store = new FileApprovalStore(dir);
            const ask: ToolPolicy = { decide: () => ({ effect: 'ask', reason: 'always', accepts: ['human'] }) };
            const { engine, keys } = build([{ tool_calls: [call('a', { amount: 5 })] }, { content: 'pending' }], { approvals: store }, ask);
            await engine.run('pay');
            const [pending] = await store.list({ status: 'pending' });
            await store.resolve(pending!.id, { decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() });
            await engine.runApproved(pending!.id);
            expect(keys).toEqual([pending!.id]);
        });
    });
});
