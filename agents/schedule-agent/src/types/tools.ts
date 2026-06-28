import { z } from "zod";
import type { TaskStatus, TaskType, ExecutionLog } from "./task.js";

// ─── schedule_task ───────────────────────────────────────────────

export const ScheduleTaskInputSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(["one_time", "cron"]),
  when: z.string().datetime().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional().default("UTC"),
  workflow: z.string().min(1, "workflow cannot be empty"),
  workflowInput: z.record(z.unknown()).optional().default({}),
  createdBy: z.string().min(1),
  userRole: z.enum(["admin", "manager", "user"]),
  notifyOnFailure: z.boolean().optional().default(false),
  notifyTo: z.array(z.string()).optional().default([]),
});

export type ScheduleTaskInput = z.input<typeof ScheduleTaskInputSchema>;

export interface ScheduleTaskOutput {
  id: string;
  status: "active";
  nextRunAt: string;
  createdAt: string;
}

// ─── list_scheduled ──────────────────────────────────────────────

export const ListScheduledInputSchema = z.object({
  status: z.enum(["active", "paused", "completed", "cancelled", "failed"]).optional(),
  type: z.enum(["one_time", "cron"]).optional(),
  createdBy: z.string().optional(),
  userRole: z.enum(["admin", "manager", "user"]).optional().default("user"),
  limit: z.number().int().min(1).max(200).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export type ListScheduledInput = z.input<typeof ListScheduledInputSchema>;

export interface ListScheduledOutput {
  total: number;
  tasks: Array<{
    id: string;
    type: TaskType;
    workflow: string;
    status: TaskStatus;
    nextRunAt: string | null;
    lastRunAt: string | null;
    runCount: number;
    createdAt: string;
    createdBy: string;
  }>;
}

// ─── cancel_task ─────────────────────────────────────────────────

export const CancelTaskInputSchema = z.object({
  id: z.string().min(1),
  reason: z.string().optional(),
  requestedBy: z.string().min(1),
  userRole: z.enum(["admin", "manager", "user"]),
});

export type CancelTaskInput = z.input<typeof CancelTaskInputSchema>;

export interface CancelTaskOutput {
  id: string;
  status: "cancelled";
  cancelledAt: string;
}

// ─── reschedule ──────────────────────────────────────────────────

export const RescheduleInputSchema = z.object({
  id: z.string().min(1),
  when: z.string().datetime().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  workflowInput: z.record(z.unknown()).optional(),
  requestedBy: z.string().min(1),
  userRole: z.enum(["admin", "manager", "user"]),
});

export type RescheduleInput = z.input<typeof RescheduleInputSchema>;

export interface RescheduleOutput {
  id: string;
  status: "active";
  nextRunAt: string;
  updatedAt: string;
}

// ─── task_status ─────────────────────────────────────────────────

export const TaskStatusInputSchema = z.object({
  id: z.string().min(1),
  userRole: z.enum(["admin", "manager", "user"]).optional().default("user"),
  requestedBy: z.string().min(1),
});

export type TaskStatusInput = z.input<typeof TaskStatusInputSchema>;

export interface TaskStatusOutput {
  id: string;
  type: TaskType;
  when: string | null;
  cron: string | null;
  timezone: string;
  workflow: string;
  workflowInput: Record<string, unknown>;
  createdBy: string;
  status: TaskStatus;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  notifyOnFailure: boolean;
  notifyTo: string[];
  createdAt: string;
  updatedAt: string;
  executionHistory: ExecutionLog[];
}

// ─── get_current_time ────────────────────────────────────────────

export interface GetCurrentTimeOutput {
  iso: string;
  timezone: string;
  offset: string;
  unix: number;
}

// ─── get_user_timezone ───────────────────────────────────────────

export const GetUserTimezoneInputSchema = z.object({
  userId: z.string().min(1, "userId cannot be empty"),
});

export type GetUserTimezoneInput = z.input<typeof GetUserTimezoneInputSchema>;

export interface GetUserTimezoneOutput {
  userId: string;
  timezone: string;
  offset: string;
  iana: string;
}
