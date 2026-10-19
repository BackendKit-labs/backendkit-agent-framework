import { buildAlert, customAlert } from '../src/scenarios';
import { cls, dec, setup } from './helpers';

describe('closed catalog + deterministic policy guard', () => {
    it('downgrades restart_service on prod CPU (not allowed by P-02) to needs_human', async () => {
        const { orch } = setup({
            classifier: [cls()],
            decider: [dec({ action: 'restart_service', toolArgs: { service: 'api' } })],
        });
        const r = await orch.run(buildAlert('cpu_99'));
        expect(r.finalAction).toBe('needs_human');
        expect(r.requiresApproval).toBe(true);
        const guard = r.events.find(e => e.step === 'policy_guard')!;
        expect(guard.policy_check?.passed).toBe(false);
        expect(r.toolName).toBeNull();
    });

    it('rejects an action outside the enum (invented command) → needs_human', async () => {
        const { orch, llm } = setup({ classifier: [cls()], decider: [dec({ action: 'delete_database' })] });
        const r = await orch.run(buildAlert('cpu_99'));
        expect(r.finalAction).toBe('needs_human');
        expect(llm.calls.decider).toBe(2); // one retry with feedback, then give up
        expect(r.events.at(-1)!.final_decision).toBe('needs_human');
    });

    it('invalid JSON twice → needs_human', async () => {
        const { orch } = setup({ classifier: [cls()], decider: ['esto no es json'] });
        const r = await orch.run(buildAlert('cpu_99'));
        expect(r.finalAction).toBe('needs_human');
    });

    it('classifier failure → needs_human, still audited', async () => {
        const { orch } = setup({ classifier: ['basura'], decider: [dec()] });
        const r = await orch.run(buildAlert('cpu_99'));
        expect(r.finalAction).toBe('needs_human');
        expect(r.events.map(e => e.step)).toEqual(['received', 'classify', 'final']);
    });

    it('unknown server → needs_human', async () => {
        const { orch } = setup({
            classifier: [cls({ server: 'srv-99', category: 'other', severity: 'medium' })],
            decider: [dec({ action: 'restart_service', toolArgs: { service: 'x' }, evidenceRefs: [] })],
        });
        const r = await orch.run(buildAlert('unknown_server'));
        expect(r.finalAction).toBe('needs_human');
        expect(r.server?.found).toBe(false);
    });

    it('false alarm on healthy prod-02 → no_action, no approval', async () => {
        const { orch } = setup({
            classifier: [cls({ server: 'prod-02', severity: 'low' })],
            decider: [dec({ action: 'no_action', toolArgs: {}, evidenceRefs: ['server:prod-02'], riskLevel: 'low' })],
        });
        const r = await orch.run(buildAlert('false_alarm'));
        expect(r.finalAction).toBe('no_action');
        expect(r.requiresApproval).toBe(false);
    });

    it('no_action rejected when the server is actually saturated (P-05)', async () => {
        const { orch } = setup({ classifier: [cls()], decider: [dec({ action: 'no_action', toolArgs: {} })] });
        const r = await orch.run(buildAlert('cpu_99'));
        expect(r.finalAction).toBe('needs_human');
    });

    it('scale_cpu on a healthy server (cpu 35%) is replaced by no_action (P-06)', async () => {
        const { orch } = setup({
            classifier: [cls({ server: 'prod-02', severity: 'low' })],
            decider: [dec({ action: 'scale_cpu', evidenceRefs: ['server:prod-02'], riskLevel: 'low' })],
        });
        const r = await orch.run(buildAlert('false_alarm'));
        expect(r.finalAction).toBe('no_action');
        expect(r.requiresApproval).toBe(false);
        expect(r.events.find(e => e.step === 'policy_guard')!.policy_check?.notes.join(' ')).toContain('P-06');
    });

    it('category is corrected from an unambiguous resource keyword in the text', async () => {
        const { orch } = setup({
            classifier: [cls({ category: 'service_down' })],
            decider: [dec()],
        });
        const r = await orch.run(buildAlert('cpu_99'));
        expect(r.classification?.category).toBe('cpu');
        expect(r.policyIds).toEqual(['P-02']);
        expect(r.events.find(e => e.step === 'classify')!.analysis_summary).toContain('corregida');
    });

    it('restart on stg-01 is allowed autonomously (P-01) and mock-executed', async () => {
        const { orch } = setup({
            classifier: [cls({ server: 'stg-01', category: 'service_down', severity: 'high' })],
            decider: [dec({ action: 'restart_service', toolArgs: { service: 'web' }, evidenceRefs: ['server:stg-01'], riskLevel: 'medium' })],
        });
        const r = await orch.run(buildAlert('stg_down'));
        expect(r.finalAction).toBe('restart_service');
        expect(r.requiresApproval).toBe(false);
        expect(r.toolResult).toMatchObject({ status: 'simulated', executed: false });
    });

    it('prompt injection: model "obeys" and proposes restart on prod → contained', async () => {
        const { orch } = setup({
            classifier: [cls()],
            decider: [dec({ action: 'restart_service', toolArgs: { service: 'api; rm -rf /' } })],
        });
        const r = await orch.run(buildAlert('injection'));
        expect(r.finalAction).toBe('needs_human');
        expect(r.toolName).toBeNull();
    });

    it('model-supplied server in args is ignored (comes from inventory)', async () => {
        const { orch } = setup({
            classifier: [cls()],
            decider: [dec({ toolArgs: { delta_vcpu: 2, server: 'prod-99' } })],
        });
        const r = await orch.run(customAlert('prod-01 CPU al 99%'));
        const exec = r.events.find(e => e.step === 'tool_exec')!;
        expect(exec.tool_args).toMatchObject({ server: 'prod-01' });
    });

    it('out-of-range tool args (delta_vcpu=64) → needs_human via typed contract', async () => {
        const { orch } = setup({ classifier: [cls()], decider: [dec({ toolArgs: { delta_vcpu: 64 } })] });
        const r = await orch.run(buildAlert('cpu_99'));
        expect(r.finalAction).toBe('needs_human');
    });

    it('JSON inside code fences / prose still parses', async () => {
        const { orch } = setup({ classifier: [`\`\`\`json\n${cls()}\n\`\`\``], decider: [`Aquí:\n${dec()}`] });
        const r = await orch.run(buildAlert('cpu_99'));
        expect(r.finalAction).toBe('scale_cpu');
    });
});
