import { TaskRepository } from "../../src/repository/task-repository.js";
import { TaskService } from "../../src/services/task-service.js";
import { SchedulerEngine } from "../../src/engine/engine.js";
import { NotificationClient } from "../../src/clients/notification-client.js";
import type { OrchestratorClient } from "../../src/clients/orchestrator-client.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Integration tests for advanced use cases (Fase 5):
 *
 * 1. Gate timeout — crear one_time, cancelarla antes de que se ejecute
 * 2. Informe recurrente — cron con workflowInput complejo
 * 3. NotifyOnFailure — tarea con notifyOnFailure=true, simular fallo
 * 4. ExecutionHistory — ejecutar tarea y verificar historial
 * 5. Flujo completo — schedule → engine ejecuta → estado actualizado → task_status
 */

// ─── Helpers ─────────────────────────────────────────────────────

function createMockOrchestrator(): jest.Mocked<OrchestratorClient> {
  return {
    startFlow: jest.fn(),
  } as unknown as jest.Mocked<OrchestratorClient>;
}

describe("Advanced Use Cases — Integration", () => {
  const testDbPath = path.join(os.tmpdir(), `scheduler-advanced-${Date.now()}.db`);
  let repo: TaskRepository;
  let service: TaskService;
  let mockOrchestrator: jest.Mocked<OrchestratorClient>;
  let notifier: NotificationClient;
  let engine: SchedulerEngine;

  beforeAll(async () => {
    repo = new TaskRepository(testDbPath);
    await repo.initialize();
    service = new TaskService(repo);
  });

  afterAll(() => {
    engine?.stop();
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

    // Reset mocks
    mockOrchestrator = createMockOrchestrator();
    notifier = new NotificationClient();
    engine = new SchedulerEngine(repo, mockOrchestrator, notifier, 30_000, 5_000);
  });

  afterEach(() => {
    engine.stop();
  });

  // ─── 1. Gate timeout ──────────────────────────────────────────

  describe("Gate timeout — cancel before execution", () => {
    it("should create a one_time task and cancel it before engine runs", () => {
      const when = new Date(Date.now() + 86400000).toISOString();

      // 1. Schedule the escalation task
      const created = service.createTask({
        type: "one_time",
        when,
        workflow: "escalate-approval",
        workflowInput: {
          requestId: "req-123",
          reviewer: "juan@empresa.com",
          manager: "gerencia@empresa.com",
        },
        createdBy: "sistema",
        userRole: "admin",
        notifyOnFailure: true,
        notifyTo: ["admin@empresa.com"],
      });

      expect(created.status).toBe("active");
      expect(created.nextRunAt).toBe(when);

      // 2. Cancel before execution (simulating "approved on time")
      const cancelled = service.cancelTask({
        id: created.id,
        reason: "Approved by manager on time",
        requestedBy: "juan@empresa.com",
        userRole: "admin",
      });

      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.cancelledAt).toBeDefined();

      // 3. Verify persistence
      const persisted = repo.findById(created.id);
      expect(persisted!.status).toBe("cancelled");
      expect(persisted!.cancelReason).toBe("Approved by manager on time");

      // 4. Engine should NOT execute a cancelled task
      mockOrchestrator.startFlow.mockResolvedValue({
        success: true,
        result: { output: "should not run" },
      });

      // Run engine tick — should find no due tasks (cancelled)
      engine.start();
      engine.stop();

      expect(mockOrchestrator.startFlow).not.toHaveBeenCalled();
    });

    it("should execute the task if NOT cancelled before due time", async () => {
      // Create a task that is already due (past date)
      const pastDate = new Date(Date.now() - 5000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(), // future for creation
        workflow: "escalate-approval",
        workflowInput: { requestId: "req-456" },
        createdBy: "sistema",
        userRole: "admin",
      });

      // Manually set nextRunAt to past so engine picks it up
      const task = repo.findById(created.id)!;
      task.nextRunAt = pastDate;
      repo.update(task);

      mockOrchestrator.startFlow.mockResolvedValue({
        success: true,
        result: { escalated: true },
      });

      // Wait for engine tick
      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;
      engine.stop();

      expect(mockOrchestrator.startFlow).toHaveBeenCalledWith(
        "escalate-approval",
        { requestId: "req-456" }
      );

      const updated = repo.findById(created.id);
      expect(updated!.status).toBe("completed");
      expect(updated!.runCount).toBe(1);
    });
  });

  // ─── 2. Informe recurrente con workflowInput complejo ─────────

  describe("Recurring report with complex workflowInput", () => {
    it("should create a cron task with nested workflowInput and persist correctly", () => {
      const complexInput = {
        to: ["gerencia@empresa.com", "ops@empresa.com"],
        include: {
          vault: true,
          fleet: true,
          runs: true,
          agents: ["scheduler", "orchestrator", "notifier"],
        },
        format: "pdf",
        retentionDays: 90,
      };

      const created = service.createTask({
        type: "cron",
        cron: "0 9 29 * *",
        timezone: "America/Argentina/Buenos_Aires",
        workflow: "health-report-email",
        workflowInput: complexInput,
        createdBy: "admin",
        userRole: "admin",
        notifyOnFailure: true,
        notifyTo: ["ops@empresa.com"],
      });

      expect(created.status).toBe("active");
      expect(created.nextRunAt).toBeDefined();

      // Verify persistence with full complex input
      const persisted = repo.findById(created.id);
      expect(persisted).not.toBeNull();
      expect(persisted!.type).toBe("cron");
      expect(persisted!.cron).toBe("0 9 29 * *");
      expect(persisted!.timezone).toBe("America/Argentina/Buenos_Aires");
      expect(persisted!.workflow).toBe("health-report-email");
      expect(persisted!.workflowInput).toEqual(complexInput);
      expect(persisted!.notifyOnFailure).toBe(true);
      expect(persisted!.notifyTo).toEqual(["ops@empresa.com"]);

      // Verify via task_status
      const status = service.getTaskStatus(created.id);
      expect(status.workflowInput).toEqual(complexInput);
      expect(status.timezone).toBe("America/Argentina/Buenos_Aires");
    });

    it("should preserve workflowInput across reschedule", () => {
      const complexInput = {
        to: ["gerencia@empresa.com"],
        include: { vault: true, fleet: true },
        format: "pdf",
      };

      const created = service.createTask({
        type: "cron",
        cron: "0 9 29 * *",
        workflow: "health-report-email",
        workflowInput: complexInput,
        createdBy: "admin",
        userRole: "admin",
      });

      // Reschedule with updated workflowInput
      const updatedInput = {
        ...complexInput,
        to: ["gerencia@empresa.com", "nuevo@empresa.com"],
        retentionDays: 60,
      };

      service.rescheduleTask({
        id: created.id,
        workflowInput: updatedInput,
        requestedBy: "admin",
        userRole: "admin",
      });

      const persisted = repo.findById(created.id);
      expect(persisted!.workflowInput).toEqual(updatedInput);
      expect(persisted!.workflowInput).not.toEqual(complexInput);
    });
  });

  // ─── 3. NotifyOnFailure ───────────────────────────────────────

  describe("NotifyOnFailure", () => {
    it("should call notification client when task fails with notifyOnFailure=true", async () => {
      const notifySpy = jest.spyOn(notifier, "notify");

      const pastDate = new Date(Date.now() - 5000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        workflow: "failing-workflow",
        createdBy: "user-1",
        userRole: "admin",
        notifyOnFailure: true,
        notifyTo: ["admin@test.com"],
      });

      // Make it due
      const task = repo.findById(created.id)!;
      task.nextRunAt = pastDate;
      repo.update(task);

      mockOrchestrator.startFlow.mockResolvedValue({
        success: false,
        error: "Workflow not found: failing-workflow",
      });

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;
      engine.stop();

      // Verify notification was sent
      expect(notifySpy).toHaveBeenCalledWith(
        created.id,
        expect.stringContaining("failed"),
        ["admin@test.com"]
      );

      // Verify task is marked as failed
      const updated = repo.findById(created.id);
      expect(updated!.status).toBe("failed");
      expect(updated!.executionHistory[0].status).toBe("failure");
      expect(updated!.executionHistory[0].error).toContain("Workflow not found");

      notifySpy.mockRestore();
    });

    it("should NOT call notification client when notifyOnFailure is false", async () => {
      const notifySpy = jest.spyOn(notifier, "notify");

      const pastDate = new Date(Date.now() - 5000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        workflow: "failing-workflow",
        createdBy: "user-1",
        userRole: "admin",
        notifyOnFailure: false,
        notifyTo: ["admin@test.com"],
      });

      const task = repo.findById(created.id)!;
      task.nextRunAt = pastDate;
      repo.update(task);

      mockOrchestrator.startFlow.mockResolvedValue({
        success: false,
        error: "Workflow error",
      });

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;
      engine.stop();

      expect(notifySpy).not.toHaveBeenCalled();

      notifySpy.mockRestore();
    });

    it("should notify on internal engine error (timeout)", async () => {
      const notifySpy = jest.spyOn(notifier, "notify");

      const pastDate = new Date(Date.now() - 5000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        workflow: "slow-workflow",
        createdBy: "user-1",
        userRole: "admin",
        notifyOnFailure: true,
        notifyTo: ["ops@test.com"],
      });

      const task = repo.findById(created.id)!;
      task.nextRunAt = pastDate;
      repo.update(task);

      // Never resolves → timeout
      mockOrchestrator.startFlow.mockReturnValue(new Promise(() => {}));

      // Engine with short timeout
      const fastEngine = new SchedulerEngine(repo, mockOrchestrator, notifier, 30_000, 100);

      const tickPromise = new Promise<void>((resolve) => {
        fastEngine.onTickComplete(() => resolve());
      });

      fastEngine.start();
      await tickPromise;
      fastEngine.stop();

      expect(notifySpy).toHaveBeenCalledWith(
        created.id,
        expect.stringContaining("failed"),
        ["ops@test.com"]
      );

      const updated = repo.findById(created.id);
      expect(updated!.status).toBe("failed");
      expect(updated!.executionHistory[0].error).toContain("timed out");

      notifySpy.mockRestore();
    });
  });

  // ─── 4. ExecutionHistory ──────────────────────────────────────

  describe("ExecutionHistory", () => {
    it("should record execution history after successful run", async () => {
      const pastDate = new Date(Date.now() - 5000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        workflow: "success-workflow",
        workflowInput: { input: "data" },
        createdBy: "user-1",
        userRole: "admin",
      });

      const task = repo.findById(created.id)!;
      task.nextRunAt = pastDate;
      repo.update(task);

      // Use a delayed resolution so duration > 0
      mockOrchestrator.startFlow.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ success: true, result: { output: "completed", id: "flow-123" } }), 5)
          )
      );

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;
      engine.stop();

      const updated = repo.findById(created.id);
      expect(updated!.executionHistory).toHaveLength(1);

      const log = updated!.executionHistory[0];
      expect(log.status).toBe("success");
      expect(log.duration).toBeGreaterThanOrEqual(0);
      expect(log.executedAt).toBeDefined();
      expect(log.triggeredBy).toBe("scheduler");
      expect(log.result).toEqual({ output: "completed", id: "flow-123" });
      expect(log.error).toBeUndefined();
    });

    it("should record execution history after failed run", async () => {
      const pastDate = new Date(Date.now() - 5000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        workflow: "fail-workflow",
        createdBy: "user-1",
        userRole: "admin",
      });

      const task = repo.findById(created.id)!;
      task.nextRunAt = pastDate;
      repo.update(task);

      // Use a delayed resolution so duration > 0
      mockOrchestrator.startFlow.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ success: false, error: "Internal server error" }), 5)
          )
      );

      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;
      engine.stop();

      const updated = repo.findById(created.id);
      expect(updated!.executionHistory).toHaveLength(1);

      const log = updated!.executionHistory[0];
      expect(log.status).toBe("failure");
      expect(log.duration).toBeGreaterThanOrEqual(0);
      expect(log.error).toBe("Internal server error");
      expect(log.triggeredBy).toBe("scheduler");
    });

    it("should accumulate multiple execution history entries for cron tasks", async () => {
      // Use a separate engine with very short interval so the second tick fires quickly
      const fastIntervalEngine = new SchedulerEngine(repo, mockOrchestrator, notifier, 50, 5_000);

      const pastDate1 = new Date(Date.now() - 10000).toISOString();
      const created = service.createTask({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-task",
        createdBy: "user-1",
        userRole: "admin",
      });

      // Simulate first execution
      const task = repo.findById(created.id)!;
      task.nextRunAt = pastDate1;
      repo.update(task);

      mockOrchestrator.startFlow.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ success: true, result: { run: 1 } }), 5)
          )
      );

      const tick1 = new Promise<void>((resolve) => {
        fastIntervalEngine.onTickComplete(() => resolve());
      });

      fastIntervalEngine.start();
      await tick1;

      // Simulate second execution: update nextRunAt to past so next tick picks it up
      const pastDate2 = new Date(Date.now() - 5000).toISOString();
      const taskAfterFirst = repo.findById(created.id)!;
      taskAfterFirst.nextRunAt = pastDate2;
      repo.update(taskAfterFirst);

      mockOrchestrator.startFlow.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ success: true, result: { run: 2 } }), 5)
          )
      );

      const tick2 = new Promise<void>((resolve) => {
        fastIntervalEngine.onTickComplete(() => resolve());
      });

      await tick2;
      fastIntervalEngine.stop();

      const updated = repo.findById(created.id);
      expect(updated!.executionHistory).toHaveLength(2);
      expect(updated!.runCount).toBe(2);
      expect(updated!.executionHistory[0].status).toBe("success");
      expect(updated!.executionHistory[1].status).toBe("success");
    }, 10000);
  });

  // ─── 5. Full flow ─────────────────────────────────────────────

  describe("Full flow — schedule → execute → status", () => {
    it("should complete the full lifecycle: create, execute, verify status with history", async () => {
      // 1. Schedule a one_time task due immediately
      const pastDate = new Date(Date.now() - 5000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        workflow: "full-flow-workflow",
        workflowInput: { key: "value" },
        createdBy: "user-1",
        userRole: "admin",
        notifyOnFailure: true,
        notifyTo: ["admin@test.com"],
      });

      // Make it due
      const task = repo.findById(created.id)!;
      task.nextRunAt = pastDate;
      repo.update(task);

      // Use delayed resolution so duration > 0
      mockOrchestrator.startFlow.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ success: true, result: { output: "done", id: "flow-999" } }), 5)
          )
      );

      // 2. Engine executes
      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;
      engine.stop();

      // 3. Verify via task_status
      const status = service.getTaskStatus(created.id);
      expect(status.id).toBe(created.id);
      expect(status.type).toBe("one_time");
      expect(status.workflow).toBe("full-flow-workflow");
      expect(status.workflowInput).toEqual({ key: "value" });
      expect(status.createdBy).toBe("user-1");
      expect(status.status).toBe("completed");
      expect(status.runCount).toBe(1);
      expect(status.lastRunAt).toBeDefined();
      expect(status.nextRunAt).toBeNull();
      expect(status.notifyOnFailure).toBe(true);
      expect(status.notifyTo).toEqual(["admin@test.com"]);

      // 4. Verify execution history via task_status
      expect(status.executionHistory).toHaveLength(1);
      expect(status.executionHistory[0].status).toBe("success");
      expect(status.executionHistory[0].duration).toBeGreaterThanOrEqual(0);
      expect(status.executionHistory[0].triggeredBy).toBe("scheduler");
      expect(status.executionHistory[0].result).toEqual({
        output: "done",
        id: "flow-999",
      });
    });

    it("should handle full flow with failure and notification", async () => {
      const notifySpy = jest.spyOn(notifier, "notify");

      // 1. Schedule
      const pastDate = new Date(Date.now() - 5000).toISOString();
      const created = service.createTask({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        workflow: "failing-flow",
        workflowInput: { cause: "error" },
        createdBy: "user-1",
        userRole: "admin",
        notifyOnFailure: true,
        notifyTo: ["ops@test.com"],
      });

      // Make it due
      const task = repo.findById(created.id)!;
      task.nextRunAt = pastDate;
      repo.update(task);

      mockOrchestrator.startFlow.mockResolvedValue({
        success: false,
        error: "Workflow crashed",
      });

      // 2. Engine executes
      const tickPromise = new Promise<void>((resolve) => {
        engine.onTickComplete(() => resolve());
      });

      engine.start();
      await tickPromise;
      engine.stop();

      // 3. Verify via task_status
      const status = service.getTaskStatus(created.id);
      expect(status.status).toBe("failed");
      expect(status.runCount).toBe(0); // No increment on failure
      expect(status.lastRunAt).toBeDefined();
      expect(status.executionHistory).toHaveLength(1);
      expect(status.executionHistory[0].status).toBe("failure");
      expect(status.executionHistory[0].error).toBe("Workflow crashed");

      // 4. Verify notification was sent
      expect(notifySpy).toHaveBeenCalledWith(
        created.id,
        expect.stringContaining("failed"),
        ["ops@test.com"]
      );

      notifySpy.mockRestore();
    });
  });
});
