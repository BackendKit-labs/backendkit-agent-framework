// Auth
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

// Project
export interface Project {
  id: string;
  name: string;
  description?: string;
  root?: string;
  agents?: string[];
  policies?: string[];
  gates?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Agent
export interface Agent {
  id: string;
  name: string;
  description?: string;
  type: 'chat' | 'task' | 'monitor' | 'custom';
  status: 'idle' | 'active' | 'error' | 'stopped';
  config?: Record<string, unknown>;
  projectId?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
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

export interface DirectorMetrics {
  totalAgents: number;
  activeAgents: number;
  totalProjects: number;
  uptime: number;
  memoryUsage: number;
  cpuUsage: number;
}