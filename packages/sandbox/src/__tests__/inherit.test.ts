import { checkNarrower, describeViolations, isNarrowerOrEqual } from '../index';
import type { SandboxPolicyConfig } from '../index';

const dims = (parent: SandboxPolicyConfig, child: SandboxPolicyConfig) => {
    const v = checkNarrower(parent, child);
    return v.ok ? [] : v.violations.map(x => x.dimension);
};

describe('policy inheritance: a child is never wider than its parent', () => {
    it('the same policy is allowed (equal counts as narrower-or-equal)', () => {
        for (const preset of ['read-only', 'ask', 'auto-edit', 'full'] as const) {
            expect(isNarrowerOrEqual({ preset }, { preset })).toBe(true);
        }
    });

    describe('mode', () => {
        it('narrowing is fine, widening is refused', () => {
            expect(isNarrowerOrEqual({ preset: 'full' }, { preset: 'ask' })).toBe(true);
            expect(isNarrowerOrEqual({ mode: 'workspace-write' }, { mode: 'read-only', approval: 'writes-and-commands' })).toBe(true);
            expect(dims({ preset: 'ask' }, { preset: 'full' })).toContain('mode');
            expect(dims({ mode: 'read-only' }, { mode: 'workspace-write' })).toContain('mode');
        });

        it('a rule that widens one agent counts: the policy is as wide as its widest rule', () => {
            const parent: SandboxPolicyConfig = { preset: 'read-only', rules: [{ agentId: 'builder', mode: 'workspace-write' }] };
            expect(isNarrowerOrEqual(parent, { preset: 'read-only' })).toBe(true);
            // the child hides the widening in a rule: still refused
            expect(dims({ preset: 'read-only' }, { preset: 'read-only', rules: [{ tool: 'run_command', mode: 'danger-full-access' }] })).toContain('mode');
            // and a child that is only as wide as the parent's rule is fine
            expect(isNarrowerOrEqual(parent, { mode: 'workspace-write', approval: 'none' })).toBe(true);
        });
    });

    describe('network', () => {
        it('closed under an open parent is fine; open under a closed parent is refused', () => {
            expect(isNarrowerOrEqual({ preset: 'full' }, { preset: 'full', network: 'none' })).toBe(true);
            expect(dims({ preset: 'ask' }, { preset: 'ask', network: 'allow' })).toEqual(['network']);
        });

        it('a rule that opens the network is seen, even under a closed base', () => {
            expect(dims({ preset: 'ask' }, { preset: 'ask', rules: [{ tool: 'run_command', network: 'allow' }] })).toEqual(['network']);
        });

        it('the default follows the mode, so full access without an explicit network is open', () => {
            expect(dims({ preset: 'ask' }, { preset: 'full', approval: 'writes-and-commands' })).toEqual(expect.arrayContaining(['mode', 'network']));
        });
    });

    describe('approval', () => {
        it('the child must ask at least as much', () => {
            expect(isNarrowerOrEqual({ preset: 'auto-edit' }, { preset: 'ask' })).toBe(true);
            expect(dims({ preset: 'ask' }, { preset: 'auto-edit' })).toEqual(['approval']);
            expect(dims({ preset: 'auto-edit' }, { mode: 'workspace-write', approval: 'none' })).toEqual(['approval']);
        });

        it('a read-only child of an asking parent must still ask for commands (it can still run them)', () => {
            expect(dims({ preset: 'ask' }, { preset: 'read-only' })).toEqual(['approval']);
            expect(isNarrowerOrEqual({ preset: 'ask' }, { preset: 'read-only', approval: 'writes-and-commands' })).toBe(true);
        });
    });

    describe('roots', () => {
        it('roots inside the parent roots are fine, others are refused', () => {
            const parent: SandboxPolicyConfig = { preset: 'ask', roots: ['/data/company'] };
            expect(isNarrowerOrEqual(parent, { preset: 'ask', roots: ['/data/company/reports'] })).toBe(true);
            expect(isNarrowerOrEqual(parent, { preset: 'ask' })).toBe(true);
            expect(dims(parent, { preset: 'ask', roots: ['/data/other'] })).toEqual(['roots']);
            expect(dims(parent, { preset: 'ask', roots: ['/data/company-secrets'] })).toEqual(['roots']);
        });

        it('a child with roots under a parent with none is refused; roots are moot under full access', () => {
            expect(dims({ preset: 'ask' }, { preset: 'ask', roots: ['/x'] })).toEqual(['roots']);
            expect(isNarrowerOrEqual({ preset: 'full' }, { preset: 'ask', roots: ['/anything'] })).toBe(true);
        });
    });

    describe('tool lists', () => {
        it('the child cannot un-list a write tool the parent lists', () => {
            const parent: SandboxPolicyConfig = { preset: 'read-only', writeTools: ['write_file', 'edit_file'] };
            expect(isNarrowerOrEqual(parent, { preset: 'read-only', writeTools: ['write_file', 'edit_file', 'extra'] })).toBe(true);
            expect(dims(parent, { preset: 'read-only', writeTools: ['write_file'] })).toEqual(['writeTools']);
            expect(dims(parent, { preset: 'read-only' })).toEqual(['writeTools']);
        });

        it('commandTools defaults to run_command, so dropping it is refused and the default equals itself', () => {
            expect(isNarrowerOrEqual({ preset: 'ask' }, { preset: 'ask', commandTools: ['run_command', 'terminal'] })).toBe(true);
            expect(dims({ preset: 'ask' }, { preset: 'ask', commandTools: ['other'] })).toEqual(['commandTools']);
            expect(dims({ preset: 'ask', commandTools: ['run_command', 'shell'] }, { preset: 'ask' })).toEqual(['commandTools']);
        });
    });

    describe('environment', () => {
        it('the child may allow only what the parent allows', () => {
            const parent: SandboxPolicyConfig = { preset: 'ask', env: { allow: ['GH_TOKEN'] } };
            expect(isNarrowerOrEqual(parent, { preset: 'ask', env: { allow: ['GH_TOKEN'] } })).toBe(true);
            expect(isNarrowerOrEqual(parent, { preset: 'ask' })).toBe(true);
            expect(dims(parent, { preset: 'ask', env: { allow: ['GH_TOKEN', 'DEEPSEEK_API_KEY'] } })).toEqual(['env.allow']);
            expect(dims({ preset: 'ask' }, { preset: 'ask', env: { allow: ['AWS_SECRET_ACCESS_KEY'] } })).toEqual(['env.allow']);
        });

        it('the child must keep every variable the parent denies', () => {
            const parent: SandboxPolicyConfig = { preset: 'ask', env: { deny: ['INTERNAL_URL'] } };
            expect(isNarrowerOrEqual(parent, { preset: 'ask', env: { deny: ['INTERNAL_URL', 'OTHER'] } })).toBe(true);
            expect(dims(parent, { preset: 'ask' })).toEqual(['env.deny']);
        });
    });

    it('reports every violation at once, in words a person can read', () => {
        const v = checkNarrower({ preset: 'read-only', roots: ['/a'] }, { preset: 'full', roots: ['/b'], approval: 'none' });
        expect(v.ok).toBe(false);
        if (v.ok) return;
        expect(v.violations.map(x => x.dimension)).toEqual(expect.arrayContaining(['mode', 'network']));
        expect(describeViolations(v.violations)).toMatch(/mode: child danger-full-access vs parent read-only/);
    });

    it('an empty policy is the default (ask), so it can be compared like any other', () => {
        expect(isNarrowerOrEqual({}, { preset: 'ask' })).toBe(true);
        expect(dims({}, { preset: 'auto-edit' })).toEqual(['approval']);
    });
});
