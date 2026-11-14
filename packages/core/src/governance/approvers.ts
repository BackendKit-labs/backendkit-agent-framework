import { userInfo } from 'node:os';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import type { ApprovalOutcome, ApprovalRequest, Approver, ApproverRef } from './types';

/** A short, human-readable description of what is being approved. */
export function describeApproval(req: ApprovalRequest): string {
    const s = req.subject;
    const what = s.kind === 'tool_call' && 'call' in s
        ? `call tool "${s.call.tool.name}" with ${JSON.stringify(s.call.args)}`
        : s.kind === 'workflow_step' && 'step' in s ? `run step "${s.step}" of workflow "${s.workflow}"`
        : s.kind === 'rule_proposal' && 'evidence' in s ? `adopt a learned rule (${s.evidence})`
        : 'summary' in s ? s.summary : s.kind;
    const chain = req.principal.chain.join(' → ');
    return `Agent "${req.principal.agentId}" (${chain}) wants to ${what}. Reason it needs approval: ${req.reason}.`;
}

/**
 * Another agent as approver (SPEC-0014 §6.2): the request is put to it as a question and its answer must start
 * with APPROVE or REJECT. Its answer counts as `kind: 'agent'`, so the engine checks that it may approve: not for
 * actions that accept only people, not for its own delegation chain, and only for what it could do itself.
 *
 * `consult` is how to ask it, typically `(id, q) => engine.consultAgent(id, q)`.
 */
export function agentApprover(
    consult: (agentId: string, question: string) => Promise<string>,
    agentId: string,
    opts: { chain?: string[] } = {},
): Approver {
    const ref: ApproverRef = { kind: 'agent', id: agentId, chain: opts.chain ?? [agentId] };
    return {
        ref,
        async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
            const question =
                `${describeApproval(req)}\n\n` +
                'You are asked to approve or reject this action. Answer with APPROVE or REJECT as the first word, ' +
                'followed by one sentence explaining why. Do not perform the action yourself.';
            const answer = (await consult(agentId, question)).trim();
            const decision = /^\W*approve\b/i.test(answer) ? 'approve' : 'reject';
            return { decision, by: ref, reason: answer.slice(0, 500), at: new Date().toISOString() };
        },
    };
}

/**
 * A person at a terminal as approver: prints the request and reads y/n. Anything but y/yes rejects.
 * Pass `input`/`output` streams to use something other than stdin/stdout.
 */
export function consoleApprover(opts: { id?: string; input?: Readable; output?: Writable } = {}): Approver {
    const ref: ApproverRef = { kind: 'human', id: opts.id ?? safeUserName() };
    return {
        ref,
        async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
            const rl = createInterface({ input: opts.input ?? process.stdin, output: opts.output ?? process.stdout, terminal: false });
            try {
                const answer = (await rl.question(`\n${describeApproval(req)}\nApprove? [y/N] `)).trim().toLowerCase();
                const decision = answer === 'y' || answer === 'yes' ? 'approve' : 'reject';
                return { decision, by: ref, at: new Date().toISOString() };
            } finally {
                rl.close();
            }
        },
    };
}

function safeUserName(): string {
    try { return userInfo().username || 'operator'; } catch { return 'operator'; }
}
