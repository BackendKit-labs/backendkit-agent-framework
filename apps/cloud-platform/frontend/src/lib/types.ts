// Auth
export interface User {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

// Raw response shape from abac-service POST /auth/admin/login
export interface AbacAuthResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
  };
  permissions: string[];
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

// Department (entidad completa)
export interface Department {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Lo que se envía al backend al crear/editar un departamento.
export interface DepartmentPayload {
  name: string;
  slug?: string;
  description?: string;
  icon?: string;
  color?: string;
}

// Secret: el backend nunca devuelve el valor, solo la key (+ metadata).
export interface SecretRef {
  id: string;
  key: string;
  createdAt?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Workflows
export type WorkflowStatus = 'draft' | 'active' | 'paused';
export type WorkflowTrigger = 'manual' | 'webhook' | 'scheduled';
export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkflowStep {
  id: string;
  workflowId: string;
  order: number;
  deployableId?: string | null;
  config?: Record<string, unknown> | null;
  createdAt: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  status: WorkflowStatus;
  trigger: WorkflowTrigger;
  departmentId?: string | null;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

// Step tal como se envía al backend (sin id; order 1-based).
export interface WorkflowStepInput {
  order: number;
  deployableId?: string;
  config?: Record<string, unknown>;
}

export interface WorkflowPayload {
  name: string;
  description?: string;
  status?: WorkflowStatus;
  trigger?: WorkflowTrigger;
  departmentId?: string;
  steps?: WorkflowStepInput[];
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

// Catalog
export interface CatalogEntry {
  id: string;
  key: string;
  displayName: string;
  description?: string | null;
  category: string;
  kind: DeployableKind;
  image: string;
  command?: string[] | null;
  env?: Record<string, string> | null;
  defaultModel?: string | null;
  runtime: DeployableRuntime;
  requiredSecrets?: string[] | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

// Lo que se envía al backend al crear/editar una entrada de catálogo.
export interface CatalogEntryPayload {
  key: string;
  displayName: string;
  description?: string;
  category?: string;
  kind?: DeployableKind;
  image: string;
  command?: string[];
  env?: Record<string, string>;
  defaultModel?: string;
  runtime?: DeployableRuntime;
  requiredSecrets?: string[];
  isPublic?: boolean;
}

// Department (referencia ligera, suficiente para selects y columnas)
export interface DepartmentRef {
  id: string;
  name: string;
  slug?: string;
  icon?: string | null;
  color?: string | null;
}

// Deployable (entidad núcleo: agentes y apps que se despliegan)
export type DeployableKind = 'agent' | 'app';
export type DeployableStatus = 'pending' | 'starting' | 'running' | 'stopped' | 'error';
export type DeployableRuntime = 'docker' | 'k8s' | 'process';
export type AppFramework = 'nextjs' | 'fastapi' | 'express' | 'custom';

export interface Deployable {
  id: string;
  name: string;
  description?: string | null;
  kind: DeployableKind;
  status: DeployableStatus;
  departmentId?: string | null;
  department?: DepartmentRef | null;
  catalogKey?: string | null;
  image?: string | null;
  runtime: DeployableRuntime;
  runtimeHandle?: string | null;
  // Agent-specific
  model?: string | null;
  mcpPort?: number | null;
  // App-specific
  publicPort?: number | null;
  publicUrl?: string | null;
  framework?: AppFramework | null;
  createdAt: string;
  updatedAt: string;
}

// Lo que se envía al backend al crear/editar un deployable.
export interface DeployablePayload {
  name: string;
  description?: string;
  kind: DeployableKind;
  departmentId?: string;
  catalogKey?: string;
  image?: string;
  runtime?: DeployableRuntime;
  model?: string;
  mcpPort?: number;
  publicPort?: number;
  publicUrl?: string;
  framework?: AppFramework;
}

// Director
export interface DirectorHealth {
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  version: string;
}

export interface DirectorAgent {
  id: string;
  agentName: string;
  agentType: string;
  projectId: string;
  status: 'running' | 'stopped' | 'error';
  startedAt: string;
}

// Forma real devuelta por GET /api/director/metrics
export interface DirectorMetrics {
  totalDeployables: number;
  activeDeployables: number;
  totalDepartments: number;
  byKind: { agent: number; app: number };
  byStatus: Record<string, number>;
  uptime: number;
  memoryUsageMb: number;
}