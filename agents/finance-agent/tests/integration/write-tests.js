#!/usr/bin/env node

/**
 * Test Generator — Scheduler Integration Tests
 *
 * Generates tests/integration/scheduler-integration.test.ts
 * Run: node tests/integration/write-tests.js
 *
 * This script produces a comprehensive integration test suite for SchedulerClient
 * that covers all API methods, error scenarios, timeout handling, edge cases,
 * and a complete workflow simulation.
 */

const fs = require('fs');
const path = require('path');

const TEST_FILE = path.join(__dirname, 'scheduler-integration.test.ts');

const testContent = `import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SchedulerClient } from '../../src/core/scheduler-client';

// ──────────────────────────────────────────────
// Types for mock responses
// ──────────────────────────────────────────────

interface MockScheduleTaskOutput {
  id: string;
  status: string;
  nextRunAt: string;
}

interface MockCancelTaskOutput {
  taskId: string;
  status: string;
}

interface MockListTasksOutput {
  tasks: Array<{
    taskId: string;
    taskName: string;
    schedule: string;
    status: string;
    nextRun?: string;
  }>;
  total: number;
}

interface MockRescheduleOutput {
  taskId: string;
  status: string;
  nextRunAt: string;
}

interface MockGetTaskStatusOutput {
  taskId: string;
  taskName: string;
  schedule: string;
  status: string;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
}

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const mockFetch = jest.fn<typeof global.fetch>();
global.fetch = mockFetch as unknown as typeof global.fetch;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Crea una respuesta fetch mockeada con los datos proporcionados.
 */
function createMockResponse(overrides: Partial<Response> = {}): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: jest.fn().mockResolvedValue({}),
    text: jest.fn().mockResolvedValue(''),
    ...overrides,
  } as unknown as Response;
}

/**
 * Crea una instancia de SchedulerClient con configuración de prueba.
 */
function createClient(config?: Partial<{ baseUrl: string; apiKey: string; timeoutMs: number }>) {
  return new SchedulerClient({
    baseUrl: config?.baseUrl || 'http://localhost:3100',
    apiKey: config?.apiKey || 'test-key',
    timeoutMs: config?.timeoutMs ?? 10000,
  });
}

// ──────────────────────────────────────────────
// Suite de pruebas de integración
// ──────────────────────────────────────────────

describe('SchedulerClient - Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ────────────────────────────────────────────
  // scheduleTask — POST /tasks
  // ────────────────────────────────────────────

  describe('scheduleTask', () => {
    it('should schedule a task and return id, status, and nextRunAt', async () => {
      const expectedOutput: MockScheduleTaskOutput = {
        id: 'task-001',
        status: 'scheduled',
        nextRunAt: '2026-08-01T09:00:00Z',
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.scheduleTask({
        taskName: 'monthly-report',
        schedule: '0 9 1 * *',
        action: 'generate_report',
        payload: { reportType: 'monthly' },
      });

      expect(result).toEqual(expectedOutput);
      expect(result.id).toBe('task-001');
      expect(result.status).toBe('scheduled');
      expect(result.nextRunAt).toBe('2026-08-01T09:00:00Z');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/tasks',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-key',
          }),
          body: expect.stringContaining('"taskName":"monthly-report"'),
        }),
      );
    });

    it('should handle scheduleTask with minimal input (no payload)', async () => {
      const expectedOutput: MockScheduleTaskOutput = {
        id: 'task-002',
        status: 'scheduled',
        nextRunAt: '2026-08-02T00:00:00Z',
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.scheduleTask({
        taskName: 'daily-check',
        schedule: '0 0 * * *',
        action: 'health_check',
      });

      expect(result).toEqual(expectedOutput);
      expect(result.id).toBe('task-002');
      expect(result.status).toBe('scheduled');
    });
  });

  // ────────────────────────────────────────────
  // cancelTask — DELETE /tasks/{taskId}
  // ────────────────────────────────────────────

  describe('cancelTask', () => {
    it('should cancel a task via DELETE /tasks/{taskId}', async () => {
      const expectedOutput: MockCancelTaskOutput = {
        taskId: 'task-001',
        status: 'cancelled',
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.cancelTask({ taskId: 'task-001' });

      expect(result).toEqual(expectedOutput);
      expect(result.taskId).toBe('task-001');
      expect(result.status).toBe('cancelled');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/tasks/task-001',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should throw an error when cancelling a non-existent task', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('{"message":"Task not found"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(client.cancelTask({ taskId: 'non-existent' })).rejects.toThrow('HTTP 404');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────
  // listTasks — GET /tasks?status=active
  // ────────────────────────────────────────────

  describe('listTasks', () => {
    it('should list tasks filtered by status=active', async () => {
      const expectedOutput: MockListTasksOutput = {
        tasks: [
          {
            taskId: 'task-001',
            taskName: 'monthly-report',
            schedule: '0 9 1 * *',
            status: 'active',
            nextRun: '2026-08-01T09:00:00Z',
          },
          {
            taskId: 'task-002',
            taskName: 'weekly-summary',
            schedule: '0 9 * * 1',
            status: 'active',
            nextRun: '2026-07-28T09:00:00Z',
          },
        ],
        total: 2,
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.listTasks({ status: 'active' });

      expect(result).toEqual(expectedOutput);
      expect(result.tasks).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=active'),
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should return empty list when no tasks match the filter', async () => {
      const expectedOutput: MockListTasksOutput = {
        tasks: [],
        total: 0,
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.listTasks({ status: 'completed' });

      expect(result).toEqual(expectedOutput);
      expect(result.tasks).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should list all tasks when no filter is provided', async () => {
      const expectedOutput: MockListTasksOutput = {
        tasks: [
          { taskId: 'task-001', taskName: 'monthly-report', schedule: '0 9 1 * *', status: 'active' },
          { taskId: 'task-002', taskName: 'weekly-summary', schedule: '0 9 * * 1', status: 'paused' },
        ],
        total: 2,
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.listTasks();

      expect(result).toEqual(expectedOutput);
      expect(result.tasks).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/tasks',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // ────────────────────────────────────────────
  // reschedule — PATCH /tasks/{taskId}
  // ────────────────────────────────────────────

  describe('reschedule', () => {
    it('should reschedule a task via PATCH /tasks/{taskId}', async () => {
      const expectedOutput: MockRescheduleOutput = {
        taskId: 'task-001',
        status: 'rescheduled',
        nextRunAt: '2026-09-01T09:00:00Z',
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.reschedule({
        taskId: 'task-001',
        schedule: '0 9 1 * *',
      });

      expect(result).toEqual(expectedOutput);
      expect(result.taskId).toBe('task-001');
      expect(result.status).toBe('rescheduled');
      expect(result.nextRunAt).toBe('2026-09-01T09:00:00Z');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/tasks/task-001',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"schedule":"0 9 1 * *"'),
        }),
      );
    });

    it('should throw an error when rescheduling a non-existent task', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('{"message":"Task not found"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(client.reschedule({
        taskId: 'non-existent',
        schedule: '0 0 * * *',
      })).rejects.toThrow('HTTP 404');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────
  // getTaskStatus — GET /tasks/{taskId}
  // ────────────────────────────────────────────

  describe('getTaskStatus', () => {
    it('should get task status via GET /tasks/{taskId}', async () => {
      const expectedOutput: MockGetTaskStatusOutput = {
        taskId: 'task-001',
        taskName: 'monthly-report',
        schedule: '0 9 1 * *',
        status: 'active',
        lastRun: '2026-07-01T09:00:00Z',
        nextRun: '2026-08-01T09:00:00Z',
        createdAt: '2026-06-01T10:00:00Z',
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.getTaskStatus({ taskId: 'task-001' });

      expect(result).toEqual(expectedOutput);
      expect(result.taskId).toBe('task-001');
      expect(result.taskName).toBe('monthly-report');
      expect(result.status).toBe('active');
      expect(result.lastRun).toBe('2026-07-01T09:00:00Z');
      expect(result.nextRun).toBe('2026-08-01T09:00:00Z');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/tasks/task-001',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should throw an error when task does not exist', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('{"message":"Task not found"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(client.getTaskStatus({ taskId: 'non-existent' })).rejects.toThrow('HTTP 404');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────
  // Timeout — fetch never resolves
  // ────────────────────────────────────────────

  describe('Timeout handling', () => {
    it('should throw a Timeout error when fetch never resolves', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockImplementation((_url: string, options: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = options.signal as AbortSignal;
          if (signal.aborted) {
            reject(abortError);
            return;
          }
          signal.addEventListener('abort', () => reject(abortError), { once: true });
        });
      });

      const client = createClient({ timeoutMs: 50 });

      await expect(client.scheduleTask({
        taskName: 'timeout-task',
        schedule: '0 0 * * *',
        action: 'test',
      })).rejects.toThrow('Timeout');
    }, 5000);

    it('should throw a Timeout error on cancelTask when fetch is slow', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockImplementation((_url: string, options: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = options.signal as AbortSignal;
          if (signal.aborted) {
            reject(abortError);
            return;
          }
          signal.addEventListener('abort', () => reject(abortError), { once: true });
        });
      });

      const client = createClient({ timeoutMs: 50 });

      await expect(client.cancelTask({ taskId: 'task-timeout' })).rejects.toThrow('Timeout');
    }, 5000);
  });

  // ────────────────────────────────────────────
  // HTTP error — fetch responds with 500
  // ────────────────────────────────────────────

  describe('HTTP error handling', () => {
    it('should throw an error when scheduler responds with HTTP 500 on scheduleTask', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('{"message":"Scheduler unavailable"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(client.scheduleTask({
        taskName: 'failing-task',
        schedule: '0 0 * * *',
        action: 'test',
      })).rejects.toThrow('HTTP 500');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw an error when scheduler responds with HTTP 500 on listTasks', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('{"message":"Failed to list tasks"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(client.listTasks()).rejects.toThrow('HTTP 500');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw an error when scheduler responds with HTTP 500 on getTaskStatus', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('{"message":"Failed to get task status"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(client.getTaskStatus({ taskId: 'task-001' })).rejects.toThrow('HTTP 500');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw an error when scheduler responds with HTTP 500 on reschedule', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('{"message":"Failed to reschedule task"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(client.reschedule({
        taskId: 'task-001',
        schedule: '0 0 * * *',
      })).rejects.toThrow('HTTP 500');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw an error when scheduler responds with HTTP 500 on cancelTask', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('{"message":"Failed to cancel task"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(client.cancelTask({ taskId: 'task-001' })).rejects.toThrow('HTTP 500');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────
  // Flujo completo (end-to-end simulado)
  // ────────────────────────────────────────────

  describe('Complete workflow simulation', () => {
    it('should schedule, list, get status, reschedule, and cancel a task in sequence', async () => {
      const client = createClient();

      // 1. Schedule a task
      const scheduleResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'task-flow-001',
          status: 'scheduled',
          nextRunAt: '2026-08-01T09:00:00Z',
        }),
      });

      // 2. List tasks
      const listResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          tasks: [
            { taskId: 'task-flow-001', taskName: 'flow-test', schedule: '0 9 1 * *', status: 'active' },
          ],
          total: 1,
        }),
      });

      // 3. Get task status
      const statusResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          taskId: 'task-flow-001',
          taskName: 'flow-test',
          schedule: '0 9 1 * *',
          status: 'active',
          lastRun: '2026-07-01T09:00:00Z',
          nextRun: '2026-08-01T09:00:00Z',
          createdAt: '2026-06-01T10:00:00Z',
        }),
      });

      // 4. Reschedule
      const rescheduleResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          taskId: 'task-flow-001',
          status: 'rescheduled',
          nextRunAt: '2026-09-01T09:00:00Z',
        }),
      });

      // 5. Cancel
      const cancelResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          taskId: 'task-flow-001',
          status: 'cancelled',
        }),
      });

      mockFetch
        .mockResolvedValueOnce(scheduleResponse)
        .mockResolvedValueOnce(listResponse)
        .mockResolvedValueOnce(statusResponse)
        .mockResolvedValueOnce(rescheduleResponse)
        .mockResolvedValueOnce(cancelResponse);

      // Act - 1: Schedule
      const scheduleResult = await client.scheduleTask({
        taskName: 'flow-test',
        schedule: '0 9 1 * *',
        action: 'test',
      });
      expect(scheduleResult.id).toBe('task-flow-001');
      expect(scheduleResult.status).toBe('scheduled');

      // Act - 2: List
      const listResult = await client.listTasks({ status: 'active' });
      expect(listResult.tasks).toHaveLength(1);
      expect(listResult.tasks[0].taskId).toBe('task-flow-001');

      // Act - 3: Get status
      const statusResult = await client.getTaskStatus({ taskId: 'task-flow-001' });
      expect(statusResult.status).toBe('active');
      expect(statusResult.nextRun).toBe('2026-08-01T09:00:00Z');

      // Act - 4: Reschedule
      const rescheduleResult = await client.reschedule({
        taskId: 'task-flow-001',
        schedule: '0 9 1 * *',
      });
      expect(rescheduleResult.status).toBe('rescheduled');

      // Act - 5: Cancel
      const cancelResult = await client.cancelTask({ taskId: 'task-flow-001' });
      expect(cancelResult.status).toBe('cancelled');

      expect(mockFetch).toHaveBeenCalledTimes(5);
    });
  });

  // ────────────────────────────────────────────
  // Casos borde
  // ────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle network error (fetch rejects with non-AbortError)', async () => {
      mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const client = createClient();
      await expect(client.scheduleTask({
        taskName: 'network-fail',
        schedule: '0 0 * * *',
        action: 'test',
      })).rejects.toThrow('connect ECONNREFUSED');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle empty task list gracefully', async () => {
      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ tasks: [], total: 0 }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.listTasks();

      expect(result.tasks).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should use custom base URL when provided', async () => {
      const customBaseUrl = 'http://custom-scheduler:4000';
      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'task-custom', status: 'scheduled', nextRunAt: '2026-08-01T00:00:00Z' }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient({ baseUrl: customBaseUrl });
      await client.scheduleTask({
        taskName: 'custom-task',
        schedule: '0 0 * * *',
        action: 'test',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        \`\${customBaseUrl}/tasks\`,
        expect.any(Object),
      );
    });

    it('should include Authorization header with the configured API key', async () => {
      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'task-auth', status: 'scheduled', nextRunAt: '2026-08-01T00:00:00Z' }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient({ apiKey: 'custom-key-456' });
      await client.scheduleTask({
        taskName: 'auth-task',
        schedule: '0 0 * * *',
        action: 'test',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer custom-key-456',
          }),
        }),
      );
    });
  });
});
`;

// ──────────────────────────────────────────────
// Write the test file
// ──────────────────────────────────────────────

fs.writeFileSync(TEST_FILE, testContent, 'utf-8');
console.log('✓ Generated: tests/integration/scheduler-integration.test.ts');
