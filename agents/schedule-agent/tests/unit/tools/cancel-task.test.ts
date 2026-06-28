import { handleCancelTask } from "../../../src/tools/cancel-task.js";
import type { TaskService } from "../../../src/services/task-service.js";
import { AuthService } from "../../../src/services/auth-service.js";
import type { CancelTaskOutput } from "../../../src/types/tools.js";
import type { ScheduledTask } from "../../../src/types/task.js";

// ─── Helpers ─────────────────────────────────────────────────────

function createMockService(): jest.Mocked<TaskService> {
  return {
    createTask: jest.fn(),
    cancelTask: jest.fn(),
    rescheduleTask: jest.fn(),
    getTaskStatus: jest.fn(),
    listTasks: jest.fn(),
    getTaskById: jest.fn(),
  } as unknown as jest.Mocked<TaskService>;
}

function createMockAuthService(): jest.Mocked<AuthService> {
  return {
    canScheduleTask: jest.fn(),
    canModifyTask: jest.fn(),
    canViewAllTasks: jest.fn(),
    canViewTaskStatus: jest.fn(),
  } as unknown as jest.Mocked<AuthService>;
}

function buildPrompt(args: Record<string, unknown>): string {
  return `cancel_task ${JSON.stringify(args)}`;
}

function parseResponse(response: string): {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
} {
  return JSON.parse(response);
}

function createMockTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-123",
    createdBy: "other-user",
    type: "one_time",
    when: new Date(Date.now() + 86400000).toISOString(),
    timezone: "UTC",
    workflow: "test",
    workflowInput: {},
    status: "active",
    nextRunAt: new Date(Date.now() + 86400000).toISOString(),
    runCount: 0,
    notifyOnFailure: false,
    notifyTo: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    executionHistory: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("cancel_task tool handler", () => {
  let mockService: jest.Mocked<TaskService>;
  let mockAuth: jest.Mocked<AuthService>;

  beforeEach(() => {
    mockService = createMockService();
    mockAuth = createMockAuthService();
    // Default: allow all modifications
    mockAuth.canModifyTask.mockReturnValue(true);
  });

  describe("success cases", () => {
    it("should return success response when task is cancelled", async () => {
      const output: CancelTaskOutput = {
        id: "task-123",
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
      };
      mockService.cancelTask.mockReturnValue(output);
      mockService.getTaskById.mockReturnValue(createMockTask());

      const prompt = buildPrompt({
        id: "task-123",
        reason: "No longer needed",
        requestedBy: "admin-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleCancelTask(prompt, mockService, mockAuth));

      expect(response.content[0].type).toBe("text");
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.id).toBe("task-123");
      expect(parsed.status).toBe("cancelled");
    });

    it("should pass reason to service.cancelTask", async () => {
      mockService.cancelTask.mockReturnValue({
        id: "task-123",
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
      });
      mockService.getTaskById.mockReturnValue(createMockTask());

      const prompt = buildPrompt({
        id: "task-123",
        reason: "Duplicate entry",
        requestedBy: "admin",
        userRole: "admin",
      });

      await handleCancelTask(prompt, mockService, mockAuth);

      expect(mockService.cancelTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "task-123",
          reason: "Duplicate entry",
          requestedBy: "admin",
          userRole: "admin",
        })
      );
    });

    it("should allow admin to cancel another user's task", async () => {
      mockAuth.canModifyTask.mockReturnValue(true);
      mockService.getTaskById.mockReturnValue(createMockTask({ id: "task-other", createdBy: "user-2" }));
      mockService.cancelTask.mockReturnValue({
        id: "task-other",
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
      });

      const prompt = buildPrompt({
        id: "task-other",
        requestedBy: "admin-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleCancelTask(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.cancelTask).toHaveBeenCalled();
    });

    it("should allow user to cancel their own task", async () => {
      mockAuth.canModifyTask.mockImplementation(
        (_role: string, taskCreatorId: string, currentUserId: string) =>
          taskCreatorId === currentUserId
      );
      mockService.getTaskById.mockReturnValue(createMockTask({ id: "task-own", createdBy: "user-1" }));
      mockService.cancelTask.mockReturnValue({
        id: "task-own",
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
      });

      const prompt = buildPrompt({
        id: "task-own",
        requestedBy: "user-1",
        userRole: "user",
      });

      const response = parseResponse(await handleCancelTask(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.cancelTask).toHaveBeenCalled();
    });
  });

  describe("authorization cases", () => {
    it("should reject user cancelling another user's task", async () => {
      mockAuth.canModifyTask.mockReturnValue(false);
      mockService.getTaskById.mockReturnValue(createMockTask({ id: "task-other", createdBy: "user-2" }));

      const prompt = buildPrompt({
        id: "task-other",
        requestedBy: "user-1",
        userRole: "user",
      });

      const response = parseResponse(await handleCancelTask(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Forbidden");
      expect(mockService.cancelTask).not.toHaveBeenCalled();
    });
  });

  describe("error cases", () => {
    it("should return isError=true when task not found", async () => {
      mockService.getTaskById.mockReturnValue(null);

      const prompt = buildPrompt({
        id: "non-existent",
        requestedBy: "user-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleCancelTask(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("not found");
    });

    it("should return isError=true when service throws", async () => {
      mockService.getTaskById.mockReturnValue(createMockTask());
      mockService.cancelTask.mockImplementation(() => {
        throw new Error("Task not found");
      });

      const prompt = buildPrompt({
        id: "non-existent",
        requestedBy: "user-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleCancelTask(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error: Task not found");
    });

    it("should return isError=true when Zod validation fails (empty id)", async () => {
      const prompt = buildPrompt({
        id: "",
        requestedBy: "user-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleCancelTask(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });

    it("should return isError=true when requestedBy is missing", async () => {
      const prompt = buildPrompt({
        id: "task-123",
        userRole: "admin",
      });

      const response = parseResponse(await handleCancelTask(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });
  });
});
