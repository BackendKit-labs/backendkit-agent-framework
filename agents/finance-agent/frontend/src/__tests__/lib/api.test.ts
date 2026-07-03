// ─────────────────────────────────────────────────────────────────────────
// Finance Agent — API Client Tests
// Tests for the frontend fetch wrapper in src/lib/api.ts
// ─────────────────────────────────────────────────────────────────────────

import {
  getHealth,
  postQuery,
  getConfig,
  updateConfig,
  postReport,
  listReports,
  unwrap,
  type ApiResult,
  type ApiError,
  type HealthStatus,
} from "@/lib/api";

import type {
  ApiResponse,
  CompanyConfig,
  QueryRequest,
  QueryResponse,
  ReportRequest,
  ReportResult,
} from "@/lib/types";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Mocks
// ═════════════════════════════════════════════════════════════════════════

const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
global.fetch = mockFetch;

// ═════════════════════════════════════════════════════════════════════════
// 2.  Helpers
// ═════════════════════════════════════════════════════════════════════════

function createMockResponse<T>(body: T, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : 'Error',
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

function createAbortError(): DOMException {
  const error = new DOMException('The operation was aborted', 'AbortError');
  return error;
}

/** Sample health response */
const sampleHealth: HealthStatus = {
  status: 'ok',
  uptime: 12345,
  version: '1.0.0',
  timestamp: '2025-01-15T10:00:00Z',
};

/** Sample company config */
const sampleConfig: CompanyConfig = {
  company: {
    name: 'Test Corp',
    country: 'CO',
    currency: 'COP',
    timezone: 'America/Bogota',
  },
  vault: { path: './vault' },
  apiGateway: {
    baseUrl: 'http://localhost:3001',
    apiKey: 'test-key',
    timeoutMs: 10000,
  },
  model: {
    provider: 'openai',
    modelName: 'gpt-4',
    apiKey: 'sk-test',
    temperature: 0.3,
    maxTokens: 2000,
  },
};

/** Sample query response */
const sampleQueryResponse: QueryResponse = {
  tool: 'income-statement',
  result: { revenue: 1000000 },
  explanation: 'Ingresos del periodo',
  executionTimeMs: 150,
};

/** Sample report result */
const sampleReportResult: ReportResult = {
  title: 'Reporte Mensual',
  period: '2025-01',
  generatedAt: '2025-01-15T10:00:00Z',
  collectedData: [],
  markdown: '# Reporte',
  exports: {},
  totalExecutionTimeMs: 500,
  success: true,
};

/** Wraps data in the ApiResponse envelope */
function apiEnvelope<T>(data: T): ApiResponse<T> {
  return {
    data,
    success: true,
    timestamp: '2025-01-15T10:00:00Z',
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 3.  Tests
// ═════════════════════════════════════════════════════════════════════════

describe('API Client — src/lib/api.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 3.1  getHealth ────────────────────────────

  describe('getHealth', () => {
    it('debe retornar HealthStatus en una respuesta exitosa', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(sampleHealth, 200));

      const result = await getHealth();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(sampleHealth);
        expect(result.data.status).toBe('ok');
        expect(result.data.version).toBe('1.0.0');
      }
    });

    it('debe hacer GET a /health', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(sampleHealth, 200));

      await getHealth();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/health');
      expect(options?.method).toBe('GET');
    });

    it('debe retornar error para respuesta 5xx', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: 'Internal Server Error' }, 500),
      );

      const result = await getHealth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
        // The error message is extracted from the body's "error" field
        expect(result.error.message).toBe('Internal Server Error');
      }
    });

    it('debe retornar error con status 0 cuando fetch lanza excepción', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const result = await getHealth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
        expect(result.error.message).toBe('Network failure');
      }
    });

    it('debe retornar error de timeout cuando fetch es abortado', async () => {
      mockFetch.mockRejectedValueOnce(createAbortError());

      const result = await getHealth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
        expect(result.error.message).toContain('timed out');
      }
    });

    it('debe retornar error para respuesta 4xx', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: 'Not Found' }, 404),
      );

      const result = await getHealth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(404);
      }
    });
  });

  // ── 3.2  postQuery ───────────────────────────

  describe('postQuery', () => {
    const queryBody: QueryRequest = {
      query: '¿Cuál fue el ingreso del mes?',
      period: '2025-01',
    };

    it('debe retornar QueryResponse envuelto en ApiResponse', async () => {
      const envelope = apiEnvelope(sampleQueryResponse);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      const result = await postQuery(queryBody);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data.tool).toBe('income-statement');
        expect(result.data.data.executionTimeMs).toBe(150);
      }
    });

    it('debe hacer POST a /api/query con body JSON', async () => {
      const envelope = apiEnvelope(sampleQueryResponse);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      await postQuery(queryBody);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/query');
      expect(options?.method).toBe('POST');
      expect(options?.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/json' }),
      );
      expect(options?.body).toBe(JSON.stringify(queryBody));
    });

    it('debe incluir tool opcional en el body', async () => {
      const fullBody: QueryRequest = {
        query: 'Ventas por región',
        period: '2025-Q1',
        tool: 'revenue-breakdown',
      };
      const envelope = apiEnvelope(sampleQueryResponse);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      await postQuery(fullBody);

      const bodySent = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(bodySent.tool).toBe('revenue-breakdown');
    });

    it('debe retornar error para respuesta 4xx', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: 'Bad Request' }, 400),
      );

      const result = await postQuery(queryBody);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(400);
      }
    });

    it('debe retornar error de timeout', async () => {
      mockFetch.mockRejectedValueOnce(createAbortError());

      const result = await postQuery(queryBody);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('timed out');
      }
    });

    it('debe retornar error cuando fetch lanza excepción', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await postQuery(queryBody);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
        expect(result.error.message).toBe('Connection refused');
      }
    });
  });

  // ── 3.3  getConfig ───────────────────────────

  describe('getConfig', () => {
    it('debe retornar CompanyConfig envuelto en ApiResponse', async () => {
      const envelope = apiEnvelope(sampleConfig);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      const result = await getConfig();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data.company.name).toBe('Test Corp');
        expect(result.data.data.company.currency).toBe('COP');
      }
    });

    it('debe hacer GET a /api/config', async () => {
      const envelope = apiEnvelope(sampleConfig);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      await getConfig();

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/config');
      expect(options?.method).toBe('GET');
    });

    it('debe retornar error para respuesta 5xx', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: 'Service Unavailable' }, 503),
      );

      const result = await getConfig();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(503);
      }
    });

    it('debe retornar error de red', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await getConfig();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
      }
    });
  });

  // ── 3.4  updateConfig ────────────────────────

  describe('updateConfig', () => {
    const partialUpdate = { company: { name: 'Updated Corp' } as CompanyConfig['company'] };

    it('debe retornar la config actualizada', async () => {
      const updatedConfig: CompanyConfig = {
        ...sampleConfig,
        company: { ...sampleConfig.company, name: 'Updated Corp' },
      };
      const envelope = apiEnvelope(updatedConfig);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      const result = await updateConfig(partialUpdate);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data.company.name).toBe('Updated Corp');
      }
    });

    it('debe hacer PUT a /api/config con body JSON', async () => {
      const envelope = apiEnvelope(sampleConfig);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      await updateConfig(partialUpdate);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/config');
      expect(options?.method).toBe('PUT');
      expect(options?.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/json' }),
      );
      expect(options?.body).toBe(JSON.stringify(partialUpdate));
    });

    it('debe retornar error para respuesta 4xx', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: 'Validation Error' }, 422),
      );

      const result = await updateConfig(partialUpdate);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(422);
      }
    });

    it('debe retornar error de timeout', async () => {
      mockFetch.mockRejectedValueOnce(createAbortError());

      const result = await updateConfig(partialUpdate);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('timed out');
      }
    });
  });

  // ── 3.5  postReport ──────────────────────────

  describe('postReport', () => {
    const reportRequest: ReportRequest = {
      template: 'balance',
      period: '2025-01',
      formats: ['markdown'],
    };

    it('debe retornar ReportResult envuelto en ApiResponse', async () => {
      const envelope = apiEnvelope(sampleReportResult);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      const result = await postReport(reportRequest);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data.title).toBe('Reporte Mensual');
        expect(result.data.data.success).toBe(true);
      }
    });

    it('debe hacer POST a /api/reports con body JSON', async () => {
      const envelope = apiEnvelope(sampleReportResult);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      await postReport(reportRequest);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/reports');
      expect(options?.method).toBe('POST');
      expect(options?.body).toBe(JSON.stringify(reportRequest));
    });

    it('debe incluir campos opcionales en el body', async () => {
      const fullRequest: ReportRequest = {
        template: 'income-statement',
        period: '2025-Q1',
        formats: ['pdf', 'xlsx'],
        extraToolNames: ['tax-summary'],
        title: 'Reporte Trimestral',
        subtitle: 'Q1 2025',
      };
      const envelope = apiEnvelope(sampleReportResult);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      await postReport(fullRequest);

      const bodySent = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(bodySent.extraToolNames).toEqual(['tax-summary']);
      expect(bodySent.title).toBe('Reporte Trimestral');
    });

    it('debe retornar error para respuesta 5xx', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: 'Internal Error' }, 500),
      );

      const result = await postReport(reportRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
      }
    });

    it('debe retornar error de red', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

      const result = await postReport(reportRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(0);
      }
    });
  });

  // ── 3.6  listReports ─────────────────────────

  describe('listReports', () => {
    const reportsList: ReportResult[] = [
      sampleReportResult,
      { ...sampleReportResult, title: 'Reporte Semanal', period: '2025-W03' },
    ];

    it('debe retornar lista de ReportResult envuelta en ApiResponse', async () => {
      const envelope = apiEnvelope(reportsList);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      const result = await listReports();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.data).toHaveLength(2);
        expect(result.data.data[0].title).toBe('Reporte Mensual');
      }
    });

    it('debe hacer GET a /api/reports', async () => {
      const envelope = apiEnvelope(reportsList);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      await listReports();

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/reports');
      expect(options?.method).toBe('GET');
    });

    it('debe incluir query params cuando se pasan filtros', async () => {
      const envelope = apiEnvelope(reportsList);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      await listReports({ status: 'completed', limit: 10, offset: 0 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('status=completed');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=0');
    });

    it('debe omitir params undefined', async () => {
      const envelope = apiEnvelope(reportsList);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      await listReports({ status: 'pending' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('status=pending');
      expect(url).not.toContain('limit');
      expect(url).not.toContain('offset');
    });

    it('debe funcionar sin parámetros', async () => {
      const envelope = apiEnvelope(reportsList);
      mockFetch.mockResolvedValueOnce(createMockResponse(envelope, 200));

      const result = await listReports();

      expect(result.ok).toBe(true);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain('?');
    });

    it('debe retornar error para respuesta 4xx', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: 'Forbidden' }, 403),
      );

      const result = await listReports();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(403);
      }
    });

    it('debe retornar error de timeout', async () => {
      mockFetch.mockRejectedValueOnce(createAbortError());

      const result = await listReports();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('timed out');
      }
    });
  });

  // ── 3.7  unwrap ──────────────────────────────

  describe('unwrap', () => {
    it('debe retornar { data } cuando result.ok es true', () => {
      const result: ApiResult<string> = { ok: true, data: 'hello' };
      const { data } = unwrap(result);
      expect(data).toBe('hello');
    });

    it('debe lanzar Error cuando result.ok es false', () => {
      const error: ApiError = { message: 'Something went wrong', status: 500 };
      const result: ApiResult<string> = { ok: false, error };

      expect(() => unwrap(result)).toThrow('Something went wrong');
    });

    it('debe lanzar con el mensaje exacto del error', () => {
      const error: ApiError = { message: 'Not Found', status: 404 };
      const result: ApiResult<string> = { ok: false, error };

      expect(() => unwrap(result)).toThrow('Not Found');
    });

    it('debe preservar el tipo genérico en el retorno exitoso', () => {
      const data: HealthStatus = {
        status: 'ok',
        uptime: 100,
        version: '1.0',
        timestamp: '2025-01-01T00:00:00Z',
      };
      const result: ApiResult<HealthStatus> = { ok: true, data };
      const unwrapped = unwrap(result);
      expect(unwrapped.data.status).toBe('ok');
      expect(unwrapped.data.uptime).toBe(100);
    });
  });

  // ── 3.8  Error handling — edge cases ─────────

  describe('Error handling edge cases', () => {
    it('debe manejar respuesta con JSON inválido', async () => {
      const response = createMockResponse('not-json', 200);
      response.json = jest.fn().mockRejectedValue(new Error('Unexpected token'));
      mockFetch.mockResolvedValueOnce(response);

      const result = await getHealth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to parse JSON');
      }
    });

    it('debe extraer mensaje de error del body cuando tiene campo "error"', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: 'Custom error message' }, 400),
      );

      const result = await getHealth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Custom error message');
      }
    });

    it('debe usar mensaje genérico cuando el body de error no tiene campo "error"', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ detail: 'Some detail' }, 400),
      );

      const result = await getHealth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Request failed with status 400');
      }
    });

    it('debe manejar error HTTP sin body JSON (text fallback)', async () => {
      const response = createMockResponse(null, 500);
      response.json = jest.fn().mockRejectedValue(new Error('parse error'));
      response.text = jest.fn().mockResolvedValue('Internal Server Error');
      mockFetch.mockResolvedValueOnce(response);

      const result = await getHealth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(500);
      }
    });

    it('debe manejar error HTTP donde text() también falla', async () => {
      const response = createMockResponse(null, 502);
      response.json = jest.fn().mockRejectedValue(new Error('parse error'));
      response.text = jest.fn().mockRejectedValue(new Error('text error'));
      mockFetch.mockResolvedValueOnce(response);

      const result = await getHealth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.status).toBe(502);
        expect(result.error.message).toContain('502');
      }
    });
  });
});
