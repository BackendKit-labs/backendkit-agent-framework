// ──────────────────────────────────────────────
// Clients Barrel
// ──────────────────────────────────────────────

export { SchedulerClient, SchedulerClientConfigSchema } from './scheduler-client';
export type { SchedulerClientConfig } from './scheduler-client';
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

export { NotifierClient, NotifierClientConfigSchema } from './notifier-client';
export type { NotifierClientConfig } from './notifier-client';
export type {
  INotifierClient,
  NotifyUserInput,
  NotifyUserOutput,
  SendNotificationInput,
  SendNotificationOutput,
  GetHistoryInput,
  GetHistoryOutput,
} from './interfaces/notifier.interface';
