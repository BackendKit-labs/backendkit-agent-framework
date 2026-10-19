import { buildAlert } from '../src/scenarios';
import { AUDIT_FIELDS, STEPS, ActionEnum } from '../src/types';
import { cls, dec, readLog, setup } from './helpers';

describe('scenario cpu_99 — "Servidor prod-01 caído por CPU al 99%"', () => {
    it('produces a valid, approval-gated, fully audited decision', async () => {
        const { orch, logPath } = setup({ classifier: [cls()], decider: [dec()] });
        const r = await orch.run(buildAlert('cpu_99'));

        expect(ActionEnum.options).toContain(r.finalAction);
        expect(r.finalAction).toBe('scale_cpu');
        expect(r.finalAction).not.toBe('restart_service');
        expect(r.requiresApproval).toBe(true);
        expect(r.policyIds).toEqual(['P-02']);
        expect(r.toolName).toBe('scale_cpu');
        expect(r.toolResult).toMatchObject({ status: 'pending_approval', executed: false });
        expect(r.justification.length).toBeGreaterThanOrEqual(3);
        expect(r.justification.length).toBeLessThanOrEqual(5);
        expect(r.evidence).toEqual(expect.arrayContaining(['server:prod-01', 'policy:P-02', 'incident:INC-014']));

        const lines = readLog(logPath);
        expect(lines.map(l => l['step'])).toEqual([
            'received', 'classify', 'server_status', 'policy_check', 'similar_incidents',
            'decide', 'policy_guard', 'tool_exec', 'final',
        ]);
        for (const l of lines) {
            expect(Object.keys(l).sort()).toEqual([...AUDIT_FIELDS].sort());
            expect(STEPS).toContain(l['step']);
            expect(l['alert_id']).toBe('cpu_99');
        }
        const last = lines[lines.length - 1]!;
        expect(last['final_decision']).toBe('scale_cpu');
        expect(last['requires_approval']).toBe(true);
    });

    it('raises (never lowers) an under-rated severity from inventory facts', async () => {
        const { orch } = setup({ classifier: [cls({ severity: 'low' })], decider: [dec()] });
        const r = await orch.run(buildAlert('cpu_99'));
        expect(r.classification?.severity).toBe('critical');
        expect(r.riskLevel).toBe('high');
        const ev = r.events.find(e => e.step === 'server_status')!;
        expect(ev.analysis_summary).toContain('elevada de low a critical');
    });

    it('drops evidence refs the model invented', async () => {
        const { orch } = setup({
            classifier: [cls()],
            decider: [dec({ evidenceRefs: ['server:prod-01', 'incident:INC-999', 'policy:P-77'] })],
        });
        const r = await orch.run(buildAlert('cpu_99'));
        expect(r.decision?.evidenceRefs).toEqual(['server:prod-01']);
        const decideEvent = r.events.find(e => e.step === 'decide')!;
        expect(decideEvent.analysis_summary).toContain('INC-999');
    });
});
