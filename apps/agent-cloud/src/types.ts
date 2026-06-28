/**
 * Public API surface of @backendkit-labs/agent-cloud.
 * Pure TypeScript interfaces — no TypeORM decorators, no NestJS imports.
 * Imported by cloud-mcp and any other workspace package that calls the REST API.
 */

// ── Shared ────────────────────────────────────────────────────────────────────

export type RuntimeKind    = 'docker' | 'k8s' | 'process';
export type RuntimePhase   = 'pending' | 'running' | 'stopped' | 'failed' | 'unknown';

export interface RuntimeDaemonStatus {
  kind:       RuntimeKind;
  registered: boolean;
  reachable:  'reachable' | 'unavailable' | 'coming_soon';
  endpoint:   string | null;
  version?:   string | null;
  checkedAt:  string;
  error:      string | null;
}

// ── Department ────────────────────────────────────────────────────────────────

export interface Department {
  id:          string;
  name:        string;
  slug:        string;
  description: string | null;
  icon:        string | null;
  color:       string | null;
  createdAt:   string;
  updatedAt:   string;
}

export interface SecretKeyView {
  key:       string;
  createdAt: string;
}

// ── Deployable ────────────────────────────────────────────────────────────────

export type DeployableKind   = 'agent' | 'app';
export type DeployableStatus = 'pending' | 'starting' | 'running' | 'stopped' | 'error';
export type AppFramework     = 'nextjs' | 'fastapi' | 'express' | 'custom';

export interface Deployable {
  id:            string;
  name:          string;
  description:   string | null;
  kind:          DeployableKind;
  status:        DeployableStatus;
  departmentId:  string | null;
  catalogKey:    string | null;
  image:         string | null;
  runtime:       RuntimeKind;
  runtimeHandle: string | null;
  model:         string | null;
  mcpPort:       number | null;
  publicPort:    number | null;
  publicUrl:     string | null;
  framework:     AppFramework | null;
  createdAt:     string;
  updatedAt:     string;
}

// ── CatalogEntry ──────────────────────────────────────────────────────────────

export type CatalogEntryKind = 'agent' | 'app';

export interface CatalogEntry {
  id:              string;
  key:             string;
  displayName:     string;
  description:     string | null;
  category:        string;
  kind:            CatalogEntryKind;
  image:           string;
  command:         string[] | null;
  env:             Record<string, string> | null;
  defaultModel:    string | null;
  runtime:         string;
  requiredSecrets: string[] | null;
  isPublic:        boolean;
  createdAt:       string;
  updatedAt:       string;
}

// ── Workflow ──────────────────────────────────────────────────────────────────

export type WorkflowStatus  = 'draft' | 'active' | 'paused';
export type WorkflowTrigger = 'manual' | 'webhook' | 'scheduled';

export interface WorkflowStep {
  id:           string;
  workflowId:   string;
  order:        number;
  deployableId: string | null;
  config:       Record<string, unknown> | null;
  createdAt:    string;
}

export interface Workflow {
  id:           string;
  name:         string;
  description:  string | null;
  status:       WorkflowStatus;
  trigger:      WorkflowTrigger;
  departmentId: string | null;
  steps?:       WorkflowStep[];
  createdAt:    string;
  updatedAt:    string;
}

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowRun {
  id:          string;
  workflowId:  string;
  status:      WorkflowRunStatus;
  input:       Record<string, unknown> | null;
  output:      Record<string, unknown> | null;
  error:       string | null;
  startedAt:   string | null;
  completedAt: string | null;
  createdAt:   string;
}

// ── ApiKey ────────────────────────────────────────────────────────────────────

export interface ApiKeyView {
  id:         string;
  name:       string;
  scopes:     string[] | null;
  active:     boolean;
  lastUsedAt: string | null;
  expiresAt:  string | null;
  createdAt:  string;
}

/** Returned only on creation — `key` is the plain-text bkc_xxx shown once. */
export interface CreateApiKeyResult extends ApiKeyView {
  key: string;
}

// ── Director ──────────────────────────────────────────────────────────────────

export interface DirectorMetrics {
  totalDeployables: number;
  activeDeployables: number;
  totalDepartments: number;
  byKind:   { agent: number; app: number };
  byStatus: Record<DeployableStatus, number>;
  uptime:   number;
  memoryUsageMb: number;
}

export interface DeployedAgentView {
  id:           string;
  name:         string;
  kind:         DeployableKind;
  catalogKey:   string | null;
  departmentId: string | null;
  department:   string | null;
  runtime:      RuntimeKind;
  handle:       string | null;
  status:       DeployableStatus;
  createdAt:    string;
}

export interface DeployResult {
  id:      string;
  name:    string;
  kind:    DeployableKind;
  status:  DeployableStatus;
  runtime: RuntimeKind;
  handle:  string;
}
