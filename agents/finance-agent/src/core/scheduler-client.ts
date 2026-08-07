import { z } from 'zod';
import { createLogger } from './logger';

// ──────────────────────────────────────────────
// Logger
// ──────────────────────────────────────────────

const logger = createLogger('SchedulerClient');

// ──────────────────────────────────────────────
// Errores
// ──────────────────────────────────────────────

/** Error genérico del cliente (respuesta 4xx del scheduler-agent). */
export class SchedulerClientError extends Error {
  constructor(message: string, public readonly status?: number, public readonly body?: unknown) {
    super(message);
    this.name = 'SchedulerClientError';
  }
}

/** El scheduler-agent respondió 5xx — problema del lado del servidor, no del request. */
export class SchedulerClientServerError extends SchedulerClientError {
  constructor(message: string, status?: number, body?: unknown) {
    super(message, status, body);
    this.name = 'SchedulerClientServerError';
  }
}

/** La solicitud excedió timeoutMs (fetch abortado). */
export class SchedulerClientTimeoutError extends SchedulerClientError {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulerClientTimeoutError';
  }
}

// ──────────────────────────────────────────────
// Schemas Zod
// ──────────────────────────────────────────────

export const SchedulerClientConfigSchema = z.object({
  baseUrl: z.string().url('baseUrl debe ser una URL válida'),
  apiKey: z.string().min(1, 'apiKey es requerida'),
  timeoutMs: z.number().positive().default(10000),
});

// z.input (no z.infer) — timeoutMs tiene .default(), debe quedar opcional para
// quien construye el cliente (z.infer da la forma de salida post-parse).
export type SchedulerClientConfig = z.input<typeof SchedulerClientConfigSchema>;

// ──────────────────────────────────────────────
// Interfaces
// ──────────────────────────────────────────────

export interface ScheduleTaskInput {
  taskName: string;
  schedule: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface ScheduleTaskOutput {
  taskId: string;
  status: string;
}

export interface CancelTaskInput {
  taskId: string;
}

export interface CancelTaskOutput {
  taskId: string;
  status: string;
}

export interface ListTasksInput {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ListTasksOutput {
  tasks: Array<{
    taskId: string;
    taskName: string;
    schedule: string;
    status: string;
    nextRun?: string;
  }>;
  total: number;
}

export interface RescheduleInput {
  taskId: string;
  schedule: string;
  payload?: Record<string, unknown>;
}

export interface RescheduleOutput {
  taskId: string;
  status: string;
  nextRun?: string;
}

export interface GetTaskStatusInput {
  taskId: string;
}

export interface GetTaskStatusOutput {
  taskId: string;
  taskName: string;
  schedule: string;
  status: string;
  lastRun?: string;
  nextRun?: string;
  createdAt?: string;
}

// ──────────────────────────────────────────────
// SchedulerClient
// ──────────────────────────────────────────────

export class SchedulerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: SchedulerClientConfig) {
    const parsed = SchedulerClientConfigSchema.parse(config);
    this.baseUrl = parsed.baseUrl.replace(/\/+$/, '');
    this.apiKey = parsed.apiKey;
    this.timeoutMs = parsed.timeoutMs;
    logger.info('SchedulerClient inicializado', { baseUrl: this.baseUrl });
  }

  async scheduleTask(input: ScheduleTaskInput): Promise<ScheduleTaskOutput> {
    logger.info('Programando tarea', { taskName: input.taskName });
    const response = await this.request('/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return response as ScheduleTaskOutput;
  }

  async cancelTask(input: CancelTaskInput): Promise<CancelTaskOutput> {
    logger.info('Cancelando tarea', { taskId: input.taskId });
    const response = await this.request(`/tasks/${input.taskId}`, {
      method: 'DELETE',
    });
    return response as CancelTaskOutput;
  }

  async listTasks(input?: ListTasksInput): Promise<ListTasksOutput> {
    logger.info('Listando tareas');
    const params = new URLSearchParams();
    if (input?.status) params.set('status', input.status);
    if (input?.limit) params.set('limit', String(input.limit));
    if (input?.offset) params.set('offset', String(input.offset));
    const queryString = params.toString();
    const endpoint = queryString ? `/tasks?${queryString}` : '/tasks';
    const response = await this.request(endpoint, { method: 'GET' });
    return response as ListTasksOutput;
  }

  async reschedule(input: RescheduleInput): Promise<RescheduleOutput> {
    logger.info('Re-programando tarea', { taskId: input.taskId });
    const body: { schedule: string; payload?: Record<string, unknown> } = { schedule: input.schedule };
    if (input.payload) body.payload = input.payload;
    const response = await this.request(`/tasks/${input.taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return response as RescheduleOutput;
  }

  async getTaskStatus(input: GetTaskStatusInput): Promise<GetTaskStatusOutput> {
    logger.info('Obteniendo estado de tarea', { taskId: input.taskId });
    const response = await this.request(`/tasks/${input.taskId}`, {
      method: 'GET',
    });
    return response as GetTaskStatusOutput;
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
        reject(new SchedulerClientTimeoutError(`Timeout: La solicitud excedió ${this.timeoutMs}ms`));
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
          throw new SchedulerClientServerError(message, response.status, errorBody);
        }
        throw new SchedulerClientError(message, response.status, errorBody);
      }

      return response.json();
    })();

    try {
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof SchedulerClientError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new SchedulerClientTimeoutError(`Timeout: La solicitud excedió ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId!);
      fetchPromise.catch(() => undefined);
    }
  }
}
