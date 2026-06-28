// POC verification for Enfoque B — domain skills in the agentic loop.
// Proves the full chain deterministically (no LLM/API calls):
//   .md file → loadBackendSkills() → SkillActivator → injected system prompt.
//
// Run: node test-skills.mjs

import { loadBackendSkills } from './dist/load-skills.js';
import { SkillActivator }    from '@backendkit-labs/agent-core';

let failures = 0;
const check = (label, cond) => {
    console.log(`${cond ? '✓' : '✗'} ${label}`);
    if (!cond) failures++;
};

// 1. Authoring + loading: the .md skill is discovered and parsed.
const skills = loadBackendSkills();
check(`loadBackendSkills() found the skill (${skills.map(s => s.name).join(', ') || 'none'})`,
    skills.some(s => s.name === 'rest-resource'));

const activator = new SkillActivator();

// 2. Activation: a real backend phase prompt that mentions an API fires the skill.
const apiPrompt =
    'You are a senior backend developer implementing Phase 2: "User REST API". ' +
    'Build the CRUD endpoints for the user resource.';
const activeForApi = activator.activate(apiPrompt, skills);
check('skill activates for an API/CRUD phase prompt',
    activeForApi.some(s => s.name === 'rest-resource'));

// 3. Injection: the skill body reaches the system prompt the LLM will see.
const injected = activator.buildSystemPromptAddition(activeForApi);
check('systemPromptAddition is injected (contains the layering rule)',
    injected.includes('controller → service → repository'));

// 4. Progressive disclosure: an unrelated phase does NOT pull the skill in.
const unrelatedPrompt =
    'You are a senior backend developer implementing Phase 1: "Project scaffolding". ' +
    'Set up the build tooling and config files.';
const activeForUnrelated = activator.activate(unrelatedPrompt, skills);
check('skill stays dormant for an unrelated phase (no trigger match)',
    !activeForUnrelated.some(s => s.name === 'rest-resource'));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
