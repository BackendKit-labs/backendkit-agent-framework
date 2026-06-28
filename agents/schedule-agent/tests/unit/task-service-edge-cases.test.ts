import { TaskRepository } from "../../src/repository/task-repository.js";
import { TaskService } from "../../src/services/task-service.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

describe("TaskService — edge cases", () => {
  const testDbPath = path.join(os.tmpdir(), `scheduler-svc-edge-${Date.now()}.db`);
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

  // ─── createTask edge cases ─────────────────────────────────────

  describe("createTask", () => {
    it("should create a one_time task with all optional fields", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const result = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test-workflow",
        workflowInput: { department: "engineering", priority: "high" },
        createdBy: "user-1",
        userRole: "admin",
        timezone: "America/Buenos_Aires",
        notifyOnFailure: true,
        notifyTo: ["admin@test.com", "dev@test.com"],
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe("active");

      const task = repo.findById(result.id)!;
      expect(task.workflowInput).toEqual({ department: "engineering", priority: "high" });
      expect(task.timezone).toBe("America/Buenos_Aires");
      expect(task.notifyOnFailure).toBe(true);
      expect(task.notifyTo).toEqual(["admin@test.com", "dev@test.com"]);
    });

    it("should create a cron task with timezone", () => {
      const result = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        createdBy: "user-1",
        userRole: "admin",
        timezone: "America/Buenos_Aires",
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe("active");
      expect(result.nextRunAt).toBeDefined();

      const task = repo.findById(result.id)!;
      expect(task.timezone).toBe("America/Buenos_Aires");
    });

    it("should reject when with invalid ISO date", () => {
      expect(() =>
        service.createTask({
          type: "one_time",
          when: "not-a-valid-date",
          workflow: "test",
          createdBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("when must be a valid ISO 8601 date");
    });

    it("should accept a custom id", () => {
      const customId = "550e8400-e29b-41d4-a716-446655440000";
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const result = service.createTask({
        id: customId,
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      expect(result.id).toBe(customId);
    });
  });

  // ─── cancelTask edge cases ─────────────────────────────────────

  describe("cancelTask", () => {
    it("should cancel a paused task", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      // Manually set to paused
      const task = repo.findById(created.id)!;
      task.status = "paused";
      repo.update(task);

      const result = service.cancelTask({
        id: created.id,
        reason: "Paused task no longer needed",
        requestedBy: "user-1",
        userRole: "admin",
      });

      expect(result.status).toBe("cancelled");
      expect(result.cancelledAt).toBeDefined();
    });

    it("should cancel a failed task", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      // Manually set to failed
      const task = repo.findById(created.id)!;
      task.status = "failed";
      repo.update(task);

      const result = service.cancelTask({
        id: created.id,
        requestedBy: "user-1",
        userRole: "admin",
      });

      expect(result.status).toBe("cancelled");
    });

    it("should store cancel reason", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      service.cancelTask({
        id: created.id,
        reason: "Duplicate entry — replaced by task-456",
        requestedBy: "admin",
        userRole: "admin",
      });

      const task = repo.findById(created.id)!;
      expect(task.cancelReason).toBe("Duplicate entry — replaced by task-456");
      expect(task.cancelledAt).toBeDefined();
    });
  });

  // ─── rescheduleTask edge cases ─────────────────────────────────

  describe("rescheduleTask", () => {
    it("should reschedule a cron task with new cron expression", () => {
      const created = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        createdBy: "user-1",
        userRole: "admin",
      });

      const result = service.rescheduleTask({
        id: created.id,
        cron: "0 10 * * *",
        requestedBy: "user-1",
        userRole: "admin",
      });

      expect(result.status).toBe("active");
      expect(result.nextRunAt).toBeDefined();
      // Should be different from original nextRunAt
      const task = repo.findById(created.id)!;
      expect(task.cron).toBe("0 10 * * *");
    });

    it("should reschedule a cron task with new timezone", () => {
      const created = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        createdBy: "user-1",
        userRole: "admin",
        timezone: "UTC",
      });

      const originalNextRun = created.nextRunAt;

      const result = service.rescheduleTask({
        id: created.id,
        timezone: "America/Buenos_Aires",
        requestedBy: "user-1",
        userRole: "admin",
      });

      expect(result.status).toBe("active");
      const task = repo.findById(created.id)!;
      expect(task.timezone).toBe("America/Buenos_Aires");
      // nextRunAt should have changed due to timezone shift
      expect(task.nextRunAt).not.toBe(originalNextRun);
    });

    it("should update workflowInput when rescheduling", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        workflowInput: { oldKey: "oldValue" },
        createdBy: "user-1",
        userRole: "admin",
      });

      service.rescheduleTask({
        id: created.id,
        when: new Date(Date.now() + 172800000).toISOString(),
        workflowInput: { newKey: "newValue" },
        requestedBy: "user-1",
        userRole: "admin",
      });

      const task = repo.findById(created.id)!;
      expect(task.workflowInput).toEqual({ newKey: "newValue" });
    });

    it("should reschedule a paused task", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      // Manually set to paused
      const task = repo.findById(created.id)!;
      task.status = "paused";
      repo.update(task);

      const newDate = new Date(Date.now() + 172800000).toISOString();
      const result = service.rescheduleTask({
        id: created.id,
        when: newDate,
        requestedBy: "user-1",
        userRole: "admin",
      });

      expect(result.status).toBe("active");
      expect(result.nextRunAt).toBe(newDate);
    });

    it("should reschedule a failed task", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      const task = repo.findById(created.id)!;
      task.status = "failed";
      repo.update(task);

      const newDate = new Date(Date.now() + 172800000).toISOString();
      const result = service.rescheduleTask({
        id: created.id,
        when: newDate,
        requestedBy: "user-1",
        userRole: "admin",
      });

      expect(result.status).toBe("active");
    });

    it("should reject setting 'when' on a cron task", () => {
      const created = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      expect(() =>
        service.rescheduleTask({
          id: created.id,
          when: new Date(Date.now() + 86400000).toISOString(),
          requestedBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("Cannot set 'when' on a cron task");
    });

    it("should reject past date when rescheduling", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      expect(() =>
        service.rescheduleTask({
          id: created.id,
          when: new Date(Date.now() - 86400000).toISOString(),
          requestedBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("when must be in the future");
    });

    it("should reject invalid cron when rescheduling", () => {
      const created = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      expect(() =>
        service.rescheduleTask({
          id: created.id,
          cron: "invalid-cron",
          requestedBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("Invalid cron expression");
    });
  });

  // ─── getTaskStatus edge cases ──────────────────────────────────

  describe("getTaskStatus", () => {
    it("should return execution history when populated", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      // Manually add execution history
      const task = repo.findById(created.id)!;
      task.executionHistory = [
        {
          executedAt: new Date().toISOString(),
          status: "success",
          duration: 1500,
          result: { output: "ok" },
          triggeredBy: "scheduler",
        },
      ];
      task.runCount = 1;
      task.lastRunAt = new Date().toISOString();
      repo.update(task);

      const status = service.getTaskStatus(created.id);
      expect(status.executionHistory).toHaveLength(1);
      expect(status.executionHistory[0].status).toBe("success");
      expect(status.executionHistory[0].duration).toBe(1500);
      expect(status.runCount).toBe(1);
      expect(status.lastRunAt).toBeDefined();
    });

    it("should return empty execution history for new task", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      const status = service.getTaskStatus(created.id);
      expect(status.executionHistory).toEqual([]);
      expect(status.runCount).toBe(0);
    });
  });

  // ─── listTasks edge cases ──────────────────────────────────────

  describe("listTasks", () => {
    it("should filter by type", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test-1",
        createdBy: "user-1",
        userRole: "admin",
      });
      service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "test-2",
        createdBy: "user-1",
        userRole: "admin",
      });

      const result = service.listTasks({ type: "one_time", limit: 50, offset: 0 });
      expect(result.tasks.every((t) => t.type === "one_time")).toBe(true);
    });

    it("should respect pagination limit", () => {
      for (let i = 0; i < 5; i++) {
        const futureDate = new Date(Date.now() + 86400000 * (i + 1)).toISOString();
        service.createTask({
          type: "one_time",
          when: futureDate,
          workflow: `test-${i}`,
          createdBy: "user-1",
          userRole: "admin",
        });
      }

      const result = service.listTasks({ limit: 2, offset: 0 });
      expect(result.tasks).toHaveLength(2);
      expect(result.total).toBeGreaterThanOrEqual(5);
    });

    it("should respect pagination offset", () => {
      // Create tasks with different IDs
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const futureDate = new Date(Date.now() + 86400000 * (i + 1)).toISOString();
        const created = service.createTask({
          type: "one_time",
          when: futureDate,
          workflow: `test-offset-${i}`,
          createdBy: "user-offset",
          userRole: "admin",
        });
        ids.push(created.id);
      }

      const firstPage = service.listTasks({
        createdBy: "user-offset",
        limit: 1,
        offset: 0,
      });
      expect(firstPage.tasks).toHaveLength(1);

      const secondPage = service.listTasks({
        createdBy: "user-offset",
        limit: 1,
        offset: 1,
      });
      expect(secondPage.tasks).toHaveLength(1);
      expect(secondPage.tasks[0].id).not.toBe(firstPage.tasks[0].id);
    });

    it("should combine multiple filters", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test-combo",
        createdBy: "user-combo",
        userRole: "admin",
      });

      const result = service.listTasks({
        status: "active",
        type: "one_time",
        createdBy: "user-combo",
        limit: 50,
        offset: 0,
      });

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].workflow).toBe("test-combo");
    });

    it("should return empty array when no tasks match", () => {
      const result = service.listTasks({
        status: "failed",
        createdBy: "non-existent-user",
        limit: 50,
        offset: 0,
      });

      expect(result.tasks).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
