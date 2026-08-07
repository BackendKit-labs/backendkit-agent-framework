import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SchedulerClient } from '../../src/core/scheduler-client';
import { NotifierClient } from '../../src/core/notifier-client';

// ──────────────────────────────────────────────
// Types for mock responses
// ──────────────────────────────────────────────

interface MockScheduleTaskOutput {
  taskId: string;
  status: string;
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

interface MockSendNotificationOutput {
  notificationId: string;
  status: string;
  sentTo: string[];
}

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const mockFetch = jest.fn<typeof global.fetch>();
let originalFetch: typeof global.fetch;

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
function createSchedulerClient(config?: Partial<{ baseUrl: string; apiKey: string; timeoutMs: number }>) {
  return new SchedulerClient({
    baseUrl: config?.baseUrl || 'http://localhost:3100',
    apiKey: config?.apiKey || 'test-key',
    timeoutMs: config?.timeoutMs ?? 10000,
  });
}

/**
 * Crea una instancia de NotifierClient con configuración de prueba.
 */
function createNotifierClient(config?: Partial<{ baseUrl: string; apiKey: string; timeoutMs: number }>) {
  return new NotifierClient({
    baseUrl: config?.baseUrl || 'http://localhost:3101',
    apiKey: config?.apiKey || 'test-key',
    timeoutMs: config?.timeoutMs ?? 10000,
  });
}

// ──────────────────────────────────────────────
// Suite de pruebas de integración del workflow
// ──────────────────────────────────────────────

describe('Report Workflow Integration', () => {
  let scheduler: SchedulerClient;
  let notifier: NotifierClient;
  let taskId: string;
  let notificationId: string;

  beforeEach(() => {
    // Save original fetch and replace with mock
    originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof global.fetch;
    jest.clearAllMocks();

    // Initialize clients
    scheduler = createSchedulerClient();
    notifier = createNotifierClient();

    // Reset variables
    taskId = '';
    notificationId = '';
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  it('debe ejecutar el flujo completo de reporte', async () => {
    // ── Arrange ──

    // 1. Mock scheduleTask response (POST /tasks)
    const scheduleResponse = createMockResponse({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        taskId: 'task-report-001',
        status: 'scheduled',
      } as MockScheduleTaskOutput),
    });

    // 2. Mock getTaskStatus response (GET /tasks/{taskId})
    const statusResponse = createMockResponse({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        taskId: 'task-report-001',
        taskName: 'reporte-mensual',
        schedule: '0 9 1 * *',
        status: 'active',
        lastRun: '2026-07-01T09:00:00Z',
        nextRun: '2026-08-01T09:00:00Z',
        createdAt: '2026-06-01T10:00:00Z',
      } as MockGetTaskStatusOutput),
    });

    // 3. Mock sendNotification response (POST /notifications/send)
    const notifyResponse = createMockResponse({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        notificationId: 'notif-report-001',
        status: 'sent',
        sentTo: ['cfo@empresa.com'],
      } as MockSendNotificationOutput),
    });

    // Chain responses in order: scheduleTask → getTaskStatus → sendNotification
    mockFetch
      .mockResolvedValueOnce(scheduleResponse)
      .mockResolvedValueOnce(statusResponse)
      .mockResolvedValueOnce(notifyResponse);

    // ── Act ──

    // Step 1: Schedule a recurring report task
    const scheduleResult = await scheduler.scheduleTask({
      taskName: 'reporte-mensual',
      schedule: '0 9 1 * *',
      action: 'generate_report',
      payload: {
        workflow: 'finance-report',
        template: 'balance',
        period: '2026-Q2',
      },
    });
    taskId = scheduleResult.taskId;

    // Step 2: Get the status of the scheduled task
    const statusResult = await scheduler.getTaskStatus({ taskId });

    // Step 3: Send a notification about the report
    const notifyResult = await notifier.sendNotification({
      channel: 'email',
      to: ['cfo@empresa.com'],
      subject: 'Reporte Mensual - Balance General Q2 2026',
      body: 'El reporte de Balance General para Q2 2026 ha sido generado y programado exitosamente.',
    });
    notificationId = notifyResult.notificationId;

    // ── Assert ──

    // Verify scheduleTask output
    expect(scheduleResult).toBeDefined();
    expect(scheduleResult.taskId).toBe('task-report-001');
    expect(scheduleResult.status).toBe('scheduled');

    // Verify getTaskStatus output
    expect(statusResult).toBeDefined();
    expect(statusResult.taskId).toBe('task-report-001');
    expect(statusResult.taskName).toBe('reporte-mensual');
    expect(statusResult.schedule).toBe('0 9 1 * *');
    expect(statusResult.status).toBe('active');
    expect(statusResult.lastRun).toBe('2026-07-01T09:00:00Z');
    expect(statusResult.nextRun).toBe('2026-08-01T09:00:00Z');
    expect(statusResult.createdAt).toBe('2026-06-01T10:00:00Z');

    // Verify sendNotification output
    expect(notifyResult).toBeDefined();
    expect(notifyResult.notificationId).toBe('notif-report-001');
    expect(notifyResult.status).toBe('sent');
    expect(notifyResult.sentTo).toContain('cfo@empresa.com');

    // Verify taskId and notificationId variables were set
    expect(taskId).toBe('task-report-001');
    expect(notificationId).toBe('notif-report-001');

    // Verify fetch was called exactly 3 times (one per step)
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify the order of calls
    const firstCallUrl = (mockFetch.mock.calls[0] as [string])[0];
    const secondCallUrl = (mockFetch.mock.calls[1] as [string])[0];
    const thirdCallUrl = (mockFetch.mock.calls[2] as [string])[0];

    expect(firstCallUrl).toContain('/tasks');
    expect(secondCallUrl).toContain('/tasks/');
    expect(thirdCallUrl).toContain('/notifications/send');

    // Verify HTTP methods
    const firstCallOptions = (mockFetch.mock.calls[0] as [string, RequestInit])[1];
    const secondCallOptions = (mockFetch.mock.calls[1] as [string, RequestInit])[1];
    const thirdCallOptions = (mockFetch.mock.calls[2] as [string, RequestInit])[1];

    expect(firstCallOptions.method).toBe('POST');
    expect(secondCallOptions.method).toBe('GET');
    expect(thirdCallOptions.method).toBe('POST');

    // Verify Authorization headers
    expect(firstCallOptions.headers).toMatchObject({
      Authorization: 'Bearer test-key',
    });
    expect(secondCallOptions.headers).toMatchObject({
      Authorization: 'Bearer test-key',
    });
    expect(thirdCallOptions.headers).toMatchObject({
      Authorization: 'Bearer test-key',
    });
  });
});
