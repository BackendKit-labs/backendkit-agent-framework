import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  NotifierClient,
  NotifierClientConfig,
  NotifyUserInput,
  NotifyUserOutput,
  SendNotificationInput,
  SendNotificationOutput,
  GetHistoryInput,
  GetHistoryOutput,
} from '../../src/core/notifier-client';

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
 * Crea una instancia de NotifierClient con configuración de prueba.
 */
function createClient(config?: Partial<NotifierClientConfig>) {
  return new NotifierClient({
    baseUrl: config?.baseUrl || 'http://localhost:3101',
    apiKey: config?.apiKey || 'test-key',
    timeoutMs: config?.timeoutMs ?? 10000,
  });
}

// ──────────────────────────────────────────────
// Suite de pruebas de integración
// ──────────────────────────────────────────────

describe('NotifierClient - Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ────────────────────────────────────────────
  // notifyUser — POST /notifications/user
  // ────────────────────────────────────────────

  describe('notifyUser', () => {
    it('should notify a user successfully via POST /notifications/user', async () => {
      const expectedOutput: NotifyUserOutput = {
        notificationId: 'notif-user-001',
        status: 'sent',
        channel: 'email',
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.notifyUser({
        userId: 'user-123',
        title: 'Reporte listo',
        message: 'El reporte mensual ya está disponible.',
        channel: 'email',
        priority: 'high',
      });

      expect(result).toEqual(expectedOutput);
      expect(result.notificationId).toBe('notif-user-001');
      expect(result.status).toBe('sent');
      expect(result.channel).toBe('email');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3101/notifications/user',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-key',
          }),
          body: expect.stringContaining('"userId":"user-123"'),
        }),
      );
    });

    it('should notify a user with minimal input (no channel or priority)', async () => {
      const expectedOutput: NotifyUserOutput = {
        notificationId: 'notif-user-002',
        status: 'sent',
        channel: 'email',
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.notifyUser({
        userId: 'user-456',
        title: 'Alerta',
        message: 'Sin canal ni prioridad',
      });

      expect(result).toEqual(expectedOutput);
      expect(result.notificationId).toBe('notif-user-002');
    });

    it('should handle HTTP 404 error on notifyUser', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('{"error":"User not found"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(
        client.notifyUser({ userId: 'unknown', title: 'Test', message: 'Test' }),
      ).rejects.toThrow('HTTP 404');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────
  // sendNotification — POST /notifications/send
  // ────────────────────────────────────────────

  describe('sendNotification', () => {
    it('should send a notification successfully via POST /notifications/send', async () => {
      const expectedOutput: SendNotificationOutput = {
        notificationId: 'notif-send-001',
        status: 'sent',
        sentTo: ['cfo@empresa.com'],
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.sendNotification({
        channel: 'email',
        to: ['cfo@empresa.com'],
        subject: 'Reporte Mensual',
        body: 'Adjunto el reporte mensual.',
      });

      expect(result).toEqual(expectedOutput);
      expect(result.notificationId).toBe('notif-send-001');
      expect(result.status).toBe('sent');
      expect(result.sentTo).toEqual(['cfo@empresa.com']);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3101/notifications/send',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"channel":"email"'),
        }),
      );
    });

    it('should send a notification with attachments', async () => {
      const expectedOutput: SendNotificationOutput = {
        notificationId: 'notif-send-002',
        status: 'sent',
        sentTo: ['user@test.com'],
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.sendNotification({
        to: ['user@test.com'],
        subject: 'Con adjunto',
        body: 'Revise el archivo.',
        attachments: [
          { filename: 'report.pdf', content: 'base64...', contentType: 'application/pdf' },
        ],
      });

      expect(result).toEqual(expectedOutput);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"attachments"'),
        }),
      );
    });

    it('should handle HTTP 400 error on sendNotification', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('{"error":"Invalid channel"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(
        client.sendNotification({
          channel: 'email',
          to: ['cfo@empresa.com'],
          subject: 'Test',
          body: 'Test',
        }),
      ).rejects.toThrow('HTTP 400');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────
  // getHistory — GET /notifications/history
  // ────────────────────────────────────────────

  describe('getHistory', () => {
    it('should retrieve notification history via GET /notifications/history', async () => {
      const expectedOutput: GetHistoryOutput = {
        notifications: [
          {
            notificationId: 'notif-hist-001',
            title: 'Reporte Mensual',
            status: 'sent',
            channel: 'email',
            createdAt: '2026-07-15T10:30:00Z',
          },
        ],
        total: 1,
      };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.getHistory();

      expect(result).toEqual(expectedOutput);
      expect(result.notifications).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3101/notifications/history',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should retrieve history with query filters', async () => {
      const expectedOutput: GetHistoryOutput = { notifications: [], total: 0 };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.getHistory({ limit: 5, offset: 10, status: 'sent' });

      expect(result).toEqual(expectedOutput);
      expect(result.notifications).toHaveLength(0);
      expect(result.total).toBe(0);
      const calledUrl = (mockFetch.mock.calls[0] as [string])[0];
      expect(calledUrl).toContain('limit=5');
      expect(calledUrl).toContain('offset=10');
      expect(calledUrl).toContain('status=sent');
    });

    it('should return empty history when no notifications match', async () => {
      const expectedOutput: GetHistoryOutput = { notifications: [], total: 0 };

      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedOutput),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.getHistory({ status: 'failed' });

      expect(result.notifications).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ────────────────────────────────────────────
  // Timeout — fetch never resolves
  // ────────────────────────────────────────────

  describe('Timeout handling', () => {
    it('should throw a Timeout error when fetch never resolves on sendNotification', async () => {
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

      await expect(
        client.sendNotification({
          channel: 'email',
          to: ['cfo@empresa.com'],
          subject: 'Timeout Test',
          body: 'This should timeout.',
        }),
      ).rejects.toThrow('Timeout');
    }, 5000);

    it('should throw a Timeout error on notifyUser when fetch is slow', async () => {
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

      await expect(
        client.notifyUser({ userId: 'timeout-user', title: 'Timeout', message: 'Slow' }),
      ).rejects.toThrow('Timeout');
    }, 5000);
  });

  // ────────────────────────────────────────────
  // HTTP error — fetch responds with 500
  // ────────────────────────────────────────────

  describe('HTTP error handling', () => {
    it('should throw an error when notifier responds with HTTP 500 on sendNotification', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('{"error":"Notifier unavailable"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(
        client.sendNotification({
          channel: 'email',
          to: ['cfo@empresa.com'],
          subject: 'Failing',
          body: 'Test',
        }),
      ).rejects.toThrow('HTTP 500');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw an error when notifier responds with HTTP 500 on notifyUser', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('{"error":"Failed to notify user"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(
        client.notifyUser({ userId: 'fail-user', title: 'Fail', message: 'Fail' }),
      ).rejects.toThrow('HTTP 500');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw an error when notifier responds with HTTP 500 on getHistory', async () => {
      const errorResponse = createMockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('{"error":"History unavailable"}'),
      });
      mockFetch.mockResolvedValue(errorResponse);

      const client = createClient();
      await expect(client.getHistory()).rejects.toThrow('HTTP 500');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────
  // Flujo completo (end-to-end simulado)
  // ────────────────────────────────────────────

  describe('Complete workflow simulation', () => {
    it('should notify user, send notification, and retrieve history in sequence', async () => {
      const client = createClient();

      // 1. Notify user
      const notifyUserResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          notificationId: 'notif-flow-001',
          status: 'sent',
          channel: 'email',
        }),
      });

      // 2. Send notification
      const sendResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          notificationId: 'notif-flow-002',
          status: 'sent',
          sentTo: ['cfo@empresa.com'],
        }),
      });

      // 3. Get history
      const historyResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          notifications: [
            {
              notificationId: 'notif-flow-001',
              title: 'Reporte listo',
              status: 'sent',
              channel: 'email',
              createdAt: '2026-07-15T10:30:00Z',
            },
            {
              notificationId: 'notif-flow-002',
              title: 'Reporte Mensual',
              status: 'sent',
              channel: 'email',
              createdAt: '2026-07-15T10:31:00Z',
            },
          ],
          total: 2,
        }),
      });

      mockFetch
        .mockResolvedValueOnce(notifyUserResponse)
        .mockResolvedValueOnce(sendResponse)
        .mockResolvedValueOnce(historyResponse);

      // Act - 1: Notify user
      const notifyResult = await client.notifyUser({
        userId: 'user-flow',
        title: 'Reporte listo',
        message: 'El reporte mensual ya está disponible.',
        channel: 'email',
        priority: 'high',
      });
      expect(notifyResult.notificationId).toBe('notif-flow-001');
      expect(notifyResult.status).toBe('sent');

      // Act - 2: Send notification
      const sendResult = await client.sendNotification({
        channel: 'email',
        to: ['cfo@empresa.com'],
        subject: 'Reporte Mensual',
        body: 'Adjunto el reporte mensual.',
      });
      expect(sendResult.notificationId).toBe('notif-flow-002');
      expect(sendResult.sentTo).toEqual(['cfo@empresa.com']);

      // Act - 3: Get history
      const historyResult = await client.getHistory();
      expect(historyResult.notifications).toHaveLength(2);
      expect(historyResult.total).toBe(2);

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  // ────────────────────────────────────────────
  // Casos borde
  // ────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle network error (fetch rejects with non-AbortError)', async () => {
      mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const client = createClient();
      await expect(
        client.sendNotification({
          channel: 'email',
          to: ['cfo@empresa.com'],
          subject: 'Network fail',
          body: 'Test',
        }),
      ).rejects.toThrow('connect ECONNREFUSED');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle empty notification history gracefully', async () => {
      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ notifications: [], total: 0 }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.getHistory();

      expect(result.notifications).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should use custom base URL when provided', async () => {
      const customBaseUrl = 'http://custom-notifier:5000';
      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          notificationId: 'notif-custom',
          status: 'sent',
          sentTo: ['test@test.com'],
        }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient({ baseUrl: customBaseUrl });
      await client.sendNotification({
        to: ['test@test.com'],
        subject: 'Custom URL',
        body: 'Test',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${customBaseUrl}/notifications/send`,
        expect.any(Object),
      );
    });

    it('should include Authorization header with the configured API key', async () => {
      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          notificationId: 'notif-auth',
          status: 'sent',
          sentTo: ['auth@test.com'],
        }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient({ apiKey: 'custom-key-789' });
      await client.sendNotification({
        to: ['auth@test.com'],
        subject: 'Auth test',
        body: 'Test',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer custom-key-789',
          }),
        }),
      );
    });
  });
});
