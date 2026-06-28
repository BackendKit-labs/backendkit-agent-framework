import { handleScheduleTask } from "../../../src/tools/schedule-task.js";
import type { TaskService } from "../../../src/services/task-service.js";
import { AuthService } from "../../../src/services/auth-service.js";
import type { ScheduleTaskOutput } from "../../../src/types/tools.js";

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

/**
 * Builds the prompt string as the engine would produce it.
 */
function buildPrompt(args: Record<string, unknown>): string {
  return `schedule_task ${JSON.stringify(args)}`;
}

/**
 * Parses the JSON response from a handler into { content, isError }.
 */
function parseResponse(response: string): {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
} {
  return JSON.parse(response);
}

// ─── Tests ───────────────────────────────────────────────────────

describe("schedule_task tool handler", () => {
  let mockService: jest.Mocked<TaskService>;
  let mockAuth: jest.Mocked<AuthService>;

  beforeEach(() => {
    mockService = createMockService();
    mockAuth = createMockAuthService();
    // Default: allow all scheduling
    mockAuth.canScheduleTask.mockReturnValue(true);
  });

  describe("success cases", () => {
    it("should return success response when task is created", async () => {
      const output: ScheduleTaskOutput = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        status: "active",
        nextRunAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      mockService.createTask.mockReturnValue(output);

      const prompt = buildPrompt({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        workflow: "test-workflow",
        createdBy: "user-1",
        userRole: "user",
      });

      const response = parseResponse(await handleScheduleTask(prompt, mockService, mockAuth));

      expect(response.content[0].type).toBe("text");
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.id).toBe(output.id);
      expect(parsed.status).toBe("active");
    });

    it("should pass parsed input to service.createTask", async () => {
      const output: ScheduleTaskOutput = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        status: "active",
        nextRunAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      };
      mockService.createTask.mockReturnValue(output);

      const prompt = buildPrompt({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        createdBy: "user-1",
        userRole: "admin",
        timezone: "America/Buenos_Aires",
        workflowInput: { department: "engineering" },
        notifyOnFailure: true,
        notifyTo: ["admin@test.com"],
      });

      await handleScheduleTask(prompt, mockService, mockAuth);

      expect(mockService.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "cron",
          cron: "0 9 * * *",
          workflow: "daily-report",
          createdBy: "user-1",
          userRole: "admin",
          timezone: "America/Buenos_Aires",
        })
      );
    });

    it("should allow user to create one_time tasks", async () => {
      mockAuth.canScheduleTask.mockImplementation(
        (role: string, type: string) => role === "user" && type === "one_time"
      );
      mockService.createTask.mockReturnValue({
        id: "task-1",
        status: "active",
        nextRunAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      });

      const prompt = buildPrompt({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        workflow: "test",
        createdBy: "user-1",
        userRole: "user",
      });

      const response = parseResponse(await handleScheduleTask(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.createTask).toHaveBeenCalled();
    });

    it("should allow admin to create cron tasks", async () => {
      mockAuth.canScheduleTask.mockReturnValue(true);
      mockService.createTask.mockReturnValue({
        id: "task-1",
        status: "active",
        nextRunAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      });

      const prompt = buildPrompt({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        createdBy: "admin-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleScheduleTask(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.createTask).toHaveBeenCalled();
    });

    it("should allow manager to create cron tasks", async () => {
      mockAuth.canScheduleTask.mockReturnValue(true);
      mockService.createTask.mockReturnValue({
        id: "task-1",
        status: "active",
        nextRunAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      });

      const prompt = buildPrompt({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        createdBy: "manager-1",
        userRole: "manager",
      });

      const response = parseResponse(await handleScheduleTask(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.createTask).toHaveBeenCalled();
    });
  });

  describe("authorization cases", () => {
    it("should reject user creating cron tasks with forbidden error", async () => {
      mockAuth.canScheduleTask.mockImplementation(
        (role: string, type: string) => !(role === "user" && type === "cron")
      );

      const prompt = buildPrompt({
        type: "cron",
        cron: "0 9 * * *",
        workflow: "daily-report",
        createdBy: "user-1",
        userRole: "user",
      });

      const response = parseResponse(await handleScheduleTask(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Forbidden");
      expect(mockService.createTask).not.toHaveBeenCalled();
    });
  });

  describe("error cases", () => {
    it("should return isError=true when service throws", async () => {
      mockService.createTask.mockImplementation(() => {
        throw new Error("when must be in the future");
      });

      const prompt = buildPrompt({
        type: "one_time",
        when: new Date(Date.now() - 86400000).toISOString(),
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleScheduleTask(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error: when must be in the future");
    });

    it("should return isError=true when Zod validation fails", async () => {
      const prompt = buildPrompt({
        type: "invalid-type",
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleScheduleTask(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });

    it("should handle unknown errors gracefully", async () => {
      mockService.createTask.mockImplementation(() => {
        throw "something unexpected"; // not an Error instance
      });

      const prompt = buildPrompt({
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        workflow: "test",
        createdBy: "user-1",
        userRole: "admin",
      });

      const response = parseResponse(await handleScheduleTask(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toBe("Error: Unknown error");
    });
  });
});
