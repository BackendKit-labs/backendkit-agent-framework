import { TaskRepository } from "../../src/repository/task-repository.js";
import type { ScheduledTask } from "../../src/types/task.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

describe("TaskRepository", () => {
  const testDbPath = path.join(os.tmpdir(), `scheduler-test-${Date.now()}.db`);
  let repo: TaskRepository;

  const sampleTask: ScheduledTask = {
    id: "test-id-1",
    type: "one_time",
    when: new Date(Date.now() + 86400000).toISOString(), // tomorrow
    timezone: "UTC",
    workflow: "test-workflow",
    workflowInput: { key: "value" },
    createdBy: "user-1",
    status: "active",
    nextRunAt: new Date(Date.now() + 86400000).toISOString(),
    runCount: 0,
    notifyOnFailure: false,
    notifyTo: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    executionHistory: [],
  };

  beforeAll(async () => {
    repo = new TaskRepository(testDbPath);
    await repo.initialize();
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
    const tasks = repo.findByStatus("active");
    tasks.forEach((t) => repo.delete(t.id));
    const cancelled = repo.findByStatus("cancelled");
    cancelled.forEach((t) => repo.delete(t.id));
    const completed = repo.findByStatus("completed");
    completed.forEach((t) => repo.delete(t.id));
  });

  describe("create", () => {
    it("should create a task and persist it", () => {
      repo.create(sampleTask);
      const found = repo.findById(sampleTask.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(sampleTask.id);
      expect(found!.workflow).toBe("test-workflow");
    });
  });

  describe("findById", () => {
    it("should return null for non-existent task", () => {
      const found = repo.findById("non-existent");
      expect(found).toBeNull();
    });

    it("should return the task if it exists", () => {
      repo.create(sampleTask);
      const found = repo.findById(sampleTask.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(sampleTask.id);
    });
  });

  describe("findByStatus", () => {
    it("should return tasks with the given status", () => {
      repo.create(sampleTask);
      const tasks = repo.findByStatus("active");
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks.some((t) => t.id === sampleTask.id)).toBe(true);
    });

    it("should return empty array for status with no tasks", () => {
      const tasks = repo.findByStatus("failed");
      expect(tasks).toEqual([]);
    });
  });

  describe("findDueTasks", () => {
    it("should return tasks with nextRunAt <= now", () => {
      const pastTask: ScheduledTask = {
        ...sampleTask,
        id: "past-task",
        nextRunAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        when: new Date(Date.now() - 3600000).toISOString(),
      };
      repo.create(pastTask);

      const dueTasks = repo.findDueTasks(new Date().toISOString());
      expect(dueTasks.some((t) => t.id === "past-task")).toBe(true);
    });

    it("should not return future tasks", () => {
      const futureTask: ScheduledTask = {
        ...sampleTask,
        id: "future-task",
        nextRunAt: new Date(Date.now() + 86400000).toISOString(), // tomorrow
      };
      repo.create(futureTask);

      const dueTasks = repo.findDueTasks(new Date().toISOString());
      expect(dueTasks.some((t) => t.id === "future-task")).toBe(false);
    });
  });

  describe("update", () => {
    it("should update task fields", () => {
      repo.create(sampleTask);
      const updated = { ...sampleTask, status: "cancelled" as const };
      repo.update(updated);

      const found = repo.findById(sampleTask.id);
      expect(found!.status).toBe("cancelled");
    });
  });

  describe("delete", () => {
    it("should remove the task", () => {
      repo.create(sampleTask);
      const deleted = repo.delete(sampleTask.id);
      expect(deleted).toBe(true);

      const found = repo.findById(sampleTask.id);
      expect(found).toBeNull();
    });
  });

  describe("list", () => {
    it("should return all tasks with pagination", () => {
      repo.create(sampleTask);
      const result = repo.list({ limit: 50, offset: 0 });
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it("should filter by status", () => {
      repo.create(sampleTask);
      const result = repo.list({ status: "active", limit: 50, offset: 0 });
      expect(result.tasks.some((t) => t.id === sampleTask.id)).toBe(true);
    });

    it("should filter by createdBy", () => {
      repo.create(sampleTask);
      const result = repo.list({ createdBy: "user-1", limit: 50, offset: 0 });
      expect(result.tasks.some((t) => t.id === sampleTask.id)).toBe(true);
    });
  });
});
