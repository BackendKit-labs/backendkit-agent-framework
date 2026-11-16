import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { EnterpriseLearning, VaultRuleStore } from '../../learning';
import type { GateRecord } from '../../flow/ComplianceGate';

let vault: string;
beforeEach(() => { vault = fs.mkdtempSync(path.join(os.tmpdir(), 'ent-learning-')); });
afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

const manifest = () => path.join(vault, 'politicas', '_generated', 'manifest.yaml');

function gate(over: Partial<GateRecord> = {}): GateRecord {
    return {
        stepId: 'review-contract', flowId: 'f1', runId: 'r1', executor: 'legal-agent', verdict: 'failed',
        criteria: [{ id: 'c1', description: 'La cláusula incumple la normativa', passed: false, domain: 'legal', failureType: 'non_compliant_clause' }],
        log: [{ at: new Date().toISOString(), event: 'criterion_evaluated' as never, evaluatorId: 'reviewer' }],
        ...over,
    } as GateRecord;
}

describe('EnterpriseLearning: experiences from the gates', () => {
    it('records only the failed criteria and the integrity violations', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault });
        const out = await el.recordGateOutcome(gate({
            criteria: [
                { id: 'c1', description: 'ok', passed: true },
                { id: 'c2', description: 'La cláusula incumple la normativa', passed: false, domain: 'legal', failureType: 'non_compliant_clause' },
            ],
            log: [{ at: '2026-11-15T10:00:00Z', event: 'self_evaluation_attempt', evaluatorId: 'legal-agent', detail: 'same agent' }],
        }));
        expect(out.map(e => e.kind)).toEqual(['non_compliant_clause', 'gate_integrity_violation']);
        expect(out[0]).toMatchObject({ agentId: 'legal-agent', domain: 'legal', severity: 'critical', action: 'review-contract' });
        expect(out[0].meta).toMatchObject({ reportedBy: 'unknown-evaluator', criterionId: 'c2' });
    });

    it('finds the failure type by keyword when the criterion does not name one', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault });
        const [e] = await el.recordGateOutcome(gate({
            criteria: [{ id: 'c1', description: 'Falta la cláusula de confidencialidad', passed: false, domain: 'legal' }],
        }));
        expect(e.kind).toBe('missing_confidentiality');
        expect(e.severity).toBe('high');
    });
});

describe('EnterpriseLearning: a person decides', () => {
    it('a critical failure proposes a rule at once, and nothing applies until it is approved', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault });
        await el.recordGateOutcome(gate());
        const [pending] = await el.pendingPromotions();
        expect(pending.subject).toMatchObject({ kind: 'rule_proposal', rule: { trigger: { domain: 'legal', pattern: 'non_compliant_clause' }, then: { requireQaApproval: true } } });
        expect(await el.activeRules()).toEqual([]);
        expect(fs.existsSync(manifest())).toBe(false);

        const rule = await el.approvePromotion(pending.id, 'ana', 'confirmed with legal');
        expect(rule.approvedBy).toEqual({ kind: 'human', id: 'ana' });
        expect(await el.activeRules({ domain: 'legal' })).toHaveLength(1);
        expect(await el.activeRules({ domain: 'rrhh' })).toEqual([]);
    });

    it('a medium failure needs three, a high one two', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault });
        const high = gate({ criteria: [{ id: 'c', description: 'x', passed: false, domain: 'legal', failureType: 'missing_confidentiality' }] });
        await el.recordGateOutcome(high);
        expect(await el.pendingPromotions()).toEqual([]);
        await el.recordGateOutcome(high);
        expect(await el.pendingPromotions()).toHaveLength(1);
    });

    it('a rejected proposal leaves no rule', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault });
        await el.recordGateOutcome(gate());
        const [pending] = await el.pendingPromotions();
        await el.rejectPromotion(pending.id, 'ana', 'not needed');
        expect(await el.activeRules()).toEqual([]);
        expect(await el.pendingPromotions()).toEqual([]);
    });

    it('keeps the proposals and the experiences between runs', async () => {
        await new EnterpriseLearning({ vaultPath: vault }).recordGateOutcome(gate());
        const again = new EnterpriseLearning({ vaultPath: vault });
        expect(await again.pendingPromotions()).toHaveLength(1);
        expect(await again.patterns()).toHaveLength(1);
    });
});

describe('EnterpriseLearning: the rules live in the vault', () => {
    async function approved(el: EnterpriseLearning) {
        await el.recordGateOutcome(gate());
        const [pending] = await el.pendingPromotions();
        return el.approvePromotion(pending.id, 'ana');
    }

    it('writes the approved rule to manifest.yaml as a policyRules entry', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault });
        const rule = await approved(el);
        const doc = yaml.parse(fs.readFileSync(manifest(), 'utf8'));
        expect(doc.policyRules).toHaveLength(1);
        expect(doc.policyRules[0]).toMatchObject({ id: rule.id, autoGenerated: false, approvedBy: { id: 'ana' }, then: { requireQaApproval: true } });
        expect(doc.policyRules[0].if.keywords).toContain('normativa');
    });

    it('keeps working with the rules and the other keys of an existing manifest', async () => {
        fs.mkdirSync(path.dirname(manifest()), { recursive: true });
        fs.writeFileSync(manifest(), yaml.stringify({ version: 2, policyRules: [{ id: 'POL-LEGA-001', name: 'old', if: { keywords: ['x'] }, then: { requireQaApproval: true }, createdAt: '2026-01-01' }] }));
        const el = new EnterpriseLearning({ vaultPath: vault });
        expect((await el.activeRules())[0]).toMatchObject({ id: 'POL-LEGA-001', approvedBy: { id: 'legacy-manifest' }, approvedAt: '2026-01-01' });
        await approved(el);
        const doc = yaml.parse(fs.readFileSync(manifest(), 'utf8'));
        expect(doc.version).toBe(2);
        expect(doc.policyRules).toHaveLength(2);
    });

    it('counts outcomes, lists the rules that fail too often, and withdraws one when a person agrees', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault });
        const rule = await approved(el);
        for (const o of ['failure', 'failure', 'failure', 'success'] as const) await el.recordRuleOutcome(rule.id, o);
        const [candidate] = await el.demotionCandidates();
        expect(candidate).toMatchObject({ id: rule.id, outcomes: { success: 1, failure: 3 } });
        expect(await el.demotionCandidates({ minTotal: 10 })).toEqual([]);

        expect(await el.approveDemotion(rule.id, 'ana', 'too noisy')).toBe(true);
        expect(await el.activeRules()).toEqual([]);
        expect(await el.approveDemotion(rule.id, 'ana', 'again')).toBe(false);
        // The reason stays in the history without becoming a failure pattern.
        expect(await el.patterns()).toHaveLength(1);
    });
});

describe('VaultRuleStore', () => {
    it('starts empty and reports a missing rule', async () => {
        const store = new VaultRuleStore(path.join(vault, 'none.yaml'));
        expect(await store.list()).toEqual([]);
        expect(await store.remove('x')).toBe(false);
        expect(await store.recordOutcome('x', 'success')).toBe(false);
    });
});

describe('EnterpriseLearning: tenant', () => {
    it('stamps the tenant on experiences and rules, and writes it to the vault', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault, tenantId: 'acme' });
        const [e] = await el.recordGateOutcome(gate());
        expect(e.tenantId).toBe('acme');
        const [pending] = await el.pendingPromotions();
        const rule = await el.approvePromotion(pending.id, 'ana');
        expect(rule.tenantId).toBe('acme');
        expect(yaml.parse(fs.readFileSync(manifest(), 'utf8')).policyRules[0].tenantId).toBe('acme');
        expect((await el.activeRules())[0].tenantId).toBe('acme');
    });
});

describe('EnterpriseLearning: teaching', () => {
    it('a person teaches a lesson with just a name, and it stays inside the tenant of the vault', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault, tenantId: 'acme' });
        const lesson = await el.teach({ text: 'Contracts over 50k need two signatures.', tools: ['sign_contract'] }, 'ana');
        expect(lesson).toMatchObject({ tenantId: 'acme', by: { kind: 'human', id: 'ana' } });
        expect(await el.taught()).toHaveLength(1);
        expect(await el.learning.lessonsFor('legal-agent', 'acme', ['sign_contract'])).toContain('two signatures');
        expect(await el.learning.lessonsFor('legal-agent', 'other', ['sign_contract'])).toBeUndefined();

        // Another process opening the same vault finds it.
        expect(await new EnterpriseLearning({ vaultPath: vault, tenantId: 'acme' }).taught()).toHaveLength(1);
        expect(await el.forget(lesson.id)).toBe(true);
        expect(await el.taught()).toEqual([]);
    });

    it('adds a rule by hand to the vault, attributed to a person', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault });
        const rule = await el.addRule({ if: { keywords: ['despido'] }, then: { requireQaApproval: true }, name: 'Layoffs' }, 'ana', 'HR policy');
        expect(rule).toMatchObject({ approvedBy: { id: 'ana' }, reason: 'HR policy' });
        const doc = yaml.parse(fs.readFileSync(manifest(), 'utf8'));
        expect(doc.policyRules[0]).toMatchObject({ id: rule.id, name: 'Layoffs', approvedBy: { id: 'ana' } });
    });

    it('an agent cannot teach', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault });
        await expect(el.teach({ text: 'x' }, { kind: 'agent', id: 'bot' })).rejects.toThrow(/human/);
    });
});

describe('EnterpriseLearning: the signal', () => {
    it('keeps the counters of correct calls in the vault, next to the rules', async () => {
        const call = (outcome: 'ok' | 'error') => ({
            at: new Date().toISOString(), principal: { agentId: 'legal-agent', sessionId: 's', chain: ['legal-agent'] }, tool: 'sign_contract',
            argsHash: 'abcdef012345', decision: 'allow' as const, outcome, durationMs: 1,
        });
        const first = new EnterpriseLearning({ vaultPath: vault });
        for (let i = 0; i < 200; i++) await first.learning.sink.write(call('ok'));
        await first.learning.flush();
        expect(fs.existsSync(path.join(vault, 'politicas', '_generated', 'counters.json'))).toBe(true);

        const later = new EnterpriseLearning({ vaultPath: vault });
        for (let i = 0; i < 3; i++) await later.learning.sink.write(call('error'));
        expect(await later.patterns()).toEqual([]);
    });
});

describe('EnterpriseLearning: units of lessons', () => {
    it('exports a unit for a domain owner to write in git, and imports it back into the tenant of the vault', async () => {
        const el = new EnterpriseLearning({ vaultPath: vault, tenantId: 'acme' });
        await el.teach({ text: 'Contracts over 50k need two signatures.', tools: ['sign_contract'] }, 'ana');
        const md = await el.exportUnit('sign_contract');
        expect(md).toContain('tenant: acme');
        expect(md).toContain('- Contracts over 50k need two signatures.');

        // The same file, edited, in another vault: the lessons go to that vault's tenant, not to the one in the file.
        const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ent-learning-other-'));
        try {
            const elsewhere = new EnterpriseLearning({ vaultPath: other, tenantId: 'globex' });
            await elsewhere.importUnit(md.replace('two signatures', 'three signatures'), 'ana');
            expect((await elsewhere.taught()).map(l => [l.text, l.tenantId])).toEqual([['Contracts over 50k need three signatures.', 'globex']]);
            expect(await elsewhere.units()).toEqual([{ name: 'sign_contract', tenantId: 'globex', taught: 1, learned: 0 }]);
        } finally {
            fs.rmSync(other, { recursive: true, force: true });
        }
    });
});
