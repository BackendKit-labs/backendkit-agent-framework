import { handleTaskStatus } from "../../../src/tools/task-status.js";
import type { TaskService } from "../../../src/services/task-service.js";
import { AuthService } from "../../../src/services/auth-service.js";
import type { TaskStatusOutput } from "../../../src/types/tools.js";
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
  return `task_status ${JSON.stringify(args)}`;
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
    workflow: "test-workflow",
    workflowInput: { key: "value" },
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

describe("task_status tool handler", () => {
  let mockService: jest.Mocked<TaskService>;
  let mockAuth: jest.Mocked<AuthService>;

  beforeEach(() => {
    mockService = createMockService();
    mockAuth = createMockAuthService();
    // Default: allow viewing any task status
    mockAuth.canViewTaskStatus.mockReturnValue(true);
  });

  describe("success cases", () => {
    it("should return full task details", async () => {
      const output: TaskStatusOutput = {
        id: "task-123",
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        cron: null,
        timezone: "UTC",
        workflow: "test-workflow",
        workflowInput: { key: "value" },
        createdBy: "user-1",
        status: "active",
        lastRunAt: null,
        nextRunAt: new Date(Date.now() + 86400000).toISOString(),
        runCount: 0,
        notifyOnFailure: false,
        notifyTo: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        executionHistory: [],
      };
      mockService.getTaskStatus.mockReturnValue(output);
      mockService.getTaskById.mockReturnValue(createMockTask());

      const prompt = buildPrompt({
        id: "task-123",
        userRole: "admin",
        requestedBy: "admin-1",
      });

      const response = parseResponse(await handleTaskStatus(prompt, mockService, mockAuth));

      expect(response.content[0].type).toBe("text");
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.id).toBe("task-123");
      expect(parsed.status).toBe("active");
      expect(parsed.executionHistory).toEqual([]);
    });

    it("should pass the id to service.getTaskStatus", async () => {
      mockService.getTaskStatus.mockReturnValue({
        id: "task-123",
        type: "one_time",
        when: null,
        cron: null,
        timezone: "UTC",
        workflow: "test",
        workflowInput: {},
        createdBy: "user-1",
        status: "active",
        lastRunAt: null,
        nextRunAt: null,
        runCount: 0,
        notifyOnFailure: false,
        notifyTo: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        executionHistory: [],
      });
      mockService.getTaskById.mockReturnValue(createMockTask());

      const prompt = buildPrompt({
        id: "task-123",
        userRole: "admin",
        requestedBy: "admin-1",
      });

      await handleTaskStatus(prompt, mockService, mockAuth);

      expect(mockService.getTaskStatus).toHaveBeenCalledWith("task-123");
    });

    it("should allow admin to view any task status", async () => {
      mockAuth.canViewTaskStatus.mockReturnValue(true);
      mockService.getTaskById.mockReturnValue(createMockTask({ id: "task-other", createdBy: "user-2" }));
      mockService.getTaskStatus.mockReturnValue({
        id: "task-other",
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        cron: null,
        timezone: "UTC",
        workflow: "test",
        workflowInput: {},
        createdBy: "user-2",
        status: "active",
        lastRunAt: null,
        nextRunAt: new Date(Date.now() + 86400000).toISOString(),
        runCount: 0,
        notifyOnFailure: false,
        notifyTo: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        executionHistory: [],
      });

      const prompt = buildPrompt({
        id: "task-other",
        userRole: "admin",
        requestedBy: "admin-1",
      });

      const response = parseResponse(await handleTaskStatus(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.getTaskStatus).toHaveBeenCalled();
    });

    it("should allow user to view their own task status", async () => {
      mockAuth.canViewTaskStatus.mockImplementation(
        (_role: string, taskCreatorId: string, currentUserId: string) =>
          taskCreatorId === currentUserId
      );
      mockService.getTaskById.mockReturnValue(createMockTask({ id: "task-own", createdBy: "user-1" }));
      mockService.getTaskStatus.mockReturnValue({
        id: "task-own",
        type: "one_time",
        when: new Date(Date.now() + 86400000).toISOString(),
        cron: null,
        timezone: "UTC",
        workflow: "test",
        workflowInput: {},
        createdBy: "user-1",
        status: "active",
        lastRunAt: null,
        nextRunAt: new Date(Date.now() + 86400000).toISOString(),
        runCount: 0,
        notifyOnFailure: false,
        notifyTo: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        executionHistory: [],
      });

      const prompt = buildPrompt({
        id: "task-own",
        userRole: "user",
        requestedBy: "user-1",
      });

      const response = parseResponse(await handleTaskStatus(prompt, mockService, mockAuth));

      expect(response.isError).toBeUndefined();
      expect(mockService.getTaskStatus).toHaveBeenCalled();
    });
  });

  describe("authorization cases", () => {
    it("should reject user viewing another user's task status", async () => {
      mockAuth.canViewTaskStatus.mockReturnValue(false);
      mockService.getTaskById.mockReturnValue(createMockTask({ id: "task-other", createdBy: "user-2" }));

      const prompt = buildPrompt({
        id: "task-other",
        userRole: "user",
        requestedBy: "user-1",
      });

      const response = parseResponse(await handleTaskStatus(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Forbidden");
      expect(mockService.getTaskStatus).not.toHaveBeenCalled();
    });
  });

  describe("error cases", () => {
    it("should return isError=true when task not found", async () => {
      mockService.getTaskById.mockReturnValue(null);

      const prompt = buildPrompt({
        id: "non-existent",
        userRole: "admin",
        requestedBy: "admin-1",
      });

      const response = parseResponse(await handleTaskStatus(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("not found");
    });

    it("should return isError=true when service throws", async () => {
      mockService.getTaskById.mockReturnValue(createMockTask());
      mockService.getTaskStatus.mockImplementation(() => {
        throw new Error("Task not found");
      });

      const prompt = buildPrompt({
        id: "non-existent",
        userRole: "admin",
        requestedBy: "admin-1",
      });

      const response = parseResponse(await handleTaskStatus(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error: Task not found");
    });

    it("should return isError=true when id is empty", async () => {
      const prompt = buildPrompt({
        id: "",
        userRole: "admin",
        requestedBy: "admin-1",
      });

      const response = parseResponse(await handleTaskStatus(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });

    it("should return isError=true when id is missing", async () => {
      const prompt = buildPrompt({
        userRole: "admin",
        requestedBy: "admin-1",
      });

      const response = parseResponse(await handleTaskStatus(prompt, mockService, mockAuth));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Error:");
    });
  });
});
