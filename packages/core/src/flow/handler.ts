import { FlowHost, type FlowInfo, type FlowRunView, type InProcessFlow } from './host';

/**
 * The surface `AgentServer` takes as `flowHandler` (`FlowHandler` of `@backendkit-labs/agent-protocol`, protocol 1.1), declared here
 * with the same shape so that core depends on no transport. A supervisor elsewhere starts, watches, pauses, resumes and cancels
 * the flows through it.
 */
export interface FlowHandlerPort {
    flows(): Array<FlowInfo>;
    start(flow: string, input: Record<string, unknown>, context?: unknown): Promise<{ flowRunId: string }>;
    status(flowRunId: string): Promise<FlowRunView>;
    pause(flowRunId: string): Promise<FlowRunView>;
    resume(flowRunId: string): Promise<FlowRunView>;
    cancel(flowRunId: string): Promise<FlowRunView>;
}

/** A refusal with a protocol code. `AgentServer` recognises it by `name` and `code`, the way it does `EngineControlError`. */
export class FlowControlError extends Error {
    constructor(readonly code: 'TASK_NOT_FOUND' | 'CAPABILITY_NOT_FOUND', message: string) {
        super(message);
        this.name = 'ControlError';
    }
}

/**
 * The flows of an agent as the `flowHandler` an `AgentServer` takes (SPEC-0023 F4). A run the host does not know is a
 * `TASK_NOT_FOUND` to the caller (a restarted supervisor reads that as "lost"); a flow it does not host is `CAPABILITY_NOT_FOUND`.
 *
 *     const { handler, host } = createFlowHandler({ 'close-month': { steps: ['collect', 'report'], run: async (input, ctl) => { ... } } });
 *     new AgentServer({ ..., flowHandler: handler, controlApiKey });
 */
export function createFlowHandler(flows: Record<string, InProcessFlow>, options: { cancelGraceMs?: number } = {}): { handler: FlowHandlerPort; host: FlowHost } {
    const host = new FlowHost(flows, options.cancelGraceMs);
    const known = async <T>(fn: () => Promise<T>): Promise<T> => {
        try { return await fn(); }
        catch (err) {
            const code = (err as { code?: string }).code;
            if (code === 'RUN_NOT_FOUND') throw new FlowControlError('TASK_NOT_FOUND', (err as Error).message);
            if (code === 'CAPABILITY_NOT_FOUND') throw new FlowControlError('CAPABILITY_NOT_FOUND', (err as Error).message);
            throw err;
        }
    };
    const descriptors: FlowInfo[] = Object.entries(flows).map(([name, f]) => ({ name, ...(f.description ? { description: f.description } : {}), ...(f.steps ? { steps: f.steps } : {}) }));
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
