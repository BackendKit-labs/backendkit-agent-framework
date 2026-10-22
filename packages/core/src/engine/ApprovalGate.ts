import type { Transport } from '../transport/Transport';
import type { ToolApprovalDecision } from '../types';

export interface ApprovalGateOptions {
    onToolApproval?: (toolName: string, agentId: string, argsPreview: string) => Promise<ToolApprovalDecision>;
    transport: Transport;
}

export class ApprovalGate {
    private disabled = false;

    private static readonly WRITE_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);

    /**
     * Commands that always require user approval regardless of iteration mode or
     * disabled flag. These are irreversible or high-blast-radius operations:
     * installing new packages, removing packages, running destructive npm scripts.
     */
    private static readonly ALWAYS_ASK_PATTERNS: RegExp[] = [
        /^\s*npm\s+(install|i|add)\s+[^-]/i,
        /^\s*npm\s+uninstall\b/i,
        /^\s*yarn\s+add\s+[^-]/i,
        /^\s*pnpm\s+add\s+[^-]/i,
        /^\s*pip\s+install\b/i,
        /^\s*pip3\s+install\b/i,
    ];

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
    ): Promise<'run' | 'rejected' | 'no-approver'> {
        // The policy wants a human and there is none: refuse. Never "run because nobody can be asked".
        // Not even disableToolApproval() lifts this: without an approver that flag can only come from code,
        // never from a person choosing "approve all".
        if (sandbox === 'ask' && !this.opts.onToolApproval) return 'no-approver';
        if (!this.opts.onToolApproval) return 'run';

        const preview = call.args.slice(0, 200);

        if (this.requiresAlwaysAsk(call)) {
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
        const asks = sandbox !== undefined ? sandbox === 'ask' : ApprovalGate.WRITE_TOOLS.has(call.name);
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

    private requiresAlwaysAsk(call: { name: string; args: string }): boolean {
        if (call.name !== 'run_command') return false;
        try {
            const { command } = JSON.parse(call.args) as { command?: string };
            if (!command) return false;
            return ApprovalGate.ALWAYS_ASK_PATTERNS.some(re => re.test(command));
        } catch {
            return false;
        }
    }
}
