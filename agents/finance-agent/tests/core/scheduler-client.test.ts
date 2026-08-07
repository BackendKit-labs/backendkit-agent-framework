import { SchedulerClient, SchedulerClientError, SchedulerClientServerError, SchedulerClientTimeoutError, SchedulerClientConfigSchema } from '../../src/core/scheduler-client';

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockResponse(data: unknown, status = 200, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

function createClient(config?: Partial<{ baseUrl: string; apiKey: string; timeoutMs: number }>) {
  return new SchedulerClient({
    baseUrl: config?.baseUrl ?? 'http://scheduler-agent:3001',
    apiKey: config?.apiKey ?? 'test-api-key',
    timeoutMs: config?.timeoutMs ?? 10000,
  });
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('SchedulerClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('debe crear una instancia con configuración válida', () => {
      const client = createClient();
      expect(client).toBeInstanceOf(SchedulerClient);
    });

    it('debe lanzar error si baseUrl no es una URL válida', () => {
      expect(() => new SchedulerClient({ baseUrl: 'invalida', apiKey: 'key' })).toThrow();
    });

    it('debe lanzar error si apiKey está vacía', () => {
      expect(() => new SchedulerClient({ baseUrl: 'http://localhost:3001', apiKey: '' })).toThrow();
    });

    it('debe eliminar trailing slash de baseUrl', () => {
      const client = new SchedulerClient({ baseUrl: 'http://localhost:3001/', apiKey: 'key' });
      expect((client as any).baseUrl).toBe('http://localhost:3001');
    });

    it('debe usar timeoutMs por defecto si no se proporciona', () => {
      const client = new SchedulerClient({ baseUrl: 'http://localhost:3001', apiKey: 'key' });
      expect((client as any).timeoutMs).toBe(10000);
    });
  });

  describe('scheduleTask', () => {
    it('debe programar una tarea exitosamente', async () => {
      const mockResponse = createMockResponse({ taskId: '123', status: 'scheduled' });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.scheduleTask({
        taskName: 'monthly-report',
        schedule: '0 0 1 * *',
        action: 'generate_report',
      });

      expect(result).toEqual({ taskId: '123', status: 'scheduled' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://scheduler-agent:3001/tasks',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key',
          }),
          body: JSON.stringify({
            taskName: 'monthly-report',
            schedule: '0 0 1 * *',
            action: 'generate_report',
          }),
        })
      );
    });

    it('debe lanzar SchedulerClientError si el scheduler responde con 4xx', async () => {
      const mockResponse = createMockResponse({ error: 'Bad Request' }, 400, 'Bad Request');
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      await expect(
        client.scheduleTask({ taskName: 'test', schedule: '* * * * *', action: 'test' })
      ).rejects.toThrow(SchedulerClientError);
    });

    it('debe lanzar SchedulerClientServerError si el scheduler responde con 5xx', async () => {
      const mockResponse = createMockResponse({ error: 'Internal Server Error' }, 500, 'Internal Server Error');
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      await expect(
        client.scheduleTask({ taskName: 'test', schedule: '* * * * *', action: 'test' })
      ).rejects.toThrow(SchedulerClientServerError);
    });

    it('debe lanzar SchedulerClientTimeoutError si la solicitud excede el timeout', async () => {
      jest.useFakeTimers();
      mockFetch.mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 500);
      }));

      const client = createClient({ timeoutMs: 100 });
      const promise = client.scheduleTask({ taskName: 'test', schedule: '* * * * *', action: 'test' });

      jest.advanceTimersByTime(150);
      await expect(promise).rejects.toThrow(SchedulerClientTimeoutError);
      jest.useRealTimers();
    });
  });

  describe('listTasks', () => {
    it('debe listar tareas sin filtros', async () => {
      const mockResponse = createMockResponse({
        tasks: [{ taskId: '1', taskName: 'test', schedule: '* * * * *', status: 'active' }],
        total: 1,
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.listTasks();

      expect(result.total).toBe(1);
      expect(result.tasks).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://scheduler-agent:3001/tasks',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('debe listar tareas con filtros', async () => {
      const mockResponse = createMockResponse({ tasks: [], total: 0 });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      await client.listTasks({ status: 'active', limit: 10, offset: 0 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=active'),
        expect.any(Object)
      );
    });
  });

  describe('cancelTask', () => {
    it('debe cancelar una tarea exitosamente', async () => {
      const mockResponse = createMockResponse({ taskId: '123', status: 'cancelled' });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.cancelTask({ taskId: '123' });

      expect(result).toEqual({ taskId: '123', status: 'cancelled' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://scheduler-agent:3001/tasks/123',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('reschedule', () => {
    it('debe reprogramar una tarea exitosamente', async () => {
      const mockResponse = createMockResponse({ taskId: '123', status: 'rescheduled', nextRun: '2026-07-03T00:00:00Z' });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.reschedule({ taskId: '123', schedule: '0 0 2 * *' });

      expect(result).toEqual({ taskId: '123', status: 'rescheduled', nextRun: '2026-07-03T00:00:00Z' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://scheduler-agent:3001/tasks/123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ schedule: '0 0 2 * *' }),
        })
      );
    });

    it('debe reprogramar con payload opcional', async () => {
      const mockResponse = createMockResponse({ taskId: '123', status: 'rescheduled' });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      await client.reschedule({ taskId: '123', schedule: '0 0 2 * *', payload: { channel: 'email' } });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ schedule: '0 0 2 * *', payload: { channel: 'email' } }),
        })
      );
    });
  });

  describe('getTaskStatus', () => {
    it('debe obtener el estado de una tarea exitosamente', async () => {
      const mockResponse = createMockResponse({
        taskId: '123',
        taskName: 'monthly-report',
        schedule: '0 0 1 * *',
        status: 'active',
        lastRun: '2026-06-01T00:00:00Z',
        nextRun: '2026-07-01T00:00:00Z',
      });
      mockFetch.mockResolvedValue(mockResponse);

      const client = createClient();
      const result = await client.getTaskStatus({ taskId: '123' });

      expect(result).toEqual({
        taskId: '123',
        taskName: 'monthly-report',
        schedule: '0 0 1 * *',
        status: 'active',
        lastRun: '2026-06-01T00:00:00Z',
        nextRun: '2026-07-01T00:00:00Z',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://scheduler-agent:3001/tasks/123',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('SchedulerClientConfigSchema', () => {
    it('debe validar una configuración correcta', () => {
      const result = SchedulerClientConfigSchema.parse({
        baseUrl: 'http://localhost:3001',
        apiKey: 'key-123',
      });
      expect(result.baseUrl).toBe('http://localhost:3001');
      expect(result.apiKey).toBe('key-123');
      expect(result.timeoutMs).toBe(10000);
    });

    it('debe rechazar baseUrl inválida', () => {
      expect(() =>
        SchedulerClientConfigSchema.parse({ baseUrl: 'not-a-url', apiKey: 'key' })
      ).toThrow();
    });

    it('debe rechazar apiKey vacía', () => {
      expect(() =>
        SchedulerClientConfigSchema.parse({ baseUrl: 'http://localhost:3001', apiKey: '' })
      ).toThrow();
    });
  });
});