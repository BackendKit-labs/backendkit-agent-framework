// ── Data Model ────────────────────────────────────────────────────────────────

export interface ProjectsFile {
  version: '1.0';
  current: string | null;
  projects: Record<string, Project>;
}

export interface Project {
  name: string;
  root: string;
  description?: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  agents: Record<string, AgentConfig>;
  policies: {
    enabled: string[];
  };
  memory: {
    namespace: string;
    enabled: boolean;
  };
  gates: {
    designReview: 'auto' | 'human' | 'disabled';
    securityReview: 'auto' | 'human' | 'disabled';
    qaApproval: 'auto' | 'human' | 'disabled';
  };
}

export interface AgentConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  srcPath?: string;
  specPath?: string;
  memoryNamespace: string;
  tools: string[];
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  backend: {
    model: 'deepseek-v3',
    temperature: 0.3,
    maxTokens: 8000,
    srcPath: 'src',
    memoryNamespace: '', // filled at creation time
    tools: ['read_file', 'write_file', 'execute_command', 'search_vault', 'read_note', 'learn_pattern'],
  },
  qa: {
    model: 'claude-sonnet',
    temperature: 0.3,
    maxTokens: 8000,
    srcPath: 'src',
    specPath: '.specs',
    memoryNamespace: '',
    tools: ['read_file', 'write_file', 'execute_command', 'search_vault', 'search_knowledge', 'learn_pattern', 'remember', 'recall'],
  },
  security: {
    model: 'gpt-4o',
    temperature: 0.2,
    maxTokens: 6000,
    memoryNamespace: '',
    tools: ['read_file', 'search_vault', 'save_knowledge', 'learn_pattern', 'remember', 'recall'],
  },
  design: {
    model: 'deepseek-r1',
    temperature: 0.7,
    maxTokens: 8000,
    specPath: '.specs',
    memoryNamespace: '',
    tools: ['read_file', 'write_file', 'search_vault', 'save_knowledge', 'search_knowledge', 'learn_pattern'],
  },
  infra: {
    model: 'deepseek-v3',
    temperature: 0.3,
    maxTokens: 6000,
    memoryNamespace: '',
    tools: ['read_file', 'write_file', 'execute_command', 'search_vault'],
  },
};

export const DEFAULT_POLICIES: string[] = ['pr-require-tests'];

export const DEFAULT_GATES: Project['gates'] = {
  designReview: 'human',
  securityReview: 'auto',
  qaApproval: 'auto',
};

// ── Policy Rule ───────────────────────────────────────────────────────────────

export interface PolicyRule {
  id: string;
  description: string;
  if: {
    domain?: string[];
    keywords?: string[];
  };
  then: {
    gates?: string[];
    mustInclude?: string[];
    mustPass?: string[];
    mustExecute?: string[];
    requireSecurityReview?: boolean;
    requireQaApproval?: boolean;
    requireArchitectureReview?: boolean;
  };
}

export const BUILT_IN_POLICIES: PolicyRule[] = [
  {
    id: 'pr-auth-security-review',
    description: 'Keywords auth/jwt/token → requireSecurityReview',
    if: { keywords: ['auth', 'jwt', 'login', 'password', 'token', 'session', 'oauth'] },
    then: { requireSecurityReview: true },
  },
  {
    id: 'pr-require-tests',
    description: 'All new code must include tests and pass npm test',
    if: {},
    then: { mustInclude: ['*.spec.ts', '*.test.ts'], mustPass: ['npm test'] },
  },
  {
    id: 'pr-schema-review',
    description: 'Keywords entity/model → mustExecute migration:validate',
    if: { keywords: ['entity', 'model', 'schema', 'migration', 'table'] },
    then: { mustExecute: ['npm run migration:validate'] },
  },
  {
    id: 'pr-payment-critical',
    description: 'Keywords payment/stripe → triple gate (security + QA + human)',
    if: { keywords: ['payment', 'billing', 'subscription', 'checkout', 'stripe'] },
    then: { requireSecurityReview: true, requireQaApproval: true, gates: ['human'] },
  },
];

// ── Tool output types ────────────────────────────────────────────────────────

export interface ProjectListItem {
  id: string;
  name: string;
  root: string;
  active: boolean;
}

export interface ProjectListOutput {
  current: string | null;
  projects: ProjectListItem[];
}

export interface SwitchOutput {
  success: boolean;
  previous: string | null;
  current: string;
}

export interface DeleteOutput {
  success: boolean;
  deleted: string;
}

export interface UpdateOutput {
  success: boolean;
  changes: string[];
}

export interface AgentExistsOutput {
  exists: boolean;
  config?: AgentConfig;
}

export interface RootOutput {
  root: string;
  name: string;
}

export interface GateConfigOutput {
  designReview: 'auto' | 'human' | 'disabled';
  securityReview: 'auto' | 'human' | 'disabled';
  qaApproval: 'auto' | 'human' | 'disabled';
}

export interface MemoryConfigOutput {
  namespace: string;
  enabled: boolean;
}
