// ──────────────────────────────────────────────
// Scheduler Client Interfaces
// ──────────────────────────────────────────────

/**
 * Interfaz del cliente del Scheduler Agent.
 * Define los contratos para programar, cancelar, listar y consultar tareas.
 */
export interface ISchedulerClient {
  scheduleTask(input: ScheduleTaskInput): Promise<ScheduleTaskOutput>;
  cancelTask(input: CancelTaskInput): Promise<CancelTaskOutput>;
  listTasks(input?: ListTasksInput): Promise<ListTasksOutput>;
  reschedule(input: RescheduleInput): Promise<RescheduleOutput>;
  getTaskStatus(input: GetTaskStatusInput): Promise<GetTaskStatusOutput>;
}

// ──────────────────────────────────────────────
// Input/Output Types
// ──────────────────────────────────────────────

export interface ScheduleTaskInput {
  taskName: string;
  schedule: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface ScheduleTaskOutput {
  taskId: string;
  status: string;
}

export interface CancelTaskInput {
  taskId: string;
}

export interface CancelTaskOutput {
  taskId: string;
  status: string;
}

export interface ListTasksInput {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ListTasksOutput {
  tasks: Array<{
    taskId: string;
    taskName: string;
    schedule: string;
    status: string;
    nextRun?: string;
  }>;
  total: number;
}

export interface RescheduleInput {
  taskId: string;
  schedule: string;
}

export interface RescheduleOutput {
  taskId: string;
  status: string;
}

export interface GetTaskStatusInput {
  taskId: string;
}

export interface GetTaskStatusOutput {
  taskId: string;
  taskName: string;
  schedule: string;
  status: string;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
}
