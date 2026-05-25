"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODING_AGENTS = void 0;
const general_1 = require("./prompts/general");
const coder_1 = require("./prompts/coder");
const backend_1 = require("./prompts/backend");
const frontend_1 = require("./prompts/frontend");
const qa_1 = require("./prompts/qa");
const security_1 = require("./prompts/security");
const architecture_1 = require("./prompts/architecture");
const infrastructure_1 = require("./prompts/infrastructure");
const data_1 = require("./prompts/data");
const READ_ONLY_TOOLS = ['read_file', 'list_directory', 'search_files', 'run_command'];
const WRITE_TOOLS = [...READ_ONLY_TOOLS, 'write_file', 'edit_file'];
const ALL_AGENTS = ['coder', 'backend', 'frontend', 'qa-engineer', 'security', 'architecture', 'infrastructure', 'data'];
exports.CODING_AGENTS = [
    {
        id: 'general',
        name: 'General',
        icon: '◆',
        description: 'Orchestrator — analyzes requests and delegates to specialists',
        systemPrompt: general_1.GENERAL_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ALL_AGENTS,
    },
    {
        id: 'coder',
        name: 'Coder',
        icon: '⌨',
        description: 'Pure implementation — writes files, runs commands, executes plans',
        systemPrompt: coder_1.CODER_PROMPT,
        allowedTools: WRITE_TOOLS,
    },
    {
        id: 'backend',
        name: 'Backend Dev',
        icon: '⚙',
        description: 'APIs, controllers, services, ORMs, migrations',
        systemPrompt: backend_1.BACKEND_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
    },
    {
        id: 'frontend',
        name: 'Frontend Dev',
        icon: '◈',
        description: 'React, Vue, components, CSS, UI/UX',
        systemPrompt: frontend_1.FRONTEND_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
    },
    {
        id: 'qa-engineer',
        name: 'QA Engineer',
        icon: '✓',
        description: 'Unit, integration and e2e tests — Jest, Playwright',
        systemPrompt: qa_1.QA_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
    },
    {
        id: 'security',
        name: 'Security Expert',
        icon: '🔒',
        description: 'OWASP, vulnerabilities, auth, hardening',
        systemPrompt: security_1.SECURITY_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ['coder'],
    },
    {
        id: 'architecture',
        name: 'Architect',
        icon: '◉',
        description: 'System design, DDD, microservices, ADRs',
        systemPrompt: architecture_1.ARCHITECTURE_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ['coder', 'backend', 'frontend'],
    },
    {
        id: 'infrastructure',
        name: 'Infrastructure',
        icon: '⬡',
        description: 'Docker, Kubernetes, CI/CD, Terraform, cloud',
        systemPrompt: infrastructure_1.INFRASTRUCTURE_PROMPT,
        allowedTools: WRITE_TOOLS,
        delegatesTo: ['coder'],
    },
    {
        id: 'data',
        name: 'Data Engineer',
        icon: '⊞',
        description: 'SQL, indexes, ETL, pipelines, ML',
        systemPrompt: data_1.DATA_PROMPT,
        allowedTools: READ_ONLY_TOOLS,
        delegatesTo: ['coder'],
    },
];
//# sourceMappingURL=profiles.js.map