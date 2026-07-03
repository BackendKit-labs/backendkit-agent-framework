import { ApiGatewayClient, ApiGatewayError, ApiGatewayServerError, ApiGatewayTimeoutError, ApiGatewayClientConfigSchema } from '../../src/api-gateway/client';

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockResponse(body: unknown, status: number, statusText?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText || '',
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    headers: new Headers({ 'content-type': 'application/json' }),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: jest.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: jest.fn(),
    blob: jest.fn(),
    formData: jest.fn(),
  } as unknown as Response;
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('ApiGatewayClient', () => {
  const baseUrl = 'https://api.example.com';
  const apiKey = 'test-api-key-123';
  const timeoutMs = 5000;

  let client: ApiGatewayClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ApiGatewayClient({ baseUrl, apiKey, timeoutMs });
  });

  // ── Constructor ──────────────────────────────

  describe('constructor', () => {
    it('debe crear una instancia con configuración válida', () => {
      expect(client).toBeInstanceOf(ApiGatewayClient);
    });

    it('debe eliminar el trailing slash de baseUrl', () => {
      const clientWithSlash = new ApiGatewayClient({
        baseUrl: 'https://api.example.com/',
        apiKey,
        timeoutMs,
      });
      // Accedemos a la URL mediante una petición GET para verificar
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 200));
      clientWithSlash.get('/test');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.any(Object)
      );
    });

    it('debe lanzar error si baseUrl no es una URL válida', () => {
      expect(() => {
        new ApiGatewayClient({ baseUrl: 'not-a-url', apiKey, timeoutMs });
      }).toThrow();
    });

    it('debe lanzar error si apiKey está vacía', () => {
      expect(() => {
        new ApiGatewayClient({ baseUrl, apiKey: '', timeoutMs });
      }).toThrow();
    });

    it('debe usar timeout por defecto de 10000ms si no se especifica', () => {
      const defaultClient = new ApiGatewayClient({ baseUrl, apiKey });
      // Verificamos que no lance error
      expect(defaultClient).toBeInstanceOf(ApiGatewayClient);
    });

    it('debe validar que timeoutMs sea positivo', () => {
      expect(() => {
        new ApiGatewayClient({ baseUrl, apiKey, timeoutMs: -1 });
      }).toThrow();
    });

    it('debe validar que timeoutMs sea un número', () => {
      expect(() => {
        new ApiGatewayClient({ baseUrl, apiKey, timeoutMs: NaN });
      }).toThrow();
    });
  });

  // ── GET ──────────────────────────────────────

  describe('GET', () => {
    const endpoint = '/api/v1/balance-sheet';
    const responseData = { totalAssets: 1000000, totalLiabilities: 500000 };

    it('debe realizar una solicitud GET exitosa', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(responseData, 200));

      const result = await client.get(endpoint);

      expect(result).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}${endpoint}`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          }),
        })
      );
    });

    it('debe incluir parámetros de consulta en la URL', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(responseData, 200));
      const params = { period: '2024-01', companyId: 'emp-001' };

      await client.get(endpoint, params);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}${endpoint}?period=2024-01&companyId=emp-001`,
        expect.any(Object)
      );
    });

    it('debe codificar correctamente parámetros con caracteres especiales', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(responseData, 200));
      const params = { name: 'Empresa & Cía', date: '2024-01-01' };

      await client.get(endpoint, params);

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain(encodeURIComponent('&'));
      expect(calledUrl).toContain(encodeURIComponent('í'));
    });

    it('debe funcionar sin parámetros de consulta', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(responseData, 200));

      await client.get(endpoint);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}${endpoint}`,
        expect.any(Object)
      );
    });

    it('debe lanzar ApiGatewayError para respuesta 4xx', async () => {
      const errorBody = { error: 'Bad Request', message: 'Parámetros inválidos' };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody, 400));
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody, 400));

      await expect(client.get(endpoint)).rejects.toThrow(ApiGatewayError);
      await expect(client.get(endpoint)).rejects.toThrow('HTTP 400');
    });

    it('debe incluir statusCode y responseBody en ApiGatewayError', async () => {
      const errorBody = { error: 'Not Found' };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody, 404));

      try {
        await client.get(endpoint);
        fail('Debió lanzar error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiGatewayError);
        expect((error as ApiGatewayError).statusCode).toBe(404);
        expect((error as ApiGatewayError).responseBody).toEqual(errorBody);
      }
    });

    it('debe lanzar ApiGatewayServerError para respuesta 5xx', async () => {
      const errorBody = { error: 'Internal Server Error' };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody, 500));
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody, 500));

      await expect(client.get(endpoint)).rejects.toThrow(ApiGatewayServerError);
      await expect(client.get(endpoint)).rejects.toThrow('HTTP 500');
    });

    it('debe incluir statusCode y responseBody en ApiGatewayServerError', async () => {
      const errorBody = { error: 'Service Unavailable' };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody, 503));

      try {
        await client.get(endpoint);
        fail('Debió lanzar error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiGatewayServerError);
        expect((error as ApiGatewayServerError).statusCode).toBe(503);
        expect((error as ApiGatewayServerError).responseBody).toEqual(errorBody);
      }
    });

    it('debe lanzar ApiGatewayTimeoutError si la solicitud excede el timeout', async () => {
      jest.useFakeTimers();
      const slowPromise = new Promise<Response>((resolve) => {
        setTimeout(() => resolve(createMockResponse({}, 200)), timeoutMs + 1000);
      });
      mockFetch.mockReturnValueOnce(slowPromise);

      const getPromise = client.get(endpoint);

      // Avanzar el tiempo hasta justo después del timeout
      jest.advanceTimersByTime(timeoutMs + 100);

      await expect(getPromise).rejects.toThrow(ApiGatewayTimeoutError);
      await expect(getPromise).rejects.toThrow(`timeout de ${timeoutMs}ms`);

      jest.useRealTimers();
    });

    it('debe lanzar ApiGatewayTimeoutError con el mensaje correcto', async () => {
      jest.useFakeTimers();
      const slowPromise = new Promise<Response>((resolve) => {
        setTimeout(() => resolve(createMockResponse({}, 200)), timeoutMs + 500);
      });
      mockFetch.mockReturnValueOnce(slowPromise);

      const getPromise = client.get(endpoint);

      jest.advanceTimersByTime(timeoutMs + 100);

      try {
        await getPromise;
        fail('Debió lanzar error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiGatewayTimeoutError);
        expect((error as ApiGatewayTimeoutError).message).toContain(`${timeoutMs}ms`);
      }

      jest.useRealTimers();
    });

    it('debe manejar errores de red (fetch lanza excepción)', async () => {
      const networkError = new Error('Network failure');
      mockFetch.mockRejectedValueOnce(networkError);

      await expect(client.get(endpoint)).rejects.toThrow('Network failure');
    });

    it('debe manejar respuesta con status 204 No Content', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(null, 204));

      const result = await client.get(endpoint);

      expect(result).toBeNull();
    });
  });

  // ── POST ─────────────────────────────────────

  describe('POST', () => {
    const endpoint = '/api/v1/reports/generate';
    const requestBody = { reportType: 'balance_sheet', period: '2024-01' };
    const responseData = { reportId: 'rpt-001', status: 'completed' };

    it('debe realizar una solicitud POST exitosa', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(responseData, 201));

      const result = await client.post(endpoint, requestBody);

      expect(result).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}${endpoint}`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          }),
          body: JSON.stringify(requestBody),
        })
      );
    });

    it('debe serializar correctamente el body a JSON', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(responseData, 201));

      await client.post(endpoint, requestBody);

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.body).toBe(JSON.stringify(requestBody));
    });

    it('debe lanzar ApiGatewayError para respuesta 4xx en POST', async () => {
      const errorBody = { error: 'Validation Error', details: ['Campo requerido: name'] };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody, 422));
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody, 422));

      await expect(client.post(endpoint, requestBody)).rejects.toThrow(ApiGatewayError);
      await expect(client.post(endpoint, requestBody)).rejects.toThrow('HTTP 422');
    });

    it('debe lanzar ApiGatewayServerError para respuesta 5xx en POST', async () => {
      const errorBody = { error: 'Internal Server Error' };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody, 502));
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody, 502));

      await expect(client.post(endpoint, requestBody)).rejects.toThrow(ApiGatewayServerError);
      await expect(client.post(endpoint, requestBody)).rejects.toThrow('HTTP 502');
    });

    it('debe lanzar ApiGatewayTimeoutError si POST excede el timeout', async () => {
      jest.useFakeTimers();
      const slowPromise = new Promise<Response>((resolve) => {
        setTimeout(() => resolve(createMockResponse({}, 201)), timeoutMs + 1000);
      });
      mockFetch.mockReturnValueOnce(slowPromise);

      const postPromise = client.post(endpoint, requestBody);

      jest.advanceTimersByTime(timeoutMs + 100);

      await expect(postPromise).rejects.toThrow(ApiGatewayTimeoutError);

      jest.useRealTimers();
    });

    it('debe manejar body vacío (null)', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(responseData, 201));

      const result = await client.post(endpoint, null);

      expect(result).toEqual(responseData);
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.body).toBe(JSON.stringify(null));
    });

    it('debe manejar body con objeto vacío', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(responseData, 201));

      const result = await client.post(endpoint, {});

      expect(result).toEqual(responseData);
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.body).toBe(JSON.stringify({}));
    });

    it('debe manejar respuesta con status 200 en POST', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(responseData, 200));

      const result = await client.post(endpoint, requestBody);

      expect(result).toEqual(responseData);
    });
  });

  // ── Headers ──────────────────────────────────

  describe('Headers', () => {
    it('debe incluir Content-Type application/json en todas las solicitudes', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 200));

      await client.get('/test');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('debe incluir Authorization Bearer con apiKey en todas las solicitudes', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 200));

      await client.get('/test');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe(`Bearer ${apiKey}`);
    });

    it('debe incluir los headers correctos en POST', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 201));

      await client.post('/test', { data: 'test' });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe(`Bearer ${apiKey}`);
    });
  });

  // ── Timeout ──────────────────────────────────

  describe('Timeout', () => {
    it('debe usar el timeoutMs configurado en el constructor', async () => {
      const customTimeout = 3000;
      const customClient = new ApiGatewayClient({ baseUrl, apiKey, timeoutMs: customTimeout });

      jest.useFakeTimers();
      const slowPromise = new Promise<Response>((resolve) => {
        setTimeout(() => resolve(createMockResponse({}, 200)), customTimeout + 500);
      });
      mockFetch.mockReturnValueOnce(slowPromise);

      const getPromise = customClient.get('/test');

      jest.advanceTimersByTime(customTimeout + 100);

      await expect(getPromise).rejects.toThrow(ApiGatewayTimeoutError);
      await expect(getPromise).rejects.toThrow(`${customTimeout}ms`);

      jest.useRealTimers();
    });

    it('debe usar timeout por defecto de 10000ms si no se especifica', async () => {
      const defaultClient = new ApiGatewayClient({ baseUrl, apiKey });
      const defaultTimeout = 10000;

      jest.useFakeTimers();
      const slowPromise = new Promise<Response>((resolve) => {
        setTimeout(() => resolve(createMockResponse({}, 200)), defaultTimeout + 500);
      });
      mockFetch.mockReturnValueOnce(slowPromise);

      const getPromise = defaultClient.get('/test');

      jest.advanceTimersByTime(defaultTimeout + 100);

      await expect(getPromise).rejects.toThrow(ApiGatewayTimeoutError);

      jest.useRealTimers();
    });

    it('debe resolver correctamente si la respuesta llega antes del timeout', async () => {
      jest.useFakeTimers();
      const fastPromise = new Promise<Response>((resolve) => {
        setTimeout(() => resolve(createMockResponse({ data: 'success' }, 200)), 100);
      });
      mockFetch.mockReturnValueOnce(fastPromise);

      const getPromise = client.get('/test');

      jest.advanceTimersByTime(100);

      const result = await getPromise;
      expect(result).toEqual({ data: 'success' });

      jest.useRealTimers();
    });
  });

  // ── Manejo de errores HTTP ───────────────────

  describe('Manejo de errores HTTP', () => {
    it('debe lanzar ApiGatewayError para status 400', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Bad Request' }, 400));
      await expect(client.get('/test')).rejects.toThrow(ApiGatewayError);
    });

    it('debe lanzar ApiGatewayError para status 401', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Unauthorized' }, 401));
      await expect(client.get('/test')).rejects.toThrow(ApiGatewayError);
    });

    it('debe lanzar ApiGatewayError para status 403', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Forbidden' }, 403));
      await expect(client.get('/test')).rejects.toThrow(ApiGatewayError);
    });

    it('debe lanzar ApiGatewayError para status 404', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Not Found' }, 404));
      await expect(client.get('/test')).rejects.toThrow(ApiGatewayError);
    });

    it('debe lanzar ApiGatewayError para status 409', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Conflict' }, 409));
      await expect(client.get('/test')).rejects.toThrow(ApiGatewayError);
    });

    it('debe lanzar ApiGatewayError para status 422', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Unprocessable Entity' }, 422));
      await expect(client.get('/test')).rejects.toThrow(ApiGatewayError);
    });

    it('debe lanzar ApiGatewayServerError para status 500', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Internal Server Error' }, 500));
      await expect(client.get('/test')).rejects.toThrow(ApiGatewayServerError);
    });

    it('debe lanzar ApiGatewayServerError para status 502', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Bad Gateway' }, 502));
      await expect(client.get('/test')).rejects.toThrow(ApiGatewayServerError);
    });

    it('debe lanzar ApiGatewayServerError para status 503', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Service Unavailable' }, 503));
      await expect(client.get('/test')).rejects.toThrow(ApiGatewayServerError);
    });

    it('debe lanzar ApiGatewayServerError para status 504', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ error: 'Gateway Timeout' }, 504));
      await expect(client.get('/test')).rejects.toThrow(ApiGatewayServerError);
    });

    it('debe manejar respuesta sin body en error', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(null, 500));

      try {
        await client.get('/test');
        fail('Debió lanzar error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiGatewayServerError);
        expect((error as ApiGatewayServerError).responseBody).toBeNull();
      }
    });

    it('debe incluir el mensaje de error HTTP en el mensaje de la excepción', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ message: 'Not Found' }, 404));

      try {
        await client.get('/test');
        fail('Debió lanzar error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiGatewayError);
        expect((error as ApiGatewayError).message).toContain('404');
      }
    });
  });

  // ── Tipos genéricos ──────────────────────────

  describe('Tipado genérico', () => {
    it('debe permitir tipar la respuesta con un tipo específico', async () => {
      interface BalanceSheet {
        totalAssets: number;
        totalLiabilities: number;
        equity: number;
      }

      const mockData: BalanceSheet = {
        totalAssets: 1000000,
        totalLiabilities: 500000,
        equity: 500000,
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData, 200));

      const result = await client.get<BalanceSheet>('/api/v1/balance-sheet');

      expect(result.totalAssets).toBe(1000000);
      expect(result.totalLiabilities).toBe(500000);
      expect(result.equity).toBe(500000);
    });

    it('debe permitir tipar la respuesta de POST con un tipo específico', async () => {
      interface ReportResponse {
        reportId: string;
        status: string;
        url?: string;
      }

      const mockData: ReportResponse = {
        reportId: 'rpt-001',
        status: 'completed',
        url: 'https://api.example.com/reports/rpt-001.pdf',
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData, 201));

      const result = await client.post<ReportResponse>('/api/v1/reports', { type: 'pdf' });

      expect(result.reportId).toBe('rpt-001');
      expect(result.status).toBe('completed');
      expect(result.url).toBeDefined();
    });
  });

  // ── Edge cases ───────────────────────────────

  describe('Edge cases', () => {
    it('debe manejar endpoint con slash inicial', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 200));

      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.any(Object)
      );
    });

    it('debe manejar endpoint sin slash inicial', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 200));

      await client.get('test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.any(Object)
      );
    });

    it('debe manejar endpoint con múltiples slashes', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 200));

      await client.get('/api/v1//test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1//test',
        expect.any(Object)
      );
    });

    it('debe manejar parámetros con valores undefined (omitirlos)', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 200));

      await client.get('/test', { a: '1', b: undefined as unknown as string });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('a=1');
      expect(calledUrl).not.toContain('b=');
    });

    it('debe manejar parámetros con valores null (convertirlos a string)', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 200));

      await client.get('/test', { value: null as unknown as string });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('value=null');
    });

    it('debe manejar respuesta con status 201 Created', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ id: 'new-001' }, 201));

      const result = await client.post('/api/v1/items', { name: 'test' });

      expect(result).toEqual({ id: 'new-001' });
    });

    it('debe manejar respuesta con array', async () => {
      const items = [{ id: 1 }, { id: 2 }];
      mockFetch.mockResolvedValueOnce(createMockResponse(items, 200));

      const result = await client.get('/api/v1/items');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });
  });
});