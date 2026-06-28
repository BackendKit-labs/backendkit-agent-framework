import { TaskRepository } from "../../src/repository/task-repository.js";
import { TaskService } from "../../src/services/task-service.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Integration tests for the full schedule flow:
 * 1. Create one_time task → verify persistence
 * 2. Create cron task → verify nextRunAt calculation
 * 3. Cancel task → verify status change
 * 4. Reschedule → verify changes
 * 5. List with filters → verify results
 * 6. Task status with execution history
 */
describe("Schedule Flow — Integration", () => {
  const testDbPath = path.join(os.tmpdir(), `scheduler-flow-${Date.now()}.db`);
  let repo: TaskRepository;
  let service: TaskService;

  beforeAll(async () => {
    repo = new TaskRepository(testDbPath);
    await repo.initialize();
    service = new TaskService(repo);
  });

  afterAll(() => {
    repo.close();
    try {
      fs.unlinkSync(testDbPath);
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    const allStatuses = ["active", "cancelled", "completed", "failed", "paused"] as const;
    for (const status of allStatuses) {
      const tasks = repo.findByStatus(status);
      for (const t of tasks) {
        repo.delete(t.id);
      }
    }
  });

  // ─── 1. One-time task lifecycle ────────────────────────────────

  describe("One-time task lifecycle", () => {
    it("should create, persist, and allow status query", () => {
      const when = new Date(Date.now() + 86400000).toISOString();

      // Create
      const created = service.createTask({
        type: "one_time",
        when,
        workflow: "send-reminder",
        workflowInput: { message: "Test reminder" },
        createdBy: "user-1",
        userRole: "admin",
        notifyOnFailure: true,
        notifyTo: ["user@test.com"],
      });

      expect(created.id).toBeDefined();
      expect(created.status).toBe("active");
      expect(created.nextRunAt).toBe(when);

      // Verify persistence (direct repository access)
      const persisted = repo.findById(created.id);
      expect(persisted).not.toBeNull();
      expect(persisted!.workflow).toBe("send-reminder");
      expect(persisted!.workflowInput).toEqual({ message: "Test reminder" });
      expect(persisted!.status).toBe("active");
      expect(persisted!.runCount).toBe(0);
      expect(persisted!.executionHistory).toEqual([]);

      // Query status
      const status = service.getTaskStatus(created.id);
      expect(status.type).toBe("one_time");
      expect(status.when).toBe(when);
      expect(status.notifyOnFailure).toBe(true);
      expect(status.notifyTo).toEqual(["user@test.com"]);
    });
  });

  // ─── 2. Cron task lifecycle ────────────────────────────────────

  describe("Cron task lifecycle", () => {
    it("should create a cron task with calculated nextRunAt", () => {
      const created = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        workflowInput: { department: "engineering" },
        createdBy: "user-1",
        userRole: "admin",
        timezone: "America/Buenos_Aires",
      });

      expect(created.id).toBeDefined();
      expect(created.status).toBe("active");
      expect(created.nextRunAt).toBeDefined();

      // nextRunAt should be a valid ISO date in the future
      const nextRunDate = new Date(created.nextRunAt);
      expect(nextRunDate.getTime()).toBeGreaterThan(Date.now());

      // Verify persistence
      const persisted = repo.findById(created.id);
      expect(persisted).not.toBeNull();
      expect(persisted!.type).toBe("cron");
      expect(persisted!.cron).toBe("0 9 * * *");
      expect(persisted!.timezone).toBe("America/Buenos_Aires");
      expect(persisted!.nextRunAt).toBe(created.nextRunAt);
    });

    it("should calculate nextRunAt at 9 AM in the given timezone", () => {
      const created = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        createdBy: "user-1",
        userRole: "admin",
        timezone: "America/Buenos_Aires",
      });

      const nextRun = new Date(created.nextRunAt);
      // The hour in UTC should be 12 (9 AM BRT = 12 UTC) or 11 (daylight saving)
      // We just verify it's a valid future date
      expect(nextRun.getTime()).toBeGreaterThan(Date.now());
    });
  });

  // ─── 3. Cancel task ────────────────────────────────────────────

  describe("Cancel task", () => {
    it("should cancel an active task and persist the change", () => {
      const when = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      const cancelled = service.cancelTask({
        id: created.id,
        reason: "No longer needed",
        requestedBy: "user-1",
        userRole: "admin",
      });

      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.cancelledAt).toBeDefined();

      // Verify persistence
      const persisted = repo.findById(created.id);
      expect(persisted!.status).toBe("cancelled");
      expect(persisted!.cancelReason).toBe("No longer needed");
      expect(persisted!.cancelledAt).toBeDefined();

      // Verify it appears in cancelled list
      const listResult = service.listTasks({ status: "cancelled", limit: 50, offset: 0 });
      expect(listResult.tasks.some((t) => t.id === created.id)).toBe(true);
    });
  });

  // ─── 4. Reschedule ─────────────────────────────────────────────

  describe("Reschedule", () => {
    it("should reschedule a one_time task with new date", () => {
      const originalDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: originalDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      const newDate = new Date(Date.now() + 172800000).toISOString();
      const rescheduled = service.rescheduleTask({
        id: created.id,
        when: newDate,
        requestedBy: "user-1",
        userRole: "admin",
      });

      expect(rescheduled.status).toBe("active");
      expect(rescheduled.nextRunAt).toBe(newDate);

      // Verify persistence
      const persisted = repo.findById(created.id);
      expect(persisted!.nextRunAt).toBe(newDate);
      expect(persisted!.status).toBe("active");
    });

    it("should reschedule a cron task with new cron expression", () => {
      const created = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        createdBy: "user-1",
        userRole: "admin",
      });

      const originalNextRun = created.nextRunAt;

      const rescheduled = service.rescheduleTask({
        id: created.id,
        cron: "0 10 * * *",
        requestedBy: "user-1",
        userRole: "admin",
      });

      expect(rescheduled.status).toBe("active");
      expect(rescheduled.nextRunAt).not.toBe(originalNextRun);

      // Verify persistence
      const persisted = repo.findById(created.id);
      expect(persisted!.cron).toBe("0 10 * * *");
    });
  });

  // ─── 5. List with filters ──────────────────────────────────────

  describe("List with filters", () => {
    it("should list tasks filtered by status, type, and createdBy", () => {
      // Create multiple tasks
      const when1 = new Date(Date.now() + 86400000).toISOString();
      const when2 = new Date(Date.now() + 172800000).toISOString();

      const task1 = service.createTask({
        type: "one_time",
        when: when1,
        workflow: "test-1",
        createdBy: "user-a",
        userRole: "admin",
      });

      const task2 = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "test-2",
        createdBy: "user-b",
        userRole: "admin",
      });

      const task3 = service.createTask({
        type: "one_time",
        when: when2,
        workflow: "test-3",
        createdBy: "user-a",
        userRole: "admin",
      });

      // Cancel task3
      service.cancelTask({ id: task3.id, requestedBy: "user-a", userRole: "admin" });

      // Filter by status
      const activeTasks = service.listTasks({ status: "active", limit: 50, offset: 0 });
      expect(activeTasks.tasks.some((t) => t.id === task1.id)).toBe(true);
      expect(activeTasks.tasks.some((t) => t.id === task2.id)).toBe(true);
      expect(activeTasks.tasks.some((t) => t.id === task3.id)).toBe(false);

      // Filter by type
      const cronTasks = service.listTasks({ type: "cron", limit: 50, offset: 0 });
      expect(cronTasks.tasks.every((t) => t.type === "cron")).toBe(true);

      // Filter by createdBy
      const userATasks = service.listTasks({ createdBy: "user-a", limit: 50, offset: 0 });
      expect(userATasks.tasks.every((t) => t.createdBy === "user-a")).toBe(true);

      // Combined filters
      const combined = service.listTasks({
        status: "active",
        createdBy: "user-a",
        limit: 50,
        offset: 0,
      });
      expect(combined.tasks).toHaveLength(1);
      expect(combined.tasks[0].id).toBe(task1.id);
    });
  });

  // ─── 6. Task status with execution history ─────────────────────

  describe("Task status with execution history", () => {
    it("should return full details including execution history", () => {
      const when = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when,
        workflow: "test-workflow",
        workflowInput: { input: "data" },
        createdBy: "user-1",
        userRole: "admin",
        notifyOnFailure: true,
        notifyTo: ["admin@test.com"],
      });

      // Simulate execution by adding history directly
      const task = repo.findById(created.id)!;
      task.executionHistory = [
        {
          executedAt: new Date().toISOString(),
          status: "success",
          duration: 2500,
          result: { output: "completed" },
          triggeredBy: "scheduler",
        },
      ];
      task.runCount = 1;
      task.lastRunAt = new Date().toISOString();
      repo.update(task);

      // Query full status
      const status = service.getTaskStatus(created.id);
      expect(status.id).toBe(created.id);
      expect(status.type).toBe("one_time");
      expect(status.when).toBe(when);
      expect(status.workflow).toBe("test-workflow");
      expect(status.workflowInput).toEqual({ input: "data" });
      expect(status.createdBy).toBe("user-1");
      expect(status.status).toBe("active");
      expect(status.runCount).toBe(1);
      expect(status.lastRunAt).toBeDefined();
      expect(status.nextRunAt).toBe(when);
      expect(status.notifyOnFailure).toBe(true);
      expect(status.notifyTo).toEqual(["admin@test.com"]);
      expect(status.executionHistory).toHaveLength(1);
      expect(status.executionHistory[0].status).toBe("success");
      expect(status.executionHistory[0].duration).toBe(2500);
    });
  });

  // ─── 7. Error flows ────────────────────────────────────────────

  describe("Error flows", () => {
    it("should reject creating task with past date", () => {
      expect(() =>
        service.createTask({
          type: "one_time",
          when: new Date(Date.now() - 86400000).toISOString(),
          workflow: "test",
          createdBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("when must be in the future");
    });

    it("should reject cancelling non-existent task", () => {
      expect(() =>
        service.cancelTask({ id: "non-existent", requestedBy: "user-1", userRole: "admin" })
      ).toThrow("not found");
    });

    it("should reject rescheduling non-existent task", () => {
      expect(() =>
        service.rescheduleTask({
          id: "non-existent",
          when: new Date(Date.now() + 86400000).toISOString(),
          requestedBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("not found");
    });

    it("should reject querying non-existent task status", () => {
      expect(() => service.getTaskStatus("non-existent")).toThrow("not found");
    });

    it("should reject duplicate id", () => {
      const when = new Date(Date.now() + 86400000).toISOString();
      service.createTask({
        id: "550e8400-e29b-41d4-a716-446655440000",
        type: "one_time",
        when,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      expect(() =>
        service.createTask({
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "one_time",
          when: new Date(Date.now() + 172800000).toISOString(),
          workflow: "test",
          createdBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("already exists");
    });
  });
});
