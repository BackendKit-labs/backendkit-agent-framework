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

const MEMORY_TOOLS = ['save_context', 'save_learning', 'save_user_preference', 'append_log', 'save_audit', 'get_latest_audit', 'list_audits'];
const READ_ONLY_TOOLS = ['read_file', 'list_directory', 'search_files', 'run_command', ...MEMORY_TOOLS];
const WRITE_TOOLS = [...READ_ONLY_TOOLS, 'write_file', 'edit_file'];
export const CODING_AGENTS: AgentProfile[] = [
    {
        id: 'general',
        name: 'General',
        icon: '◆',
        description: 'Orchestrator — analyzes requests and delegates to specialists',
        systemPrompt: GENERAL_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ['*'],
        source: 'builtin',
    },
    {
        id: 'coder',
        name: 'Coder',
        icon: '⌨',
        description: 'Pure implementation — writes files, runs commands, executes plans',
        systemPrompt: CODER_PROMPT,
        allowedTools: WRITE_TOOLS,
        source: 'builtin',
    },
    {
        id: 'backend',
        name: 'Backend Dev',
        icon: '⚙',
        description: 'APIs, controllers, services, ORMs, migrations',
        systemPrompt: BACKEND_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
        source: 'builtin',
    },
    {
        id: 'frontend',
        name: 'Frontend Dev',
        icon: '◈',
        description: 'React, Vue, components, CSS, UI/UX',
        systemPrompt: FRONTEND_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
        source: 'builtin',
    },
    {
        id: 'qa-engineer',
        name: 'QA Engineer',
        icon: '✓',
        description: 'Unit, integration and e2e tests — Jest, Playwright',
        systemPrompt: QA_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
        source: 'builtin',
    },
    {
        id: 'security',
        name: 'Security Expert',
        icon: '🔒',
        description: 'OWASP, vulnerabilities, auth, hardening',
        systemPrompt: SECURITY_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ['coder'],
        source: 'builtin',
    },
    {
        id: 'architecture',
        name: 'Architect',
        icon: '◉',
        description: 'System design, DDD, microservices, ADRs',
        systemPrompt: ARCHITECTURE_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ['coder', 'backend', 'frontend'],
        source: 'builtin',
    },
    {
        id: 'infrastructure',
        name: 'Infrastructure',
        icon: '⬡',
        description: 'Docker, Kubernetes, CI/CD, Terraform, cloud',
        systemPrompt: INFRASTRUCTURE_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
        source: 'builtin',
    },
    {
        id: 'data',
        name: 'Data Engineer',
        icon: '⊞',
        description: 'SQL, indexes, ETL, pipelines, ML',
        systemPrompt: DATA_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ['coder'],
        source: 'builtin',
    },
];
