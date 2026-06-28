import { v4 as uuidv4 } from "uuid";
import cronParser from "cron-parser";
import type { ScheduledTask, TaskStatus, ExecutionLog } from "../types/task.js";
import type {
  ScheduleTaskInput,
  CancelTaskInput,
  RescheduleInput,
  ListScheduledInput,
  ScheduleTaskOutput,
  CancelTaskOutput,
  RescheduleOutput,
  ListScheduledOutput,
  TaskStatusOutput,
} from "../types/tools.js";
import { TaskRepository } from "../repository/task-repository.js";

export class TaskService {
  constructor(private repository: TaskRepository) {}

  createTask(input: ScheduleTaskInput): ScheduleTaskOutput {
    // Validate type-specific requirements
    if (input.type === "one_time" && !input.when) {
      throw new Error("when is required for one_time tasks");
    }
    if (input.type === "cron" && !input.cron) {
      throw new Error("cron is required for cron tasks");
    }
    if (input.workflow.trim().length === 0) {
      throw new Error("workflow cannot be empty");
    }

    // Validate when is in the future
    if (input.when) {
      const whenDate = new Date(input.when);
      if (isNaN(whenDate.getTime())) {
        throw new Error("when must be a valid ISO 8601 date");
      }
      if (whenDate <= new Date()) {
        throw new Error("when must be in the future");
      }
    }

    // Validate cron expression
    if (input.cron) {
      try {
        const interval = cronParser.parseExpression(input.cron, {
          tz: input.timezone || "UTC",
        });
        interval.next(); // Will throw if invalid
      } catch {
        throw new Error("Invalid cron expression");
      }
    }

    // Idempotency: if id is provided and exists, error
    const id = input.id || uuidv4();
    const existing = this.repository.findById(id);
    if (existing) {
      throw new Error(`Task with id ${id} already exists`);
    }

    const now = new Date().toISOString();

    // Calculate nextRunAt
    let nextRunAt: string | undefined;
    if (input.type === "one_time" && input.when) {
      nextRunAt = input.when;
    } else if (input.type === "cron" && input.cron) {
      const interval = cronParser.parseExpression(input.cron, {
        tz: input.timezone || "UTC",
      });
      nextRunAt = interval.next().toISOString();
    }

    const task: ScheduledTask = {
      id,
      type: input.type,
      when: input.when,
      cron: input.cron,
      timezone: input.timezone || "UTC",
      workflow: input.workflow,
      workflowInput: input.workflowInput || {},
      createdBy: input.createdBy,
      status: "active",
      nextRunAt,
      runCount: 0,
      notifyOnFailure: input.notifyOnFailure ?? false,
      notifyTo: input.notifyTo || [],
      createdAt: now,
      updatedAt: now,
      executionHistory: [],
    };

    this.repository.create(task);

    return {
      id: task.id,
      status: "active",
      nextRunAt: task.nextRunAt!,
      createdAt: task.createdAt,
    };
  }

  cancelTask(input: CancelTaskInput): CancelTaskOutput {
    const task = this.repository.findById(input.id);
    if (!task) {
      throw new Error(`Task ${input.id} not found`);
    }

    if (task.status === "completed" || task.status === "cancelled") {
      throw new Error(
        `Cannot cancel task in status "${task.status}". Only active, paused, or failed tasks can be cancelled.`
      );
    }

    const now = new Date().toISOString();
    task.status = "cancelled";
    task.cancelledAt = now;
    task.cancelReason = input.reason;
    task.updatedAt = now;

    this.repository.update(task);

    return {
      id: task.id,
      status: "cancelled",
      cancelledAt: now,
    };
  }

  rescheduleTask(input: RescheduleInput): RescheduleOutput {
    const task = this.repository.findById(input.id);
    if (!task) {
      throw new Error(`Task ${input.id} not found`);
    }

    if (task.status === "completed" || task.status === "cancelled") {
      throw new Error(
        `Cannot reschedule task in status "${task.status}". Only active, paused, or failed tasks can be rescheduled.`
      );
    }

    // Cannot change type
    if (input.when && task.type !== "one_time") {
      throw new Error("Cannot set 'when' on a cron task. Use 'cron' instead.");
    }
    if (input.cron && task.type !== "cron") {
      throw new Error("Cannot set 'cron' on a one_time task. Use 'when' instead.");
    }

    const now = new Date().toISOString();

    // Update fields
    if (input.when) {
      const whenDate = new Date(input.when);
      if (isNaN(whenDate.getTime())) {
        throw new Error("when must be a valid ISO 8601 date");
      }
      if (whenDate <= new Date()) {
        throw new Error("when must be in the future");
      }
      task.when = input.when;
      task.nextRunAt = input.when;
    }

    if (input.cron) {
      try {
        const interval = cronParser.parseExpression(input.cron, {
          tz: input.timezone || task.timezone,
        });
        interval.next();
      } catch {
        throw new Error("Invalid cron expression");
      }
      task.cron = input.cron;
      // Recalculate nextRunAt
      const interval = cronParser.parseExpression(input.cron, {
        tz: input.timezone || task.timezone,
      });
      task.nextRunAt = interval.next().toISOString();
    }

    if (input.timezone) {
      task.timezone = input.timezone;
      // If cron, recalculate nextRunAt with new timezone
      if (task.cron) {
        const interval = cronParser.parseExpression(task.cron, {
          tz: task.timezone,
        });
        task.nextRunAt = interval.next().toISOString();
      }
    }

    if (input.workflowInput) {
      task.workflowInput = input.workflowInput;
    }

    task.status = "active";
    task.updatedAt = now;
    this.repository.update(task);

    return {
      id: task.id,
      status: "active",
      nextRunAt: task.nextRunAt!,
      updatedAt: now,
    };
  }

  getTaskById(id: string): ScheduledTask | null {
    return this.repository.findById(id);
  }

  getTaskStatus(id: string): TaskStatusOutput {
    const task = this.repository.findById(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    return {
      id: task.id,
      type: task.type,
      when: task.when ?? null,
      cron: task.cron ?? null,
      timezone: task.timezone,
      workflow: task.workflow,
      workflowInput: task.workflowInput,
      createdBy: task.createdBy,
      status: task.status,
      lastRunAt: task.lastRunAt ?? null,
      nextRunAt: task.nextRunAt ?? null,
      runCount: task.runCount,
      notifyOnFailure: task.notifyOnFailure,
      notifyTo: task.notifyTo,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      executionHistory: task.executionHistory,
    };
  }

  listTasks(input: ListScheduledInput): ListScheduledOutput {
    const result = this.repository.list({
      status: input.status,
      type: input.type,
      createdBy: input.createdBy,
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
    });

    return {
      total: result.total,
      tasks: result.tasks.map((t) => ({
        id: t.id,
        type: t.type,
        workflow: t.workflow,
        status: t.status,
        nextRunAt: t.nextRunAt ?? null,
        lastRunAt: t.lastRunAt ?? null,
        runCount: t.runCount,
        createdAt: t.createdAt,
        createdBy: t.createdBy,
      })),
    };
  }
}
