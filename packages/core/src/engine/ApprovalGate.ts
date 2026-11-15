import type { Transport } from '../transport/Transport';
import type { ToolApprovalDecision, ToolDefinition } from '../types';

export interface ApprovalGateOptions {
    onToolApproval?: (toolName: string, agentId: string, argsPreview: string) => Promise<ToolApprovalDecision>;
    transport: Transport;
}

export class ApprovalGate {
    private disabled = false;

    constructor(private readonly opts: ApprovalGateOptions) {}

    /**
     * Determines whether a tool call may proceed.
     *
     * Returns 'run' if the tool should execute, 'rejected' if the user blocked it.
     * Emits tool_approval_request events and invokes the onToolApproval callback
     * when required. Mutates the disabled flag on 'approve_all'.
     */
    async check(
        call: { name: string; args: string },
        agentId: string,
        /** What the sandbox policy says about this tool. Absent: the built-in list of tools that ask applies. */
        sandbox?: 'none' | 'ask',
        /** The facts the tool declares: `readOnly: false` asks, `alwaysAsk` asks even after "approve all". */
        tool?: Pick<ToolDefinition, 'readOnly' | 'alwaysAsk'>,
    ): Promise<'run' | 'rejected' | 'no-approver'> {
        // The policy wants a human and there is none: refuse. Never "run because nobody can be asked".
        // Not even disableToolApproval() lifts this: without an approver that flag can only come from code,
        // never from a person choosing "approve all".
        if (sandbox === 'ask' && !this.opts.onToolApproval) return 'no-approver';
        if (!this.opts.onToolApproval) return 'run';

        const preview = call.args.slice(0, 200);

        if (this.requiresAlwaysAsk(call, tool)) {
            this.opts.transport.emit({
                type: 'tool_approval_request',
                tool_name: call.name,
                agent_id: agentId,
                args_preview: preview,
            });
            const decision = await this.opts.onToolApproval(call.name, agentId, preview);
            return decision === 'reject' ? 'rejected' : 'run';
        }

        // With a sandbox policy in charge, it alone decides which tools ask.
        const asks = sandbox !== undefined ? sandbox === 'ask' : tool?.readOnly === false;
        if (!this.disabled && asks) {
            this.opts.transport.emit({
                type: 'tool_approval_request',
                tool_name: call.name,
                agent_id: agentId,
                args_preview: preview,
            });
            const decision = await this.opts.onToolApproval(call.name, agentId, preview);
            if (decision === 'approve_all') this.disabled = true;
            return decision === 'reject' ? 'rejected' : 'run';
        }

        return 'run';
    }

    disable(): void { this.disabled = true; }
    enable(): void  { this.disabled = false; }

    private requiresAlwaysAsk(call: { name: string; args: string }, tool?: Pick<ToolDefinition, 'alwaysAsk'>): boolean {
        if (!tool?.alwaysAsk) return false;
        try {
            const args = JSON.parse(call.args) as unknown;
            return typeof args === 'object' && args !== null && tool.alwaysAsk(args as Record<string, unknown>);
        } catch {
            return false;
        }
    }
}
