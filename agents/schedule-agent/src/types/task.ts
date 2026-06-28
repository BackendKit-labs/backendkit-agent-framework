export type TaskStatus = "active" | "paused" | "completed" | "cancelled" | "failed";

export type TaskType = "one_time" | "cron";

export interface ExecutionLog {
  executedAt: string; // ISO 8601
  status: "success" | "failure";
  duration: number; // ms
  result?: Record<string, unknown>;
  error?: string;
  triggeredBy: "scheduler" | "manual";
}

export interface ScheduledTask {
  id: string; // UUID v4
  type: TaskType;
  when?: string; // ISO 8601 (one_time)
  cron?: string; // Expresión cron 5 campos (recurrente)
  timezone: string; // IANA timezone, default "UTC"
  workflow: string; // ID del workflow a ejecutar
  workflowInput: Record<string, unknown>; // Parámetros del workflow
  createdBy: string; // userId del creador
  status: TaskStatus;
  lastRunAt?: string; // ISO 8601
  nextRunAt?: string; // ISO 8601
  runCount: number; // Veces ejecutada
  maxRuns?: number; // Límite opcional de ejecuciones (cron)
  notifyOnFailure: boolean;
  notifyTo: string[]; // Emails/canales para notificar
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  cancelledAt?: string; // ISO 8601
  cancelReason?: string;
  executionHistory: ExecutionLog[];
}
