import { ControlError } from '@backendkit-labs/agent-protocol';
import type { FlowHandler } from '@backendkit-labs/agent-protocol';
import { InProcessFlows, type InProcessFlow } from './InProcessFlows';

/**
 * The agent's side of Hermes flows over agent-protocol: turns flows written for `InProcessFlows` (cooperative: they pause
 * and stop at their step boundaries) into the `flowHandler` an `AgentServer` takes. A Hermes elsewhere then starts, watches,
 * pauses, resumes and cancels them through its `ProtocolConnector`.
 *
 *     const { handler } = serveFlows({ 'close-month': { steps: [...], run: async (input, ctl) => { ... } } });
 *     new AgentServer({ ..., flowHandler: handler, controlApiKey });
 */
export function serveFlows(flows: Record<string, InProcessFlow>): { handler: FlowHandler; host: InProcessFlows } {
    const host = new InProcessFlows(flows);
    // A run the host does not know is a TASK_NOT_FOUND to the caller (a restarted Hermes reads that as "lost").
    const known = async <T>(fn: () => Promise<T>): Promise<T> => {
        try { return await fn(); }
        catch (err) {
            const code = (err as { code?: string }).code;
            if (code === 'RUN_NOT_FOUND') throw new ControlError('TASK_NOT_FOUND', (err as Error).message);
            if (code === 'CAPABILITY_NOT_FOUND') throw new ControlError('CAPABILITY_NOT_FOUND', (err as Error).message);
            throw err;
        }
    };
    const descriptors = Object.entries(flows).map(([name, f]) => ({ name, ...(f.description ? { description: f.description } : {}), ...(f.steps ? { steps: f.steps } : {}) }));
    return {
        host,
        handler: {
            flows: () => descriptors,
            start: (flow, input) => known(() => host.start(flow, input)),
            status: id => known(() => host.status(id)),
            pause: id => known(() => host.pause(id)),
            resume: id => known(() => host.resume(id)),
            cancel: id => known(() => host.cancel(id)),
        },
    };
}
