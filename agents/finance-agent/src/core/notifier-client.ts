import { z } from 'zod';
import { createLogger } from './logger';

// ──────────────────────────────────────────────
// Logger
// ──────────────────────────────────────────────

const logger = createLogger('NotifierClient');

// ──────────────────────────────────────────────
// Errores
// ──────────────────────────────────────────────

/** Error genérico del cliente (respuesta 4xx del notifier-agent). */
export class NotifierClientError extends Error {
  constructor(message: string, public readonly status?: number, public readonly body?: unknown) {
    super(message);
    this.name = 'NotifierClientError';
  }
}

/** El notifier-agent respondió 5xx — problema del lado del servidor, no del request. */
export class NotifierClientServerError extends NotifierClientError {
  constructor(message: string, status?: number, body?: unknown) {
    super(message, status, body);
    this.name = 'NotifierClientServerError';
  }
}

/** La solicitud excedió timeoutMs (fetch abortado). */
export class NotifierClientTimeoutError extends NotifierClientError {
  constructor(message: string) {
    super(message);
    this.name = 'NotifierClientTimeoutError';
  }
}

// ──────────────────────────────────────────────
// Schemas Zod
// ──────────────────────────────────────────────

export const NotifierClientConfigSchema = z.object({
  baseUrl: z.string().url('baseUrl debe ser una URL válida'),
  apiKey: z.string().min(1, 'apiKey es requerida'),
  timeoutMs: z.number().positive().default(10000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// z.input (no z.infer) — los campos con .default() deben quedar opcionales para
// quien construye el cliente; z.infer da la forma de SALIDA (post-parse), que
// exigiría pasar timeoutMs/logLevel siempre, anulando el propósito del default.
export type NotifierClientConfig = z.input<typeof NotifierClientConfigSchema>;

export const SendNotificationInputSchema = z.object({
  channel: z.enum(['email', 'slack', 'telegram']).optional(),
  to: z.array(z.string()).min(1, 'to debe tener al menos un destinatario'),
  subject: z.string().min(1, 'subject es requerido'),
  body: z.string().min(1, 'body es requerido'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content: z.string(),
        contentType: z.string(),
      }),
    )
    .optional(),
});

export type SendNotificationInput = z.input<typeof SendNotificationInputSchema>;

export const NotifyUserInputSchema = z.object({
  userId: z.string().min(1, 'userId es requerido'),
  title: z.string().min(1, 'title es requerido'),
  message: z.string().min(1, 'message es requerido'),
  type: z.string().optional(),
  channel: z.enum(['email', 'slack', 'telegram']).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
});

export type NotifyUserInput = z.input<typeof NotifyUserInputSchema>;

export const GetHistoryInputSchema = z.object({
  userId: z.string().optional(),
  channel: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export type GetHistoryInput = z.infer<typeof GetHistoryInputSchema>;

// ──────────────────────────────────────────────
// Interfaces de salida
// ──────────────────────────────────────────────

export interface NotifyUserOutput {
  notificationId: string;
  status: string;
  userId?: string;
  channel?: string;
}

export interface SendNotificationOutput {
  notificationId: string;
  status: string;
  sentTo?: string[];
}

export interface GetHistoryOutput {
  notifications: Array<{
    notificationId: string;
    channel: string;
    recipient?: string;
    subject?: string;
    body?: string;
    priority?: string;
    status: string;
    timestamp: string;
  }>;
  total: number;
}

// ──────────────────────────────────────────────
// NotifierClient
// ──────────────────────────────────────────────

export class NotifierClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly logLevel: string;

  constructor(config: NotifierClientConfig) {
    const parsed = NotifierClientConfigSchema.parse(config);
    this.baseUrl = parsed.baseUrl.replace(/\/+$/, '');
    this.apiKey = parsed.apiKey;
    this.timeoutMs = parsed.timeoutMs;
    this.logLevel = parsed.logLevel;
    logger.info('NotifierClient inicializado', { baseUrl: this.baseUrl, logLevel: this.logLevel });
  }

  async sendNotification(input: SendNotificationInput): Promise<SendNotificationOutput> {
    const parsed = SendNotificationInputSchema.parse(input);
    logger.info('Enviando notificación', { channel: parsed.channel, to: parsed.to });
    const response = await this.request('/notifications/send', {
      method: 'POST',
      body: JSON.stringify(parsed),
    });
    return response as SendNotificationOutput;
  }

  async notifyUser(input: NotifyUserInput): Promise<NotifyUserOutput> {
    const parsed = NotifyUserInputSchema.parse(input);
    logger.info('Notificando usuario', { userId: parsed.userId, title: parsed.title });
    const response = await this.request('/notifications/user', {
      method: 'POST',
      body: JSON.stringify(parsed),
    });
    return response as NotifyUserOutput;
  }

  async getHistory(input?: GetHistoryInput): Promise<GetHistoryOutput> {
    const parsed = GetHistoryInputSchema.parse(input ?? {});
    logger.info('Obteniendo historial de notificaciones');
    const params = new URLSearchParams();
    if (parsed.userId) params.set('userId', parsed.userId);
    if (parsed.channel) params.set('channel', parsed.channel);
    if (parsed.status) params.set('status', parsed.status);
    if (parsed.limit) params.set('limit', String(parsed.limit));
    if (parsed.offset) params.set('offset', String(parsed.offset));
    const queryString = params.toString();
    const endpoint = queryString ? `/notifications/history?${queryString}` : '/notifications/history';
    const response = await this.request(endpoint, { method: 'GET' });
    return response as GetHistoryOutput;
  }

  private async request(
    endpoint: string,
    options: { method: string; body?: string }
  ): Promise<unknown> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;

    // Carrera contra un timeout propio en vez de depender únicamente de que
    // fetch respete controller.abort() — un mock (o un servidor real colgado)
    // puede no reaccionar nunca al abort, y sin esto el timeoutMs configurado
    // no tiene ningún efecto real.
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new NotifierClientTimeoutError(`Timeout: La solicitud excedió ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    const fetchPromise = (async (): Promise<unknown> => {
      const response = await fetch(url, {
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: options.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => undefined);
        const message = `HTTP ${response.status}: ${response.statusText}`;
        if (response.status >= 500) {
          throw new NotifierClientServerError(message, response.status, errorBody);
        }
        throw new NotifierClientError(message, response.status, errorBody);
      }

      return response.json();
    })();

    try {
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof NotifierClientError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new NotifierClientTimeoutError(`Timeout: La solicitud excedió ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId!);
      // La promesa perdedora de la carrera puede rechazar más tarde (ej: el
      // mock del test rechaza a los 500ms real/fake) — evita un unhandled
      // rejection silencioso.
      fetchPromise.catch(() => undefined);
    }
  }
}
