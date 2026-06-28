import { handleListScheduled } from "../../../src/tools/list-scheduled.js";
import type { TaskService } from "../../../src/services/task-service.js";
import { AuthService } from "../../../src/services/auth-service.js";
import type { ListScheduledOutput } from "../../../src/types/tools.js";

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
  return `list_scheduled ${JSON.stringify(args)}`;
}

function parseResponse(response: string): {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
} {
  return JSON.parse(response);
}

// ─── Tests ───────────────────────────────────────────────────────

describe("list_scheduled tool handler", () => {
  let mockService: jest.Mocked<TaskService>;
  let mockAuth: jest.Mocked<AuthService>;

  beforeEach(() => {
    mockService = createMockService();
    mockAuth = createMockAuthService();
    // Default: allow viewing all tasks
    mockAuth.canViewAllTasks.mockReturnValue(true);
  });

  describe("success cases", () => {
    it("should return list of tasks", async () => {
      const output: ListScheduledOutput = {
        total: 2,
        tasks: [
          {
            id: "task-1",
            type: "one_time",
            workflow: "test-1",
            status: "active",
            nextRunAt: new Date(Date.now() + 86400000).toISOString(),
            lastRunAt: null,
            runCount: 0,
            createdAt: new Date().toISOString(),
            createdBy: "user-1",
          },
          {
            id: "task-2",
            type: "cron",
            workflow: "test-2",
            status: "active",
            nextRunAt: new Date(Date.now() + 172800000).toISOString(),
            lastRunAt: null,
            runCount: 0,
            createdAt: new Date().toISOString(),
            createdBy: "user-2",
          },
        ],
      };
      mockService.listTasks.mockReturnValue(output);

      const prompt = buildPrompt({ limit: 50, offset: 0, userRole: "admin" });
      const response = parseResponse(await handleListScheduled(prompt, mockService, mockAuth));

      expect(response.content[0].type).toBe("text");
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.total).toBe(2);
      expect(parsed.tasks).toHaveLength(2);
    });

    it("should pass filters to service.listTasks", async () => {
      mockService.listTasks.mockReturnValue({ total: 0, tasks: [] });

      const prompt = buildPrompt({
        status: "active",
        type: "cron",
        createdBy: "user-1",
        userRole: "admin",
        limit: 10,
        offset: 0,
      });

      await handleListScheduled(prompt, mockService, mockAuth);

      expect(mockService.listTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "active",
          type: "cron",
          createdBy: "user-1",
          limit: 10,
          offset: 0,
        })
      );
    });

    it("should apply default values when not provided", async () => {
      mockService.listTasks.mockReturnValue({ total: 0, tasks: [] });

      const prompt = buildPrompt({ userRole: "admin" });
      await handleListScheduled(prompt, mockService, mockAuth);

      expect(mockService.listTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 50,
          offset: 0,
        })
      );
    });

    it("should allow admin to list all tasks without createdBy filter", async () => {
      mockAuth.canViewAllTasks.mockReturnValue(true);
      mockService.listTasks.mockReturnValue({ total: 1, tasks: [] });

      const prompt = buildPrompt({ userRole: "admin" });
      const response = parseResponse(await handleListScheduled(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.listTasks).toHaveBeenCalled();
    });

    it("should allow user to list tasks with createdBy filter", async () => {
      mockAuth.canViewAllTasks.mockReturnValue(false);
      mockService.listTasks.mockReturnValue({ total: 1, tasks: [] });

      const prompt = buildPrompt({ userRole: "user", createdBy: "user-1" });
      const response = parseResponse(await handleListScheduled(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.listTasks).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: "user-1" })
      );
    });
  });

  describe("authorization cases", () => {
    it("should reject user listing without createdBy filter", async () => {
      mockAuth.canViewAllTasks.mockReturnValue(false);

      const prompt = buildPrompt({ userRole: "user" });
      const response = parseResponse(await handleListScheduled(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Forbidden");
      expect(mockService.listTasks).not.toHaveBeenCalled();
    });
  });

  describe("error cases", () => {
    it("should return isError=true when service throws", async () => {
      mockService.listTasks.mockImplementation(() => {
        throw new Error("Database error");
      });

      const prompt = buildPrompt({ userRole: "admin" });
      const response = parseResponse(await handleListScheduled(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error: Database error");
    });

    it("should return isError=true when limit exceeds max", async () => {
      const prompt = buildPrompt({ limit: 999, userRole: "admin" });
      const response = parseResponse(await handleListScheduled(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });

    it("should return isError=true when offset is negative", async () => {
      const prompt = buildPrompt({ offset: -1, userRole: "admin" });
      const response = parseResponse(await handleListScheduled(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });
  });
});
