// ──────────────────────────────────────────────
// Scheduler Client — Re-export from core
// ──────────────────────────────────────────────

/**
 * El SchedulerClient se implementa en src/core/scheduler-client.ts
 * y se re-exporta desde aquí para mantener una estructura de directorios
 * limpia donde todos los clientes de microservicios residan en src/clients/.
 *
 * Las importaciones existentes desde src/core/engine.ts y src/core/tool-registry.ts
 * siguen funcionando porque importan directamente desde './scheduler-client'
 * (relativo a src/core/).
 */

export {
  SchedulerClient,
  SchedulerClientConfigSchema,
} from '../core/scheduler-client';

export type {
  SchedulerClientConfig,
} from '../core/scheduler-client';

export type {
  ISchedulerClient,
  ScheduleTaskInput,
  ScheduleTaskOutput,
  CancelTaskInput,
  CancelTaskOutput,
  ListTasksInput,
  ListTasksOutput,
  RescheduleInput,
  RescheduleOutput,
  GetTaskStatusInput,
  GetTaskStatusOutput,
} from './interfaces/scheduler.interface';
