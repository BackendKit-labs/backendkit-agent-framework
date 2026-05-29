import type { AgentRef, WorkflowDef, WorkflowStepDef } from './types';

export interface StepOptions {
    /** Prompt passed to the agent. */
    input: string;
    /** Step IDs this step waits for. Parallel by default when no deps. */
    dependsOn?: string[];
    /** Pause for human approval before this step executes. */
    requireApproval?: boolean;
}

export class WorkflowBuilder {
    private readonly _steps: WorkflowStepDef[] = [];

    constructor(private readonly _name: string) {}

    step(id: string, agentRef: AgentRef, opts: StepOptions): this {
        if (this._steps.some(s => s.id === id)) {
            throw new Error(`Workflow "${this._name}": duplicate step id "${id}"`);
        }
        this._steps.push({
            id,
            agentId: agentRef.id,
            input: opts.input,
            dependsOn: opts.dependsOn ?? [],
            requireApproval: opts.requireApproval ?? false,
        });
        return this;
    }

    build(): WorkflowDef {
        this.validate();
        return { name: this._name, steps: [...this._steps] };
    }

    private validate(): void {
        const ids = new Set(this._steps.map(s => s.id));

        for (const step of this._steps) {
            for (const dep of step.dependsOn) {
                if (!ids.has(dep)) {
                    throw new Error(
                        `Workflow "${this._name}": step "${step.id}" depends on unknown step "${dep}"`,
                    );
                }
            }
        }

        // DFS cycle detection
        const depMap = new Map(this._steps.map(s => [s.id, s.dependsOn]));
        const visited = new Set<string>();
        const inStack = new Set<string>();

        const dfs = (id: string) => {
            if (inStack.has(id)) {
                throw new Error(`Workflow "${this._name}": dependency cycle detected at step "${id}"`);
            }
            if (visited.has(id)) return;
            inStack.add(id);
            for (const dep of depMap.get(id) ?? []) dfs(dep);
            inStack.delete(id);
            visited.add(id);
        };

        for (const step of this._steps) dfs(step.id);
    }
}

/** Creates a new workflow builder. */
export function workflow(name: string): WorkflowBuilder {
    return new WorkflowBuilder(name);
}

/** Creates an agent reference for use in workflow step definitions. */
export function agent(id: string): AgentRef {
    return { id };
}
