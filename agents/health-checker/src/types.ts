// ---------------------------------------------------------------------------
// Tipos compartidos — Health-Checker
// ---------------------------------------------------------------------------

export interface OrchestratorCheck {
  status: 'up' | 'down';
  latency_ms: number;
}

export interface AgentsCheck {
  total: number;
  alive: number;
  dead: string[];
  unregistered: number;
}

export interface FlowsCheck {
  configured: number;
  active_runs: number;
  failed_last_hour: number;
}

export interface SchedulerTask {
  id: string;
  type: string;
  status: string;
  nextRunAt: string;
  overdue: boolean;
}

export interface SchedulerCheck {
  configured: boolean;
  tasks_scheduled: number;
  tasks_overdue: number;
  tasks_failed: number;
  tasks: SchedulerTask[];
}

export interface BackendKitProcess {
  agent_id: string;
  pid: number;
  cpu: number;
  mem: number;
}

export interface EnvironmentCheck {
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  uptime: string;
  process_count: number;
  backendkit_processes: BackendKitProcess[];
}

export interface MessagingCheck {
  status: 'connected' | 'disconnected' | 'not_configured';
  type: string;
  queue_depth?: number;
}

export interface VaultCheck {
  indexed: boolean;
  notes: number;
}

export interface HealthReport {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: string;
  checks: {
    orchestrator: OrchestratorCheck;
    agents: AgentsCheck;
    flows: FlowsCheck;
    scheduler: SchedulerCheck;
    environment: EnvironmentCheck;
    messaging: MessagingCheck;
    vault: VaultCheck;
  };
  summary: string;
  recommended_actions: string[];
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
