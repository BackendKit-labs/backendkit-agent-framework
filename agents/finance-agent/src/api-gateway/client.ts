import { z } from 'zod';

// ──────────────────────────────────────────────
// Schemas Zod
// ──────────────────────────────────────────────

/**
 * Schema para la configuración del cliente de la API Gateway.
 */
export const ApiGatewayClientConfigSchema = z.object({
  baseUrl: z.string().url('baseUrl debe ser una URL válida'),
  apiKey: z.string().min(1, 'apiKey es requerida'),
  timeoutMs: z.number().positive().default(10000),
});

export type ApiGatewayClientConfig = z.infer<typeof ApiGatewayClientConfigSchema>;

// ──────────────────────────────────────────────
// Errores personalizados
// ──────────────────────────────────────────────

/**
 * Error lanzado cuando la API Gateway responde con un código HTTP 4xx.
 */
export class ApiGatewayError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: unknown;

  constructor(statusCode: number, message: string, responseBody?: unknown) {
    super(message);
    this.name = 'ApiGatewayError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/**
 * Error lanzado cuando la API Gateway responde con un código HTTP 5xx.
 */
export class ApiGatewayServerError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: unknown;

  constructor(statusCode: number, message: string, responseBody?: unknown) {
    super(message);
    this.name = 'ApiGatewayServerError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/**
 * Error lanzado cuando la solicitud excede el timeout configurado.
 */
export class ApiGatewayTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`La solicitud excedió el timeout de ${timeoutMs}ms`);
    this.name = 'ApiGatewayTimeoutError';
  }
}

// ──────────────────────────────────────────────
// ApiGatewayClient
// ──────────────────────────────────────────────

/**
 * Cliente HTTP para comunicarse con la API Gateway.
 * 
 * Características:
 * - Timeout configurable (default 10s)
 * - Headers automáticos: Content-Type application/json, Authorization Bearer {apiKey}
 * - Manejo de errores HTTP: 4xx lanza ApiGatewayError, 5xx lanza ApiGatewayServerError
 * - Timeout lanza ApiGatewayTimeoutError
 * - Tipado genérico para respuestas
 */
export class ApiGatewayClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  /**
   * @param config - Configuración del cliente (baseUrl, apiKey, timeoutMs opcional)
   */
  constructor(config: ApiGatewayClientConfig) {
    const parsed = ApiGatewayClientConfigSchema.parse(config);
    this.baseUrl = parsed.baseUrl.replace(/\/+$/, ''); // Eliminar trailing slash
    this.apiKey = parsed.apiKey;
    this.timeoutMs = parsed.timeoutMs;
  }

  /**
   * Realiza una solicitud GET a la API Gateway.
   * 
   * @param endpoint - Ruta del endpoint (ej: "/api/v1/balance-sheet")
   * @param params - Parámetros de consulta opcionales (objeto clave-valor)
   * @returns Respuesta tipada del servidor
   * @throws ApiGatewayError si la respuesta es 4xx
   * @throws ApiGatewayServerError si la respuesta es 5xx
   * @throws ApiGatewayTimeoutError si la solicitud excede el timeout
   */
  async get<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = this.buildUrl(endpoint, params);
    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    return this.handleResponse<T>(response);
  }

  /**
   * Realiza una solicitud POST a la API Gateway.
   * 
   * @param endpoint - Ruta del endpoint (ej: "/api/v1/reports/generate")
   * @param body - Cuerpo de la solicitud (objeto serializable a JSON)
   * @returns Respuesta tipada del servidor
   * @throws ApiGatewayError si la respuesta es 4xx
   * @throws ApiGatewayServerError si la respuesta es 5xx
   * @throws ApiGatewayTimeoutError si la solicitud excede el timeout
   */
  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(endpoint);
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    return this.handleResponse<T>(response);
  }

  /**
   * Construye la URL completa con los parámetros de consulta.
   */
  private buildUrl(endpoint: string, params?: Record<string, string | number | boolean | undefined>): string {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = new URL(`${this.baseUrl}${cleanEndpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Retorna los headers estándar para todas las solicitudes.
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  /**
   * Realiza la solicitud fetch con timeout configurable.
   */
  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    // Carrera contra un timeout propio en vez de depender únicamente de que
    // fetch respete controller.abort() — un mock (o un servidor real colgado)
    // puede no reaccionar nunca al abort, y sin esto el timeoutMs configurado
    // no tiene ningún efecto real.
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new ApiGatewayTimeoutError(this.timeoutMs));
      }, this.timeoutMs);
    });

    const fetchPromise = fetch(url, {
      ...options,
      signal: controller.signal,
    });

    try {
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error: unknown) {
      if (error instanceof ApiGatewayTimeoutError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiGatewayTimeoutError(this.timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId!);
      // La promesa perdedora de la carrera puede rechazar más tarde — evita
      // un unhandled rejection silencioso.
      fetchPromise.catch(() => undefined);
    }
  }

  /**
   * Procesa la respuesta HTTP y maneja los errores según el código de estado.
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    let responseBody: unknown;

    try {
      responseBody = await response.json();
    } catch {
      responseBody = await response.text().catch(() => null);
    }

    if (!response.ok) {
      const message = this.extractErrorMessage(responseBody, response.status);

      if (response.status >= 400 && response.status < 500) {
        throw new ApiGatewayError(response.status, message, responseBody);
      }

      if (response.status >= 500) {
        throw new ApiGatewayServerError(response.status, message, responseBody);
      }
    }

    return responseBody as T;
  }

  /**
   * Extrae un mensaje de error legible del cuerpo de la respuesta.
   */
  private extractErrorMessage(body: unknown, statusCode: number): string {
    let detail: string | undefined;
    if (body && typeof body === 'object') {
      const obj = body as Record<string, unknown>;
      if (typeof obj.message === 'string') detail = obj.message;
      else if (typeof obj.error === 'string') detail = obj.error;
      else if (typeof obj.detail === 'string') detail = obj.detail;
    }
    return detail
      ? `HTTP ${statusCode}: ${detail}`
      : `HTTP ${statusCode}: Error en la solicitud a la API Gateway`;
  }
}