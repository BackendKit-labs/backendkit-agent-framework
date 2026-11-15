/**
 * SPEC-0017 F6b: the audit findings of the coding pipeline feed the learning module of core. A repeated finding
 * proposes an orchestrator rule that waits for a person, and the orchestrator applies it once it is approved.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLearning, type AuditFinding } from '@backendkit-labs/agent-core';
import { Orchestrator } from '../../orchestration/orchestrator';
import type { OrchestratorConfig } from '../../orchestration/types';
import { approvedPolicyRules, createCodingLearning, policyRuleFor, recordAuditFindings } from '..';

const HUMAN = { kind: 'human', id: 'ana' } as const;
const APP = 'test-learning-app';

const MINIMAL_CONFIG: OrchestratorConfig = {
    features: { intentDetection: false, domainDetection: false, riskScoring: false, policyEngine: true, fsm: false, qaGate: false, commitGate: false },
    riskThresholds: { low: 10, medium: 30, high: 60, critical: 80 },
    riskWeights: { breaking_change: 25, security_sensitive: 30, cross_service_impact: 20, db_transactional: 15, production_critical: 25, complexity: 1 },
};

const finding = (over: Partial<AuditFinding> = {}): AuditFinding => ({
    dimension: 'security', hallazgo: 'Vulnerabilidad de seguridad: JWT sin expiracion', severidad: 'high',
    agenteResponsable: 'security-agent', ...over,
});

let tmpHome: string;
beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'coding-learning-'));
    process.env.USERPROFILE = tmpHome;
    process.env.HOME = tmpHome;
});
afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
    delete process.env.USERPROFILE;
    delete process.env.HOME;
});

describe('the rule a pattern proposes', () => {
    const pattern = (over = {}) => ({
        key: 'audit:security_vulnerability:', domain: 'audit', kind: 'security_vulnerability', count: 3, severity: 'high' as const,
        firstSeen: 'a', lastSeen: 'b', experienceIds: [], agentIds: [], situation: 's', ...over,
    });

    it('requires QA and a security review for a security finding, matched by keywords and risk', () => {
        const rule = policyRuleFor(pattern())!;
        expect(rule.if).toMatchObject({ domain: 'security', riskLevel: ['high', 'critical'] });
        expect((rule.if.keywords as string[])).toContain('jwt');
        expect(rule.then).toMatchObject({ requireQaApproval: true, requireSecurityReview: true });
    });

    it('routes a test pattern through the QA engineer', () => {
        const rule = policyRuleFor(pattern({ domain: 'test', kind: 'coverage_below_threshold', severity: 'medium' }))!;
        expect(rule.then).toMatchObject({ mustInclude: ['qa-engineer'], mustExecute: ['test-coverage-check'] });
        expect(rule.if).toMatchObject({ actionType: 'test', riskLevel: 'medium' });
    });

    it('proposes nothing for a tool failure: it stays a lesson', () => {
        expect(policyRuleFor(pattern({ domain: 'tool', kind: 'tool_error', subject: 'run_command' }))).toBeUndefined();
    });
});

describe('findings → proposal → approval → orchestrator', () => {
    it('the orchestrator ignores a proposed rule until a person approves it', async () => {
        const learning = createLearning({ ruleFor: policyRuleFor });
        for (let i = 0; i < 3; i++) await recordAuditFindings(learning, [finding({ hallazgo: 'Falta logging en el servicio', dimension: 'ops', severidad: 'low' })], 'qa');

        const [proposal] = await learning.proposals();
        expect(proposal).toBeDefined();

        const orchestrator = new Orchestrator({ appName: APP, config: MINIMAL_CONFIG });
        orchestrator.connectLearning(learning);
        const input = 'anadir logging al servicio de pagos';

        const before = await orchestrator.orchestrate(input);
        expect(before.task.requiresQaApproval).not.toBe(true);

        await learning.approve(proposal.id, HUMAN);
        const after = await orchestrator.orchestrate(input);
        expect(after.task.requiresQaApproval).toBe(true);
    });

    it('records the finding with its gate, dimension and the agent responsible', async () => {
        const learning = createLearning();
        await recordAuditFindings(learning, [finding({ evidencia: 'src/auth.ts' })], 'security');
        const [e] = await learning.experiences();
        expect(e).toMatchObject({
            agentId: 'security-agent', domain: 'audit', kind: 'security_vulnerability', severity: 'high', action: 'security',
            meta: { gate: 'security', dimension: 'security', evidence: 'src/auth.ts' },
        });
    });

    it('only the orchestrator rules of the approved ones are taken', async () => {
        const learning = createLearning({ ruleFor: () => ({ tool: 'x', effect: 'ask', reason: 'r' }) });
        for (let i = 0; i < 3; i++) await learning.record({ agentId: 'a', domain: 'tool', kind: 'tool_error', situation: 's', action: 'x' });
        await learning.approve((await learning.proposals())[0].id, HUMAN);
        expect(await approvedPolicyRules(learning.rules)).toEqual([]);
    });
});

describe('createCodingLearning', () => {
    it('keeps its state under the project directory of the app, so a later process finds the proposals', async () => {
        const root = path.join(tmpHome, 'repo');
        await fs.mkdir(root);
        const first = createCodingLearning({ appName: APP, projectRoot: root });
        for (let i = 0; i < 3; i++) await recordAuditFindings(first, [finding()], 'security');

        const second = createCodingLearning({ appName: APP, projectRoot: root });
        const [proposal] = await second.proposals();
        expect(proposal).toBeDefined();
        await second.approve(proposal.id, HUMAN);
        expect(await approvedPolicyRules(createCodingLearning({ appName: APP, projectRoot: root }).rules)).toHaveLength(1);
    });
});
