import { AuthService } from "../../src/services/auth-service.js";

describe("AuthService", () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
  });

  // ─── canScheduleTask ───────────────────────────────────────────

  describe("canScheduleTask", () => {
    it("should allow admin to create cron tasks", () => {
      expect(authService.canScheduleTask("admin", "cron")).toBe(true);
    });

    it("should allow admin to create one_time tasks", () => {
      expect(authService.canScheduleTask("admin", "one_time")).toBe(true);
    });

    it("should allow manager to create cron tasks", () => {
      expect(authService.canScheduleTask("manager", "cron")).toBe(true);
    });

    it("should allow manager to create one_time tasks", () => {
      expect(authService.canScheduleTask("manager", "one_time")).toBe(true);
    });

    it("should allow user to create one_time tasks", () => {
      expect(authService.canScheduleTask("user", "one_time")).toBe(true);
    });

    it("should reject user creating cron tasks", () => {
      expect(authService.canScheduleTask("user", "cron")).toBe(false);
    });
  });

  // ─── canModifyTask ─────────────────────────────────────────────

  describe("canModifyTask", () => {
    it("should allow admin to modify any task", () => {
      expect(authService.canModifyTask("admin", "user-2", "admin-1")).toBe(true);
    });

    it("should allow manager to modify their own task", () => {
      expect(authService.canModifyTask("manager", "manager-1", "manager-1")).toBe(true);
    });

    it("should reject manager modifying another user's task", () => {
      expect(authService.canModifyTask("manager", "user-2", "manager-1")).toBe(false);
    });

    it("should allow user to modify their own task", () => {
      expect(authService.canModifyTask("user", "user-1", "user-1")).toBe(true);
    });

    it("should reject user modifying another user's task", () => {
      expect(authService.canModifyTask("user", "user-2", "user-1")).toBe(false);
    });
  });

  // ─── canViewAllTasks ───────────────────────────────────────────

  describe("canViewAllTasks", () => {
    it("should allow admin to view all tasks", () => {
      expect(authService.canViewAllTasks("admin")).toBe(true);
    });

    it("should allow manager to view all tasks", () => {
      expect(authService.canViewAllTasks("manager")).toBe(true);
    });

    it("should reject user viewing all tasks", () => {
      expect(authService.canViewAllTasks("user")).toBe(false);
    });
  });

  // ─── canViewTaskStatus ─────────────────────────────────────────

  describe("canViewTaskStatus", () => {
    it("should allow admin to view any task status", () => {
      expect(authService.canViewTaskStatus("admin", "user-2", "admin-1")).toBe(true);
    });

    it("should allow manager to view any task status", () => {
      expect(authService.canViewTaskStatus("manager", "user-2", "manager-1")).toBe(true);
    });

    it("should allow user to view their own task status", () => {
      expect(authService.canViewTaskStatus("user", "user-1", "user-1")).toBe(true);
    });

    it("should reject user viewing another user's task status", () => {
      expect(authService.canViewTaskStatus("user", "user-2", "user-1")).toBe(false);
    });
  });
});
