import type { SandboxMode } from '@backendkit-labs/agent-core';

/**
 * What needs a human before it runs:
 * - `none`: nothing.
 * - `commands`: running commands.
 * - `writes-and-commands`: file writes and running commands.
 */
export type ApprovalLevel = 'none' | 'commands' | 'writes-and-commands';

export type PermissionPreset = 'read-only' | 'ask' | 'auto-edit' | 'full';

export interface PresetDefinition {
    mode: SandboxMode;
    approval: ApprovalLevel;
    description: string;
}

/**
 * Sandbox mode + approval, by name. `auto-edit` deviates from the SPEC-0006 table on purpose: the command
 * allowlist of `run_command` stays a hard block (it is not a soft list yet), so here "auto-edit" means file
 * edits run without asking and every command asks.
 */
export const PERMISSION_PRESETS: Readonly<Record<PermissionPreset, PresetDefinition>> = {
    'read-only': { mode: 'read-only', approval: 'none', description: 'nothing can write; no approval needed' },
    'ask': { mode: 'workspace-write', approval: 'writes-and-commands', description: 'writes only in the workspace; ask before writes and commands' },
    'auto-edit': { mode: 'workspace-write', approval: 'commands', description: 'writes only in the workspace; file edits run, commands ask' },
    'full': { mode: 'danger-full-access', approval: 'none', description: 'no confinement, no approval' },
};

export function isPermissionPreset(x: unknown): x is PermissionPreset {
    return typeof x === 'string' && Object.prototype.hasOwnProperty.call(PERMISSION_PRESETS, x);
}

/** The preset a (mode, approval) pair corresponds to, or `custom` when it matches none. */
export function matchPreset(mode: SandboxMode, approval: ApprovalLevel): PermissionPreset | 'custom' {
    for (const [name, def] of Object.entries(PERMISSION_PRESETS) as Array<[PermissionPreset, PresetDefinition]>) {
        if (def.mode === mode && def.approval === approval) return name;
    }
    return 'custom';
}

export type ActionKind = 'read' | 'write' | 'command';

/** Does an action of this kind need a human under this approval level? */
export function needsApproval(level: ApprovalLevel, kind: ActionKind): boolean {
    if (level === 'none') return false;
    if (kind === 'command') return true;
    return level === 'writes-and-commands' && kind === 'write';
}
