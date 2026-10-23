import type { AgentContext, FlowDescriptor, FlowRunState } from '../types';

/**
 * What a service plugs into `AgentServer` to host flows that a supervisor can start, watch and steer. The protocol only
 * defines the surface; the host runs the flows. Starting and watching use the run key; pausing, resuming and cancelling
 * are control and need the `controlApiKey`. Throw a `ControlError` (`TASK_NOT_FOUND`, `CAPABILITY_NOT_FOUND`, ...) to answer
 * with a specific code.
 */
export interface FlowHandler {
    /** The flows this agent hosts (also published in `info.flows`). */
    flows(): FlowDescriptor[];
    start(flow: string, input: Record<string, unknown>, context: AgentContext): Promise<{ flowRunId: string }>;
    status(flowRunId: string): Promise<FlowRunState>;
    pause(flowRunId: string): Promise<FlowRunState>;
    resume(flowRunId: string): Promise<FlowRunState>;
    cancel(flowRunId: string): Promise<FlowRunState>;
}
