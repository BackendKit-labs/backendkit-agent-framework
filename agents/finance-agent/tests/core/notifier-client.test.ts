import { NotifierClient, NotifierClientConfigSchema, NotifierClientError, NotifierClientServerError, NotifierClientTimeoutError, SendNotificationInputSchema, NotifyUserInputSchema, GetHistoryInputSchema } from '../../src/core/notifier-client';

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockResponse(overrides: Partial<Response> = {}): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: jest.fn(),
    text: jest.fn(),
    ...overrides,
  } as unknown as Response;
}

function createClient(config?: Partial<{ baseUrl: string; apiKey: string; timeoutMs: number; logLevel: string }>) {
  return new NotifierClient({
    baseUrl: config?.baseUrl || 'http://notifier-agent:3002',
    apiKey: config?.apiKey || 'test-api-key',
    timeoutMs: config?.timeoutMs || 10000,
    logLevel: (config?.logLevel as 'debug' | 'info' | 'warn' | 'error') || 'info',
  });
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('NotifierClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('debe crear una instancia con configuración válida', () => {
      const client = createClient();
      expect(client).toBeInstanceOf(NotifierClient);
    });

    it('debe lanzar error si baseUrl no es una URL válida', () => {
      expect(() => {
        new NotifierClient({ baseUrl: 'invalid-url', apiKey: 'key' });
      }).toThrow();
    });

    it('debe lanzar error si apiKey está vacía', () => {
      expect(() => {
        new NotifierClient({ baseUrl: 'http://localhost:3002', apiKey: '' });
      }).toThrow();
    });

    it('debe usar valores por defecto para timeoutMs y logLevel', () => {
      const client = new NotifierClient({ baseUrl: 'http://localhost:3002', apiKey: 'key' });
      expect(client).toBeInstanceOf(NotifierClient);
    });
  });

  describe('sendNotification', () => {
    it('debe enviar una notificación exitosamente', async () => {
      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          notificationId: 'notif-123',
          status: 'sent',
          timestamp: '2026-07-02T12:00:00Z',
          channel: 'email',
        }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.sendNotification({
        channel: 'email',
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Test body',
        priority: 'normal',
      });

      expect(result.notificationId).toBe('notif-123');
      expect(result.status).toBe('sent');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://notifier-agent:3002/notifications/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('debe lanzar NotifierClientError en respuesta 4xx', async () => {
      const mockResponse = createMockResponse({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: jest.fn().mockResolvedValue({ error: 'Invalid channel' }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      await expect(client.sendNotification({
        channel: 'email',
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Test body',
      })).rejects.toThrow(NotifierClientError);
    });

    it('debe lanzar NotifierClientServerError en respuesta 5xx', async () => {
      const mockResponse = createMockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: jest.fn().mockResolvedValue({ error: 'Server error' }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      await expect(client.sendNotification({
        channel: 'email',
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Test body',
      })).rejects.toThrow(NotifierClientServerError);
    });

    it('debe lanzar NotifierClientTimeoutError en timeout', async () => {
      jest.useFakeTimers();
      mockFetch.mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 500);
      }));

      const client = createClient({ timeoutMs: 100 });
      const promise = client.sendNotification({
        channel: 'email',
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Test body',
      });

      jest.advanceTimersByTime(150);
      await expect(promise).rejects.toThrow(NotifierClientTimeoutError);
      jest.useRealTimers();
    });

    it('debe validar el input con Zod', async () => {
      const client = createClient();
      await expect(client.sendNotification({
        channel: 'invalid-channel' as any,
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Test body',
      })).rejects.toThrow();
    });
  });

  describe('notifyUser', () => {
    it('debe notificar a un usuario exitosamente', async () => {
      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          notificationId: 'notif-456',
          status: 'sent',
          timestamp: '2026-07-02T12:00:00Z',
          userId: 'user-123',
        }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.notifyUser({
        userId: 'user-123',
        title: 'Reporte listo',
        message: 'El reporte mensual ya está disponible.',
        type: 'success',
      });

      expect(result.notificationId).toBe('notif-456');
      expect(result.status).toBe('sent');
      expect(result.userId).toBe('user-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://notifier-agent:3002/notifications/user',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('debe validar el input con Zod', async () => {
      const client = createClient();
      await expect(client.notifyUser({
        userId: '',
        title: 'Test',
        message: 'Test',
      })).rejects.toThrow();
    });
  });

  describe('getHistory', () => {
    it('debe obtener el historial sin filtros', async () => {
      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          notifications: [
            {
              notificationId: 'notif-1',
              channel: 'email',
              recipient: 'test@example.com',
              subject: 'Test',
              body: 'Body',
              priority: 'normal',
              status: 'sent',
              timestamp: '2026-07-02T12:00:00Z',
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.getHistory();

      expect(result.notifications).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://notifier-agent:3002/notifications/history',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('debe obtener el historial con filtros', async () => {
      const mockResponse = createMockResponse({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          notifications: [],
          total: 0,
          limit: 10,
          offset: 0,
        }),
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.getHistory({
        userId: 'user-123',
        channel: 'email',
        limit: 10,
        offset: 0,
      });

      expect(result.notifications).toHaveLength(0);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('userId=user-123'),
        expect.anything(),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('channel=email'),
        expect.anything(),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.anything(),
      );
    });

    it('debe validar el input con Zod', async () => {
      const client = createClient();
      await expect(client.getHistory({
        limit: -1,
      } as any)).rejects.toThrow();
    });
  });

  describe('NotifierClientConfigSchema', () => {
    it('debe validar una configuración correcta', () => {
      const result = NotifierClientConfigSchema.parse({
        baseUrl: 'http://localhost:3002',
        apiKey: 'test-key',
      });
      expect(result.baseUrl).toBe('http://localhost:3002');
      expect(result.apiKey).toBe('test-key');
      expect(result.timeoutMs).toBe(10000);
      expect(result.logLevel).toBe('info');
    });

    it('debe rechazar una URL inválida', () => {
      expect(() => {
        NotifierClientConfigSchema.parse({ baseUrl: 'not-a-url', apiKey: 'key' });
      }).toThrow();
    });
  });
});