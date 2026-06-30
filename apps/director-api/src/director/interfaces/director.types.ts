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