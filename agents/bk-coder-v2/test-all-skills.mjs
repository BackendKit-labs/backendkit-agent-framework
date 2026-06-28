// Verifies skill load + activation across all four specialist agents.
// Deterministic — no LLM/API calls. Run: node test-all-skills.mjs

import { SkillActivator } from '@backendkit-labs/agent-core';
import { loadBackendSkills }  from './backend-mcp/dist/load-skills.js';
import { loadQaSkills }       from './qa-mcp/dist/load-skills.js';
import { loadSecuritySkills } from './security-mcp/dist/load-skills.js';
import { loadInfraSkills }    from './infra-mcp/dist/load-skills.js';

const activator = new SkillActivator();
const STACK = ['node', 'typescript'];   // what detectProjectStack() returns for a TS project at runtime
let failures = 0;
const check = (label, cond) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };

// [agent, loader, expected skill, activating prompt, dormant prompt]
const cases = [
    ['backend',  loadBackendSkills,  'bk-resilience',
        'Implement a client that calls an external payment API with retry and circuit breaker for resilience.',
        'Rename a local variable for readability.'],
    ['qa',       loadQaSkills,       'spec-compliance',
        'Validate the implementation of this phase against the spec criteria and emit a verdict.',
        'Write a haiku about the weather.'],
    ['security', loadSecuritySkills, 'vuln-report',
        'Run a security audit for OWASP vulnerabilities and report findings by severity.',
        'Rename a variable for readability.'],
    ['infra',    loadInfraSkills,    'containerization',
        'Generate the Dockerfile, docker-compose.yml and CI pipeline for this project.',
        'Explain what the service does in one sentence.'],
];

for (const [agent, loader, expected, hot, cold] of cases) {
    const skills = loader();
    check(`[${agent}] loads "${expected}" (${skills.map(s => s.name).join(', ') || 'none'})`,
        skills.some(s => s.name === expected));
    check(`[${agent}] activates on a relevant prompt`,
        activator.activate(hot, skills, STACK).some(s => s.name === expected));
    check(`[${agent}] injects systemPromptAddition`,
        activator.buildSystemPromptAddition(activator.activate(hot, skills, STACK)).length > 50);
    check(`[${agent}] stays dormant on an unrelated prompt`,
        !activator.activate(cold, skills, STACK).some(s => s.name === expected));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
