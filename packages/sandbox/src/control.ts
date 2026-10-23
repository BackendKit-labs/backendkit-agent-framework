import type { PolicyControl } from '@backendkit-labs/agent-core';
import { checkNarrower, describeViolations } from './inherit';
import { parsePolicyConfig, type SandboxPolicy, type SandboxPolicyConfig } from './policy';

export interface SandboxPolicyControlOptions {
    /**
     * The widest policy the operator accepts for this agent. A request beyond it is refused whatever the approver says;
     * below it, widening still needs the approval `createEngineControl` asks for. Without a ceiling, only approval limits.
     */
    ceiling?: SandboxPolicyConfig;
}

/**
 * Lets `createEngineControl` read and change a sandbox policy: narrowing goes through, widening is flagged for approval
 * (the comparison is `checkNarrower`), and nothing beyond the ceiling is applied.
 */
export function sandboxPolicyControl(policy: SandboxPolicy, options: SandboxPolicyControlOptions = {}): PolicyControl {
    const ceiling = options.ceiling ? parsePolicyConfig(options.ceiling) : undefined;
    return {
        read: () => ({ version: policy.version, policy: policy.snapshot() }),

        review(candidate) {
            let next: SandboxPolicyConfig;
            try { next = parsePolicyConfig(candidate); }
            catch (err) { return { kind: 'invalid', message: (err as Error).message }; }

            if (ceiling) {
                const within = checkNarrower(ceiling, next);
                if (!within.ok) {
                    return { kind: 'beyond-ceiling', message: `the requested policy exceeds the ceiling: ${describeViolations(within.violations)}`, details: within.violations };
                }
            }
            const verdict = checkNarrower(policy.snapshot(), next);
            return verdict.ok ? { kind: 'narrower', next } : { kind: 'wider', next, details: verdict.violations };
        },

        apply(next) {
            policy.set(next as SandboxPolicyConfig);
            return policy.version;
        },
    };
}
