export interface AgentRef {
    readonly id: string;
}

export interface WorkflowStepDef {
    id: string;
    agentId: string;
    input: string;
    dependsOn: string[];
    requireApproval: boolean;
}

export interface WorkflowDef {
    name: string;
    steps: WorkflowStepDef[];
}

export interface WorkflowStepResult {
    stepId: string;
    agentId: string;
    content: string;
    status: 'completed' | 'failed' | 'skipped' | 'rejected';
    error?: string;
}

export interface WorkflowResult {
    name: string;
    status: 'completed' | 'failed' | 'rejected';
    steps: Record<string, WorkflowStepResult>;
}

export interface WorkflowRunOptions {
    /**
     * Called before a step with requireApproval: true.
     * Return true to proceed, false to reject (aborts the workflow).
     * Defaults to auto-approve when not provided.
     */
    onApprovalRequired?: (
        step: WorkflowStepDef,
        previousOutputs: Record<string, string>,
    ) => Promise<boolean>;
}
