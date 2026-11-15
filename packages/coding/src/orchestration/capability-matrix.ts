import type { CapabilityMatrix } from '../pipeline';

/**
 * Default capability matrix for the 10 coding agents.
 *
 * Maps each agent to the technical domains it owns so the Orchestrator
 * can route tasks to the most relevant specialist automatically.
 * Override via CodingEngineOptions.orchestration.capabilityMatrix.
 */
export const CODING_CAPABILITY_MATRIX: CapabilityMatrix = {
    'architecture': {
        owns: ['architecture', 'design', 'resilience'],
        skills: ['adr-generation', 'c4-diagram', 'trade-off-analysis'],
        baseWeight: 0.9,
    },
    'backend': {
        owns: ['backend', 'messaging'],
        skills: ['api-design', 'orm-patterns'],
        baseWeight: 0.9,
    },
    'frontend': {
        owns: ['frontend'],
        skills: ['component-design', 'a11y-review'],
        baseWeight: 0.9,
    },
    'security': {
        owns: ['security'],
        skills: ['owasp-review', 'threat-model'],
        baseWeight: 1.0,
    },
    'qa-engineer': {
        owns: ['testing'],
        skills: ['code-review', 'test-strategy'],
        baseWeight: 0.9,
    },
    'infrastructure': {
        owns: ['devops'],
        skills: ['iac-review', 'ci-cd-setup'],
        baseWeight: 0.9,
    },
    'data': {
        owns: ['data', 'database'],
        skills: ['schema-design', 'query-optimization'],
        baseWeight: 0.8,
    },
};
