/**
 * Regression test: agent IDs emitted by policy-engine and gate-resolver must
 * match the canonical IDs registered in profiles (no "-agent" suffix).
 *
 * Background: policy-engine and gate-resolver previously used 'architecture-agent'
 * and 'security-agent' while profiles register 'architecture' and 'security'.
 * That mismatch caused duplicate entries in selectAgents() and potential
 * "Agent not found" errors on LLM delegation (AgentEngine.ts:657).
 */

import { evaluatePolicies } from '../policy-engine';
import { resolveGates } from '../gate-resolver';
import { createTaskContext, type TaskContext } from '../task-context';
import { defaultOrchestratorConfig } from '../types';
import type { PolicyEngineResult } from '../policy-engine';

// ── Canonical IDs registered by coding profiles ──────────────────────────────
const CANONICAL_IDS = new Set([
    'general', 'coder', 'backend', 'frontend',
    'qa-engineer', 'security', 'architecture',
    'infrastructure', 'data', 'project-manager',
]);

function hasAgentSuffix(id: string): boolean {
    return id.endsWith('-agent');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function taskWith(overrides: Partial<TaskContext>): TaskContext {
    return { ...createTaskContext('test'), status: 'classified', ...overrides };
}

function emptyPolicy(): PolicyEngineResult {
    return { mustInclude: [], requiredGates: [], mustExecute: [], appliedRules: [] };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('agent ID consistency — no -agent suffix', () => {
    describe('evaluatePolicies DEFAULT_RULES', () => {
        const cases: Array<{ label: string; task: Partial<TaskContext> }> = [
            { label: 'actionType=design', task: { actionType: 'design' } },
            { label: 'actionType=security_audit', task: { actionType: 'security_audit' } },
            { label: 'riskLevel=high', task: { riskLevel: 'high' } },
            { label: 'riskLevel=critical', task: { riskLevel: 'critical' } },
            { label: 'domain=security', task: { domains: ['security'] } },
            {
                label: 'breaking_change=true',
                task: { riskFactors: { breaking_change: true, security_sensitive: false, cross_service_impact: false, db_transactional: false, production_critical: false, complexity: 5 } },
            },
            {
                label: 'security_sensitive=true',
                task: { riskFactors: { breaking_change: false, security_sensitive: true, cross_service_impact: false, db_transactional: false, production_critical: false, complexity: 5 } },
            },
            {
                label: 'cross_service_impact=true',
                task: { riskFactors: { breaking_change: false, security_sensitive: false, cross_service_impact: true, db_transactional: false, production_critical: false, complexity: 5 } },
            },
        ];

        test.each(cases)('$label: mustInclude uses canonical IDs', ({ task }) => {
            const result = evaluatePolicies(taskWith(task));
            for (const id of result.mustInclude) {
                expect(hasAgentSuffix(id)).toBe(false);
                expect(CANONICAL_IDS.has(id)).toBe(true);
            }
        });
    });

    describe('resolveGates pipeline agentIds', () => {
        it('security review phase uses canonical id', () => {
            const task = taskWith({ requiresSecurityReview: true });
            const { pipeline } = resolveGates(task, emptyPolicy(), defaultOrchestratorConfig(), [
                { agentId: 'backend', score: 80, reason: 'domain' },
            ]);
            const ids = pipeline.map(p => p.agentId);
            expect(ids).not.toContain('security-agent');
            expect(ids).toContain('security');
        });

        it('architecture review phase uses canonical id', () => {
            const task = taskWith({ requiresArchitectureReview: true });
            const { pipeline } = resolveGates(task, emptyPolicy(), defaultOrchestratorConfig(), [
                { agentId: 'backend', score: 80, reason: 'domain' },
            ]);
            const ids = pipeline.map(p => p.agentId);
            expect(ids).not.toContain('architecture-agent');
            expect(ids).toContain('architecture');
        });

        it('qa verify phase uses canonical id', () => {
            const task = taskWith({ requiresQaApproval: true });
            const { pipeline } = resolveGates(task, emptyPolicy(), defaultOrchestratorConfig(), [
                { agentId: 'backend', score: 80, reason: 'domain' },
            ]);
            const ids = pipeline.map(p => p.agentId);
            expect(ids).not.toContain('qa-agent');
            expect(ids).toContain('qa-engineer');
        });

        it('no pipeline entry uses a -agent suffix', () => {
            const task = taskWith({
                requiresSecurityReview: true,
                requiresArchitectureReview: true,
                requiresQaApproval: true,
            });
            const { pipeline } = resolveGates(task, emptyPolicy(), defaultOrchestratorConfig(), [
                { agentId: 'backend', score: 80, reason: 'domain' },
            ]);
            for (const phase of pipeline) {
                expect(hasAgentSuffix(phase.agentId)).toBe(false);
            }
        });
    });
});
