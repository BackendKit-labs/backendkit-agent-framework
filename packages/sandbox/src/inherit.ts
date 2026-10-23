import type { SandboxMode, SandboxNetwork } from '@backendkit-labs/agent-core';
import { isInside } from './paths';
import type { SandboxPolicyConfig } from './policy';
import { PERMISSION_PRESETS, type ApprovalLevel } from './presets';

const MODE_RANK: Record<SandboxMode, number> = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 };
const NETWORK_RANK: Record<SandboxNetwork, number> = { none: 0, allow: 1 };
const APPROVAL_RANK: Record<ApprovalLevel, number> = { none: 0, commands: 1, 'writes-and-commands': 2 };

export type InheritanceDimension = 'mode' | 'network' | 'approval' | 'roots' | 'writeTools' | 'commandTools' | 'env.allow' | 'env.deny';

export interface InheritanceViolation {
    dimension: InheritanceDimension;
    /** What the parent allows or requires in that dimension. */
    parent: string;
    /** What the child asks for. */
    child: string;
}

export type InheritanceVerdict = { ok: true } | { ok: false; violations: InheritanceViolation[] };

/** The most a policy can ever allow, across its base setting and every rule (a rule may widen a particular agent or tool). */
function ceiling(c: SandboxPolicyConfig): { mode: SandboxMode; network: SandboxNetwork; approval: ApprovalLevel } {
    const preset = PERMISSION_PRESETS[c.preset ?? 'ask'];
    const baseMode = c.mode ?? preset.mode;
    const scenarios: Array<{ mode: SandboxMode; network: SandboxNetwork }> = [];
    const defaultNet = (m: SandboxMode): SandboxNetwork => (m === 'danger-full-access' ? 'allow' : 'none');
    scenarios.push({ mode: baseMode, network: c.network ?? defaultNet(baseMode) });
    for (const r of c.rules ?? []) {
        const mode = r.mode ?? baseMode;
        scenarios.push({ mode, network: r.network ?? c.network ?? defaultNet(mode) });
    }
    return {
        mode: scenarios.reduce((m, s) => (MODE_RANK[s.mode] > MODE_RANK[m] ? s.mode : m), scenarios[0].mode),
        network: scenarios.reduce((n, s) => (NETWORK_RANK[s.network] > NETWORK_RANK[n] ? s.network : n), scenarios[0].network),
        approval: c.approval ?? preset.approval,
    };
}

const list = (xs: readonly string[] | undefined): string[] => [...(xs ?? [])];
const show = (xs: readonly string[]): string => (xs.length ? xs.join(', ') : '(none)');

/**
 * Is `child` no wider than `parent` in every dimension? A pure function, no I/O: it is what stops a created agent or a
 * sub-agent from having more power than whoever made it. The comparison uses the WIDEST each policy can ever be (its base
 * setting or any rule), so a rule cannot be used to slip past it.
 *
 * - mode and network: the child's widest must not exceed the parent's widest.
 * - approval: the child must ask at least as much as the parent.
 * - roots: each child root must lie inside a parent root (only matters while the parent's widest mode is not full access).
 * - writeTools and commandTools: the child must keep every tool the parent lists (it cannot un-list a tool to dodge the read-only refusal or the approval).
 * - env: the child may allow only variables the parent allows, and must keep every variable the parent denies.
 *
 * Returns every violation, so a caller can show why a request was refused (`POLICY_WIDER_THAN_PARENT`).
 */
export function checkNarrower(parent: SandboxPolicyConfig, child: SandboxPolicyConfig): InheritanceVerdict {
    const violations: InheritanceViolation[] = [];
    const p = ceiling(parent);
    const c = ceiling(child);

    if (MODE_RANK[c.mode] > MODE_RANK[p.mode]) violations.push({ dimension: 'mode', parent: p.mode, child: c.mode });
    if (NETWORK_RANK[c.network] > NETWORK_RANK[p.network]) violations.push({ dimension: 'network', parent: p.network, child: c.network });
    if (APPROVAL_RANK[c.approval] < APPROVAL_RANK[p.approval]) violations.push({ dimension: 'approval', parent: p.approval, child: c.approval });

    if (p.mode !== 'danger-full-access') {
        const parentRoots = list(parent.roots);
        const stray = list(child.roots).filter(root => !parentRoots.some(pr => isInside(pr, root)));
        if (stray.length) violations.push({ dimension: 'roots', parent: show(parentRoots), child: show(stray) });
    }

    const missing = (a: readonly string[] | undefined, b: readonly string[] | undefined) => list(a).filter(x => !list(b).includes(x));
    const writeGap = missing(parent.writeTools, child.writeTools);
    if (writeGap.length) violations.push({ dimension: 'writeTools', parent: show(list(parent.writeTools)), child: `missing ${show(writeGap)}` });
    // commandTools defaults to ['run_command'] when unset (see the policy); compare the effective lists.
    const effCommands = (c: SandboxPolicyConfig) => c.commandTools ?? ['run_command'];
    const commandGap = missing(effCommands(parent), effCommands(child));
    if (commandGap.length) violations.push({ dimension: 'commandTools', parent: show(effCommands(parent)), child: `missing ${show(commandGap)}` });

    const allowGap = list(child.env?.allow).filter(v => !list(parent.env?.allow).includes(v));
    if (allowGap.length) violations.push({ dimension: 'env.allow', parent: show(list(parent.env?.allow)), child: show(allowGap) });
    const denyGap = missing(parent.env?.deny, child.env?.deny);
    if (denyGap.length) violations.push({ dimension: 'env.deny', parent: show(list(parent.env?.deny)), child: `missing ${show(denyGap)}` });

    return violations.length ? { ok: false, violations } : { ok: true };
}

export function isNarrowerOrEqual(parent: SandboxPolicyConfig, child: SandboxPolicyConfig): boolean {
    return checkNarrower(parent, child).ok;
}

/** One line for logs and error messages: why `child` is wider than `parent`. */
export function describeViolations(violations: readonly InheritanceViolation[]): string {
    return violations.map(v => `${v.dimension}: child ${v.child} vs parent ${v.parent}`).join('; ');
}
