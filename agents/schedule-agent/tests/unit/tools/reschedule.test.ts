import { handleReschedule } from "../../../src/tools/reschedule.js";
import type { TaskService } from "../../../src/services/task-service.js";
import { AuthService } from "../../../src/services/auth-service.js";
import type { RescheduleOutput } from "../../../src/types/tools.js";
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
  return `reschedule ${JSON.stringify(args)}`;
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
    createdBy: "user-1",
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

describe("reschedule tool handler", () => {
  let mockService: jest.Mocked<TaskService>;
  let mockAuth: jest.Mocked<AuthService>;

  beforeEach(() => {
    mockService = createMockService();
    mockAuth = createMockAuthService();
    // Default: allow all modifications
    mockAuth.canModifyTask.mockReturnValue(true);
  });

  describe("success cases", () => {
    it("should return success response when task is rescheduled", async () => {
      const output: RescheduleOutput = {
        id: "task-123",
        status: "active",
        nextRunAt: new Date(Date.now() + 172800000).toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockService.rescheduleTask.mockReturnValue(output);
      mockService.getTaskById.mockReturnValue(createMockTask());

      const prompt = buildPrompt({
        id: "task-123",
        when: new Date(Date.now() + 172800000).toISOString(),
        requestedBy: "user-1",
        userRole: "user",
      });

      const response = parseResponse(await handleReschedule(prompt, mockService, mockAuth));

      expect(response.content[0].type).toBe("text");
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.id).toBe("task-123");
      expect(parsed.status).toBe("active");
    });

    it("should pass all fields to service.rescheduleTask", async () => {
      mockService.rescheduleTask.mockReturnValue({
        id: "task-123",
        status: "active",
        nextRunAt: new Date(Date.now() + 86400000).toISOString(),
        updatedAt: new Date().toISOString(),
      });
      mockService.getTaskById.mockReturnValue(createMockTask({
        type: "cron",
        cron: "0 9 * * *",
        createdBy: "admin",
      }));

      const prompt = buildPrompt({
        id: "task-123",
        cron: "0 10 * * 1",
        timezone: "America/Buenos_Aires",
        workflowInput: { key: "new-value" },
        requestedBy: "admin",
        userRole: "admin",
      });

      await handleReschedule(prompt, mockService, mockAuth);

      expect(mockService.rescheduleTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "task-123",
          cron: "0 10 * * 1",
          timezone: "America/Buenos_Aires",
          workflowInput: { key: "new-value" },
          requestedBy: "admin",
          userRole: "admin",
        })
      );
    });

    it("should allow admin to reschedule another user's task", async () => {
      mockAuth.canModifyTask.mockReturnValue(true);
      mockService.getTaskById.mockReturnValue(createMockTask({ id: "task-other", createdBy: "user-2" }));
      mockService.rescheduleTask.mockReturnValue({
        id: "task-other",
        status: "active",
        nextRunAt: new Date(Date.now() + 172800000).toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const prompt = buildPrompt({
        id: "task-other",
        when: new Date(Date.now() + 172800000).toISOString(),
        requestedBy: "admin-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleReschedule(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.rescheduleTask).toHaveBeenCalled();
    });

    it("should allow user to reschedule their own task", async () => {
      mockAuth.canModifyTask.mockImplementation(
        (_role: string, taskCreatorId: string, currentUserId: string) =>
          taskCreatorId === currentUserId
      );
      mockService.getTaskById.mockReturnValue(createMockTask({ id: "task-own", createdBy: "user-1" }));
      mockService.rescheduleTask.mockReturnValue({
        id: "task-own",
        status: "active",
        nextRunAt: new Date(Date.now() + 172800000).toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const prompt = buildPrompt({
        id: "task-own",
        when: new Date(Date.now() + 172800000).toISOString(),
        requestedBy: "user-1",
        userRole: "user",
      });

      const response = parseResponse(await handleReschedule(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.rescheduleTask).toHaveBeenCalled();
    });
  });

  describe("authorization cases", () => {
    it("should reject user rescheduling another user's task", async () => {
      mockAuth.canModifyTask.mockReturnValue(false);
      mockService.getTaskById.mockReturnValue(createMockTask({ id: "task-other", createdBy: "user-2" }));

      const prompt = buildPrompt({
        id: "task-other",
        when: new Date(Date.now() + 172800000).toISOString(),
        requestedBy: "user-1",
        userRole: "user",
      });

      const response = parseResponse(await handleReschedule(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Forbidden");
      expect(mockService.rescheduleTask).not.toHaveBeenCalled();
    });
  });

  describe("error cases", () => {
    it("should return isError=true when task not found", async () => {
      mockService.getTaskById.mockReturnValue(null);

      const prompt = buildPrompt({
        id: "non-existent",
        when: new Date(Date.now() + 86400000).toISOString(),
        requestedBy: "user-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleReschedule(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("not found");
    });

    it("should return isError=true when service throws", async () => {
      mockService.getTaskById.mockReturnValue(createMockTask());
      mockService.rescheduleTask.mockImplementation(() => {
        throw new Error("Cannot reschedule task in status");
      });

      const prompt = buildPrompt({
        id: "task-123",
        when: new Date(Date.now() + 86400000).toISOString(),
        requestedBy: "user-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleReschedule(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error: Cannot reschedule task in status");
    });

    it("should return isError=true when Zod validation fails (empty id)", async () => {
      const prompt = buildPrompt({
        id: "",
        requestedBy: "user-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleReschedule(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });

    it("should return isError=true when requestedBy is missing", async () => {
      const prompt = buildPrompt({
        id: "task-123",
        when: new Date(Date.now() + 86400000).toISOString(),
        userRole: "admin",
      });

      const response = parseResponse(await handleReschedule(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });

    it("should return isError=true for invalid ISO date in when", async () => {
      const prompt = buildPrompt({
        id: "task-123",
        when: "not-a-date",
        requestedBy: "user-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleReschedule(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });
  });
});
