import { SchedulerEngine } from "../../src/engine/engine.js";
import type { TaskRepository } from "../../src/repository/task-repository.js";
import type { OrchestratorClient } from "../../src/clients/orchestrator-client.js";
import type { NotificationClient } from "../../src/clients/notification-client.js";
import type { ScheduledTask, ExecutionLog } from "../../src/types/task.js";

// ─── Mocks ───────────────────────────────────────────────────────

function createMockRepository(): jest.Mocked<TaskRepository> {
  return {
    initialize: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    findByStatus: jest.fn(),
    findDueTasks: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
    close: jest.fn(),
  } as unknown as jest.Mocked<TaskRepository>;
}

function createMockOrchestratorClient(): jest.Mocked<OrchestratorClient> {
  return {
    startFlow: jest.fn(),
  } as unknown as jest.Mocked<OrchestratorClient>;
}

function createMockNotificationClient(): jest.Mocked<NotificationClient> {
  return {
    notify: jest.fn(),
  } as unknown as jest.Mocked<NotificationClient>;
}

// ─── Helpers ─────────────────────────────────────────────────────

function createDueTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    type: "one_time",
    when: new Date(Date.now() - 1000).toISOString(),
    timezone: "UTC",
    workflow: "test-workflow",
    workflowInput: { key: "value" },
    createdBy: "user-1",
    status: "active",
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
    runCount: 0,
    notifyOnFailure: false,
    notifyTo: [],
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    executionHistory: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("SchedulerEngine", () => {
  let mockRepo: jest.Mocked<TaskRepository>;
  let mockOrchestrator: jest.Mocked<OrchestratorClient>;
  let mockNotifier: jest.Mocked<NotificationClient>;
  let engine: SchedulerEngine;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRepo = createMockRepository();
    // Default: no due tasks (prevents tick errors in lifecycle tests)
    mockRepo.findDueTasks.mockReturnValue([]);
    mockOrchestrator = createMockOrchestratorClient();
    mockNotifier = createMockNotificationClient();
    engine = new SchedulerEngine(
      mockRepo,
      mockOrchestrator,
      mockNotifier,
      30_000,
      300_000
    );
  });

  afterEach(() => {
    engine.stop();
    jest.useRealTimers();
  });

  // ─── Lifecycle ─────────────────────────────────────────────────

  describe("lifecycle", () => {
    it("should start and set running=true", () => {
      expect(engine.getStatus().running).toBe(false);
      engine.start();
      expect(engine.getStatus().running).toBe(true);
    });

    it("should stop and set running=false", () => {
      engine.start();
      expect(engine.getStatus().running).toBe(true);
      engine.stop();
      expect(engine.getStatus().running).toBe(false);
    });

    it("should not start twice", () => {
      engine.start();
      engine.start(); // second call should be no-op
      expect(engine.getStatus().running).toBe(true);
    });

    it("should execute tick immediately on start", () => {
      mockRepo.findDueTasks.mockReturnValue([]);
      engine.start();
      expect(mockRepo.findDueTasks).toHaveBeenCalledTimes(1);
    });

    it("should update lastTick after tick", () => {
      mockRepo.findDueTasks.mockReturnValue([]);
      engine.start();
      expect(engine.getStatus().lastTick).toBeDefined();
    });

    it("should emit tick-complete event after tick", () => {
      const listener = jest.fn();
      engine.onTickComplete(listener);
      mockRepo.findDueTasks.mockReturnValue([]);
      engine.start();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        found: 0,
        executed: 0,
        succeeded: 0,
        failed: 0,
      });
    });

    it("should remove tick listener", () => {
      const listener = jest.fn();
      engine.onTickComplete(listener);
      engine.removeTickListener(listener);
      mockRepo.findDueTasks.mockReturnValue([]);
      engine.start();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ─── getStatus ─────────────────────────────────────────────────

  describe("getStatus", () => {
    it("should return initial status when not started", () => {
      const status = engine.getStatus();
      expect(status).toEqual({
        running: false,
        lastTick: null,
        tasksProcessed: 0,
      });
    });

    it("should return updated status after tick", () => {
      mockRepo.findDueTasks.mockReturnValue([]);
      engine.start();
      const status = engine.getStatus();
      expect(status.running).toBe(true);
      expect(status.lastTick).toBeDefined();
      expect(status.tasksProcessed).toBe(0);
    });

    it("should increment tasksProcessed after successful execution", async () => {
      const task = createDueTask();
      mockRepo.findDueTasks.mockReturnValue([task]);
      mockOrchestrator.startFlow.mockResolvedValue({
        success: true,
        result: { output: "done" },
      });

      // We need to let the async tick complete
      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;

      expect(engine.getStatus().tasksProcessed).toBe(1);
    });
  });

  // ─── Task execution — success ──────────────────────────────────

  describe("task execution — success", () => {
    it("should execute a due one_time task and mark as completed", async () => {
      const task = createDueTask();
      mockRepo.findDueTasks.mockReturnValue([task]);
      mockOrchestrator.startFlow.mockResolvedValue({
        success: true,
        result: { output: "done" },
      });

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;

      expect(mockOrchestrator.startFlow).toHaveBeenCalledWith(
        "test-workflow",
        { key: "value" }
      );

      // Verify update was called with completed status
      const updatedTask = mockRepo.update.mock.calls[0][0];
      expect(updatedTask.status).toBe("completed");
      expect(updatedTask.runCount).toBe(1);
      expect(updatedTask.lastRunAt).toBeDefined();
      expect(updatedTask.nextRunAt).toBeUndefined();
      expect(updatedTask.executionHistory).toHaveLength(1);
      expect(updatedTask.executionHistory[0].status).toBe("success");
    });

    it("should execute a due cron task and recalculate nextRunAt", async () => {
      const task = createDueTask({
        type: "cron",
        cron: "0 9 * * *",
        nextRunAt: new Date(Date.now() - 1000).toISOString(),
      });
      mockRepo.findDueTasks.mockReturnValue([task]);
      mockOrchestrator.startFlow.mockResolvedValue({
        success: true,
        result: { output: "done" },
      });

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;

      const updatedTask = mockRepo.update.mock.calls[0][0];
      expect(updatedTask.status).toBe("active"); // cron stays active
      expect(updatedTask.runCount).toBe(1);
      expect(updatedTask.nextRunAt).toBeDefined();
      // nextRunAt should be in the future
      expect(new Date(updatedTask.nextRunAt!).getTime()).toBeGreaterThan(
        Date.now()
      );
    });

    it("should complete cron task when maxRuns is reached", async () => {
      const task = createDueTask({
        type: "cron",
        cron: "0 9 * * *",
        runCount: 4,
        maxRuns: 5,
        nextRunAt: new Date(Date.now() - 1000).toISOString(),
      });
      mockRepo.findDueTasks.mockReturnValue([task]);
      mockOrchestrator.startFlow.mockResolvedValue({
        success: true,
        result: { output: "done" },
      });

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;

      const updatedTask = mockRepo.update.mock.calls[0][0];
      expect(updatedTask.status).toBe("completed");
      expect(updatedTask.runCount).toBe(5);
      expect(updatedTask.nextRunAt).toBeUndefined();
    });
  });

  // ─── Task execution — failure ──────────────────────────────────

  describe("task execution — failure", () => {
    it("should mark task as failed when orchestrator returns error", async () => {
      const task = createDueTask();
      mockRepo.findDueTasks.mockReturnValue([task]);
      mockOrchestrator.startFlow.mockResolvedValue({
        success: false,
        error: "Workflow not found",
      });

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;

      const updatedTask = mockRepo.update.mock.calls[0][0];
      expect(updatedTask.status).toBe("failed");
      expect(updatedTask.executionHistory).toHaveLength(1);
      expect(updatedTask.executionHistory[0].status).toBe("failure");
      expect(updatedTask.executionHistory[0].error).toBe("Workflow not found");
    });

    it("should mark task as failed when orchestrator throws", async () => {
      const task = createDueTask();
      mockRepo.findDueTasks.mockReturnValue([task]);
      mockOrchestrator.startFlow.mockRejectedValue(
        new Error("Network error")
      );

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;

      const updatedTask = mockRepo.update.mock.calls[0][0];
      expect(updatedTask.status).toBe("failed");
      expect(updatedTask.executionHistory[0].error).toContain("Network error");
    });

    it("should notify when notifyOnFailure is true", async () => {
      const task = createDueTask({
        notifyOnFailure: true,
        notifyTo: ["admin@test.com"],
      });
      mockRepo.findDueTasks.mockReturnValue([task]);
      mockOrchestrator.startFlow.mockResolvedValue({
        success: false,
        error: "Workflow not found",
      });

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;

      expect(mockNotifier.notify).toHaveBeenCalledWith(
        "task-1",
        expect.stringContaining("failed"),
        ["admin@test.com"]
      );
    });

    it("should NOT notify when notifyOnFailure is false", async () => {
      const task = createDueTask({
        notifyOnFailure: false,
        notifyTo: ["admin@test.com"],
      });
      mockRepo.findDueTasks.mockReturnValue([task]);
      mockOrchestrator.startFlow.mockResolvedValue({
        success: false,
        error: "Workflow not found",
      });

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;

      expect(mockNotifier.notify).not.toHaveBeenCalled();
    });
  });

  // ─── Lock in memory ────────────────────────────────────────────

  describe("lock in memory", () => {
    it("should skip task that is already being executed", async () => {
      const task = createDueTask();
      // Return the same task twice (simulating two ticks with slow execution)
      mockRepo.findDueTasks.mockReturnValue([task]);

      // Make orchestrator slow so the lock persists
      let resolveOrchestrator!: (v: { success: boolean; result?: Record<string, unknown>; error?: string }) => void;
      mockOrchestrator.startFlow.mockReturnValue(
        new Promise((resolve) => {
          resolveOrchestrator = resolve;
        })
      );

      engine.start();

      // First tick started, task is locked
      await jest.advanceTimersByTimeAsync(100);

      // Second tick — should find the same task but skip due to lock
      mockRepo.findDueTasks.mockReturnValue([task]);
      await jest.advanceTimersByTimeAsync(30_000);

      // Resolve the orchestrator call
      resolveOrchestrator({ success: true, result: { output: "done" } });
      await jest.advanceTimersByTimeAsync(100);

      // update should have been called only once
      expect(mockRepo.update).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Timeout ───────────────────────────────────────────────────

  describe("task timeout", () => {
    it("should timeout a task that takes too long", async () => {
      const task = createDueTask();
      mockRepo.findDueTasks.mockReturnValue([task]);

      // Never resolves
      mockOrchestrator.startFlow.mockReturnValue(new Promise(() => {}));

      // Create engine with very short timeout
      const fastTimeoutEngine = new SchedulerEngine(
        mockRepo,
        mockOrchestrator,
        mockNotifier,
        30_000,
        100 // 100ms timeout
      );

      const tickPromise = new Promise<void>((resolve) => {
        fastTimeoutEngine.onTickComplete(() => resolve());
      });

      fastTimeoutEngine.start();

      // Advance fake timers past the 100ms timeout so the internal setTimeout fires
      await jest.advanceTimersByTimeAsync(200);

      await tickPromise;

      const updatedTask = mockRepo.update.mock.calls[0][0];
      expect(updatedTask.status).toBe("failed");
      expect(updatedTask.executionHistory[0].error).toContain("timed out");

      fastTimeoutEngine.stop();
    }, 15000);
  });

  // ─── Multiple tasks ────────────────────────────────────────────

  describe("multiple tasks", () => {
    it("should execute multiple due tasks in one tick", async () => {
      const task1 = createDueTask({ id: "task-1", workflow: "wf-1" });
      const task2 = createDueTask({ id: "task-2", workflow: "wf-2" });
      mockRepo.findDueTasks.mockReturnValue([task1, task2]);
      mockOrchestrator.startFlow.mockResolvedValue({
        success: true,
        result: { output: "done" },
      });

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;

      expect(mockOrchestrator.startFlow).toHaveBeenCalledTimes(2);
      expect(mockRepo.update).toHaveBeenCalledTimes(2);
      expect(engine.getStatus().tasksProcessed).toBe(2);
    });

    it("should report correct tick result with mixed success/failure", async () => {
      const task1 = createDueTask({ id: "task-1" });
      const task2 = createDueTask({ id: "task-2" });
      mockRepo.findDueTasks.mockReturnValue([task1, task2]);
      mockOrchestrator.startFlow
        .mockResolvedValueOnce({ success: true, result: { ok: true } })
        .mockResolvedValueOnce({
          success: false,
          error: "Something went wrong",
        });

      const listener = jest.fn();
      engine.onTickComplete(listener);

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;

      // The first listener call is from the immediate tick
      expect(listener).toHaveBeenLastCalledWith({
        found: 2,
        executed: 2,
        succeeded: 1,
        failed: 1,
      });
    });
  });

  // ─── No due tasks ──────────────────────────────────────────────

  describe("no due tasks", () => {
    it("should do nothing when no tasks are due", async () => {
      mockRepo.findDueTasks.mockReturnValue([]);

      const listener = jest.fn();
      engine.onTickComplete(listener);

      engine.start();

      // Wait for the immediate tick
      await jest.advanceTimersByTimeAsync(100);

      expect(mockOrchestrator.startFlow).not.toHaveBeenCalled();
      expect(mockRepo.update).not.toHaveBeenCalled();
      expect(listener).toHaveBeenCalledWith({
        found: 0,
        executed: 0,
        succeeded: 0,
        failed: 0,
      });
    });
  });
});
