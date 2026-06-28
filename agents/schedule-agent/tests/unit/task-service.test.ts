import { TaskRepository } from "../../src/repository/task-repository.js";
import { TaskService } from "../../src/services/task-service.js";
import type { ScheduledTask } from "../../src/types/task.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

describe("TaskService", () => {
  const testDbPath = path.join(os.tmpdir(), `scheduler-svc-test-${Date.now()}.db`);
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
    // Clean all tasks
    const allStatuses = ["active", "cancelled", "completed", "failed", "paused"] as const;
    for (const status of allStatuses) {
      const tasks = repo.findByStatus(status);
      for (const t of tasks) {
        repo.delete(t.id);
      }
    }
  });

  // ─── createTask ────────────────────────────────────────────────

  describe("createTask", () => {
    it("should create a one_time task", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const result = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test-workflow",
        createdBy: "user-1",
        userRole: "admin",
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe("active");
      expect(result.nextRunAt).toBe(futureDate);
      expect(result.createdAt).toBeDefined();
    });

    it("should create a cron task", () => {
      const result = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        createdBy: "user-1",
        userRole: "admin",
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe("active");
      expect(result.nextRunAt).toBeDefined();
    });

    it("should reject one_time without when", () => {
      expect(() =>
        service.createTask({
          type: "one_time",
          workflow: "test",
          createdBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("when is required for one_time tasks");
    });

    it("should reject cron without cron expression", () => {
      expect(() =>
        service.createTask({
          type: "cron",
          workflow: "test",
          createdBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("cron is required for cron tasks");
    });

    it("should reject empty workflow", () => {
      expect(() =>
        service.createTask({
          type: "one_time",
          when: new Date(Date.now() + 86400000).toISOString(),
          workflow: "   ",
          createdBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("workflow cannot be empty");
    });

    it("should reject past dates", () => {
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

    it("should reject invalid cron expression", () => {
      expect(() =>
        service.createTask({
          type: "cron",
          cron: "invalid-cron",
          workflow: "test",
          createdBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("Invalid cron expression");
    });

    it("should reject duplicate id", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      service.createTask({
        id: "dup-id",
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      expect(() =>
        service.createTask({
          id: "dup-id",
          type: "one_time",
          when: new Date(Date.now() + 172800000).toISOString(),
          workflow: "test",
          createdBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("already exists");
    });
  });

  // ─── cancelTask ────────────────────────────────────────────────

  describe("cancelTask", () => {
    it("should cancel an active task", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      const result = service.cancelTask({
        id: created.id,
        reason: "No longer needed",
        requestedBy: "user-1",
        userRole: "admin",
      });

      expect(result.status).toBe("cancelled");
      expect(result.cancelledAt).toBeDefined();
    });

    it("should reject cancelling non-existent task", () => {
      expect(() =>
        service.cancelTask({
          id: "non-existent",
          requestedBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("not found");
    });

    it("should reject cancelling completed task", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      // Manually set to completed
      const task = repo.findById(created.id)!;
      task.status = "completed";
      repo.update(task);

      expect(() =>
        service.cancelTask({
          id: created.id,
          requestedBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("Cannot cancel task in status");
    });

    it("should reject cancelling cancelled task", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      service.cancelTask({ id: created.id, requestedBy: "user-1", userRole: "admin" });

      expect(() =>
        service.cancelTask({ id: created.id, requestedBy: "user-1", userRole: "admin" })
      ).toThrow("Cannot cancel task in status");
    });
  });

  // ─── rescheduleTask ────────────────────────────────────────────

  describe("rescheduleTask", () => {
    it("should reschedule a one_time task with new when", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

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

    it("should reject rescheduling non-existent task", () => {
      expect(() =>
        service.rescheduleTask({
          id: "non-existent",
          requestedBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("not found");
    });

    it("should reject rescheduling completed task", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      const task = repo.findById(created.id)!;
      task.status = "completed";
      repo.update(task);

      expect(() =>
        service.rescheduleTask({
          id: created.id,
          when: new Date(Date.now() + 172800000).toISOString(),
          requestedBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("Cannot reschedule task in status");
    });

    it("should reject changing type from one_time to cron", () => {
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
          cron: "0 9 * * *",
          requestedBy: "user-1",
          userRole: "admin",
        })
      ).toThrow("Cannot set 'cron' on a one_time task");
    });
  });

  // ─── getTaskStatus ─────────────────────────────────────────────

  describe("getTaskStatus", () => {
    it("should return full task details", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test-workflow",
        workflowInput: { key: "value" },
        createdBy: "user-1",
        userRole: "admin",
        notifyOnFailure: true,
        notifyTo: ["admin@test.com"],
      });

      const status = service.getTaskStatus(created.id);

      expect(status.id).toBe(created.id);
      expect(status.type).toBe("one_time");
      expect(status.workflow).toBe("test-workflow");
      expect(status.workflowInput).toEqual({ key: "value" });
      expect(status.createdBy).toBe("user-1");
      expect(status.status).toBe("active");
      expect(status.runCount).toBe(0);
      expect(status.notifyOnFailure).toBe(true);
      expect(status.notifyTo).toEqual(["admin@test.com"]);
      expect(status.executionHistory).toEqual([]);
    });

    it("should reject non-existent task", () => {
      expect(() => service.getTaskStatus("non-existent")).toThrow("not found");
    });
  });

  // ─── listTasks ─────────────────────────────────────────────────

  describe("listTasks", () => {
    it("should list all tasks", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test-1",
        createdBy: "user-1",
        userRole: "admin",
      });
      service.createTask({
        type: "one_time",
        when: new Date(Date.now() + 172800000).toISOString(),
        workflow: "test-2",
        createdBy: "user-2",
        userRole: "admin",
      });

      const result = service.listTasks({ limit: 50, offset: 0 });
      expect(result.total).toBeGreaterThanOrEqual(2);
    });

    it("should filter by createdBy", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-filter",
        userRole: "admin",
      });

      const result = service.listTasks({
        createdBy: "user-filter",
        limit: 50,
        offset: 0,
      });
      expect(result.tasks.every((t) => t.createdBy === "user-filter")).toBe(true);
    });

    it("should filter by status", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: futureDate,
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      service.cancelTask({ id: created.id, requestedBy: "user-1", userRole: "admin" });

      const result = service.listTasks({
        status: "cancelled",
        limit: 50,
        offset: 0,
      });
      expect(result.tasks.some((t) => t.id === created.id)).toBe(true);
    });
  });
});
