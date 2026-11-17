import { randomUUID } from 'node:crypto';

/**
 * The flows an agent hosts, with a state a supervisor can see and steer (SPEC-0023 F4). The shapes are those of
 * `FlowRunState` and `FlowHandler` of `@backendkit-labs/agent-protocol` (protocol 1.1), declared here so that core depends on no
 * transport: a handler built from this host plugs into `AgentServer` and a supervisor such as Hermes controls it.
 */

/** `awaiting_approval` and `lost` are protocol 1.2 states; `FlowHost` itself only produces the first five. */
export type FlowStatus = 'running' | 'paused' | 'awaiting_approval' | 'done' | 'failed' | 'cancelled' | 'lost';

export interface FlowStepView { name: string; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'awaiting_approval' | 'interrupted'; detail?: string }

/** A flow run seen from outside: where it is, step by step. */
export interface FlowRunView {
    flowRunId: string;
    flow: string;
    status: FlowStatus;
    currentStep?: string;
    steps: FlowStepView[];
    startedAt: string;
    finishedAt?: string;
    output?: string;
    error?: string;
}

export interface FlowInfo { name: string; description?: string; steps?: string[] }

/** What a flow gets to cooperate with its supervisor: stop when cancelled, wait while paused, and say which step it is on. */
export interface FlowControl {
    /** Aborted when the flow is cancelled. */
    readonly signal: AbortSignal;
    /** Starts a step: waits here while the flow is paused and throws if it was cancelled. The previous step is marked done. */
    step(name: string, detail?: string): Promise<void>;
    /** A point where a flow with no named steps can wait while paused or notice a cancel. */
    checkpoint(): Promise<void>;
    /** Sets a step's status directly, for flows that run steps in parallel (`step()` assumes one at a time). */
    mark(name: string, status: FlowStepView['status'], detail?: string): void;
}

export interface InProcessFlow {
    description?: string;
    /** Step names in order, if known up front; steps that `step()` names later are added as they start. */
    steps?: string[];
    /** Does the work. Return its result; a throw is a failed flow (unless it was cancelled). */
    run(input: Record<string, unknown>, control: FlowControl): Promise<unknown>;
}

export class FlowCancelled extends Error {
    constructor() { super('flow cancelled'); this.name = 'FlowCancelled'; }
}

/** `RUN_NOT_FOUND` (no such run) or `CAPABILITY_NOT_FOUND` (no such flow). `createFlowHandler` turns them into protocol codes. */
export class FlowHostError extends Error {
    constructor(readonly code: 'RUN_NOT_FOUND' | 'CAPABILITY_NOT_FOUND', message: string) {
        super(message);
        this.name = 'FlowHostError';
    }
}

interface Live {
    state: FlowRunView;
    controller: AbortController;
    resume?: () => void;
    paused: boolean;
    settled: Promise<void>;
}

/**
 * Runs the flows of an agent and lets a supervisor see, pause, resume and cancel them. Control is cooperative: a flow
 * pauses or stops at its next `step()` / `checkpoint()`, so it never stops half-way through a step. Cancelling does not
 * wait forever for a flow that never reaches one: after `cancelGraceMs` it is reported cancelled and its result ignored.
 */
export class FlowHost {
    private readonly runs = new Map<string, Live>();

    constructor(private readonly flows: Record<string, InProcessFlow>, private readonly cancelGraceMs = 2000) {}

    async list(): Promise<FlowInfo[]> {
        return Object.entries(this.flows).map(([name, f]) => ({ name, ...(f.description ? { description: f.description } : {}), ...(f.steps ? { steps: f.steps } : {}) }));
    }

    async start(flow: string, input: Record<string, unknown>): Promise<{ flowRunId: string }> {
        const def = this.flows[flow];
        if (!def) throw new FlowHostError('CAPABILITY_NOT_FOUND', `flow "${flow}" not found`);
        const controller = new AbortController();
        const state: FlowRunView = {
            flowRunId: randomUUID(), flow, status: 'running', startedAt: new Date().toISOString(),
            steps: (def.steps ?? []).map((name): FlowStepView => ({ name, status: 'pending' })),
        };
        const live: Live = { state, controller, paused: false, settled: Promise.resolve() };

        const checkpoint = async () => {
            while (live.paused && !controller.signal.aborted) {
                await new Promise<void>(resolve => { live.resume = resolve; });
            }
            if (controller.signal.aborted) throw new FlowCancelled();
        };
        const control: FlowControl = {
            signal: controller.signal,
            checkpoint,
            mark: (name, status, detail) => {
                let entry = state.steps.find(s => s.name === name);
                if (!entry) { entry = { name, status }; state.steps.push(entry); }
                entry.status = status;
                if (detail) entry.detail = detail;
                const running = state.steps.find(s => s.status === 'running');
                if (running) state.currentStep = running.name; else delete state.currentStep;
            },
            step: async (name, detail) => {
                await checkpoint();
                for (const s of state.steps) if (s.status === 'running') s.status = 'done';
                let entry = state.steps.find(s => s.name === name);
                if (!entry) { entry = { name, status: 'pending' }; state.steps.push(entry); }
                entry.status = 'running';
                if (detail) entry.detail = detail;
                state.currentStep = name;
            },
        };

        live.settled = Promise.resolve()
            .then(() => def.run(input, control))
            .then(
                output => controller.signal.aborted ? this.finish(live, 'cancelled', {}) : this.finish(live, 'done', { output: typeof output === 'string' ? output : JSON.stringify(output) ?? '' }),
                err => this.finish(live, controller.signal.aborted ? 'cancelled' : 'failed', controller.signal.aborted ? {} : { error: err instanceof Error ? err.message : String(err) }),
            );
        this.runs.set(state.flowRunId, live);
        return { flowRunId: state.flowRunId };
    }

    private finish(live: Live, status: 'done' | 'failed' | 'cancelled', extra: { output?: string; error?: string }): void {
        const { state } = live;
        if (state.status === 'cancelled' || state.status === 'done' || state.status === 'failed') return;
        for (const s of state.steps) {
            if (s.status === 'running') s.status = status === 'done' ? 'done' : status === 'failed' ? 'failed' : 'skipped';
            else if (s.status === 'pending' && status !== 'done') s.status = 'skipped';
        }
        delete state.currentStep;
        state.status = status;
        state.finishedAt = new Date().toISOString();
        Object.assign(state, extra);
    }

    private live(id: string): Live {
        const live = this.runs.get(id);
        if (!live) throw new FlowHostError('RUN_NOT_FOUND', `flow run ${id} not found`);
        return live;
    }

    async status(flowRunId: string): Promise<FlowRunView> {
        const { state, paused } = this.live(flowRunId);
        return { ...state, status: paused && state.status === 'running' ? 'paused' : state.status, steps: state.steps.map(s => ({ ...s })) };
    }

    async pause(flowRunId: string): Promise<FlowRunView> {
        const live = this.live(flowRunId);
        if (live.state.status === 'running') live.paused = true;
        return this.status(flowRunId);
    }

    async resume(flowRunId: string): Promise<FlowRunView> {
        const live = this.live(flowRunId);
        live.paused = false;
        live.resume?.();
        return this.status(flowRunId);
    }

    async cancel(flowRunId: string): Promise<FlowRunView> {
        const live = this.live(flowRunId);
        if (live.state.status === 'running') {
            live.controller.abort();
            live.paused = false;
            live.resume?.();
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([live.settled, new Promise<void>(r => { timer = setTimeout(r, this.cancelGraceMs); })]);
            clearTimeout(timer);
            this.finish(live, 'cancelled', {});
        }
        return this.status(flowRunId);
    }

    /** Stops every flow still going (the agent leaves the fleet). */
    async close(): Promise<void> {
        await Promise.allSettled([...this.runs.values()].filter(l => l.state.status === 'running').map(l => this.cancel(l.state.flowRunId)));
    }
}
