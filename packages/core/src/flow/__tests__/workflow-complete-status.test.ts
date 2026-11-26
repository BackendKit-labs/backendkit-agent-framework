import { runFlow } from '../run';
import type { StepExecutor } from '../run';
import { FlowDefinitionSchema } from '../types';
import { MemoryApprovalStore } from '../../governance/approval-store';
import { createMockTransport } from '../../__tests__/helpers';

const completeStatus = (events: Array<{ type: string }>) =>
    (events.find(e => e.type === 'workflow_complete') as { status: string } | undefined)?.status;

describe('workflow_complete carries the real status of the flow', () => {
    it('a flow suspended for an approval says awaiting_approval, not failed', async () => {
        const def = FlowDefinitionSchema.parse({
            flow: 'f', trigger: { type: 'manual' },
            steps: [{ id: 'pay', agent: 'x', prompt: 'pay', gate: { approval: 'human' } }],
        });
        const { transport, events } = createMockTransport();
        const executor: StepExecutor = { run: async () => ({ content: 'paid' }) };
        const r = await runFlow(def, { executor, transport, approvals: { store: new MemoryApprovalStore(), identity: { userId: 'u1' } } });
        expect(r.status).toBe('awaiting_approval');
        expect(completeStatus(events)).toBe('awaiting_approval');
    });

    it('a cancelled flow says cancelled, not failed', async () => {
        const def = FlowDefinitionSchema.parse({
            flow: 'f', trigger: { type: 'manual' },
            steps: [{ id: 'a', agent: 'x', prompt: 'a' }],
        });
        const ac = new AbortController();
        const { transport, events } = createMockTransport();
        const executor: StepExecutor = {
            run: (_s, i) => new Promise((_, reject) => {
                i.signal.addEventListener('abort', () => reject(new Error('stopped')));
                ac.abort();
            }),
        };
        const r = await runFlow(def, { executor, transport, signal: ac.signal });
        expect(r.status).toBe('cancelled');
        expect(completeStatus(events)).toBe('cancelled');
    });
});
