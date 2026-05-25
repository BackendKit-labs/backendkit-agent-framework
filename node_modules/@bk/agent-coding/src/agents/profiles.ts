import type { AgentProfile } from '@bk/agent-core';
import { GENERAL_PROMPT } from './prompts/general';
import { CODER_PROMPT } from './prompts/coder';
import { BACKEND_PROMPT } from './prompts/backend';
import { FRONTEND_PROMPT } from './prompts/frontend';
import { QA_PROMPT } from './prompts/qa';
import { SECURITY_PROMPT } from './prompts/security';
import { ARCHITECTURE_PROMPT } from './prompts/architecture';
import { INFRASTRUCTURE_PROMPT } from './prompts/infrastructure';
import { DATA_PROMPT } from './prompts/data';

const READ_ONLY_TOOLS = ['read_file', 'list_directory', 'search_files', 'run_command'];
const WRITE_TOOLS = [...READ_ONLY_TOOLS, 'write_file', 'edit_file'];
const ALL_AGENTS = ['coder', 'backend', 'frontend', 'qa-engineer', 'security', 'architecture', 'infrastructure', 'data'];

export const CODING_AGENTS: AgentProfile[] = [
    {
        id: 'general',
        name: 'General',
        icon: '◆',
        description: 'Orchestrator — analyzes requests and delegates to specialists',
        systemPrompt: GENERAL_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ALL_AGENTS,
    },
    {
        id: 'coder',
        name: 'Coder',
        icon: '⌨',
        description: 'Pure implementation — writes files, runs commands, executes plans',
        systemPrompt: CODER_PROMPT,
        allowedTools: WRITE_TOOLS,
    },
    {
        id: 'backend',
        name: 'Backend Dev',
        icon: '⚙',
        description: 'APIs, controllers, services, ORMs, migrations',
        systemPrompt: BACKEND_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
    },
    {
        id: 'frontend',
        name: 'Frontend Dev',
        icon: '◈',
        description: 'React, Vue, components, CSS, UI/UX',
        systemPrompt: FRONTEND_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
    },
    {
        id: 'qa-engineer',
        name: 'QA Engineer',
        icon: '✓',
        description: 'Unit, integration and e2e tests — Jest, Playwright',
        systemPrompt: QA_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
    },
    {
        id: 'security',
        name: 'Security Expert',
        icon: '🔒',
        description: 'OWASP, vulnerabilities, auth, hardening',
        systemPrompt: SECURITY_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ['coder'],
    },
    {
        id: 'architecture',
        name: 'Architect',
        icon: '◉',
        description: 'System design, DDD, microservices, ADRs',
        systemPrompt: ARCHITECTURE_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ['coder', 'backend', 'frontend'],
    },
    {
        id: 'infrastructure',
        name: 'Infrastructure',
        icon: '⬡',
        description: 'Docker, Kubernetes, CI/CD, Terraform, cloud',
        systemPrompt: INFRASTRUCTURE_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
    },
    {
        id: 'data',
        name: 'Data Engineer',
        icon: '⊞',
        description: 'SQL, indexes, ETL, pipelines, ML',
        systemPrompt: DATA_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ['coder'],
    },
];
