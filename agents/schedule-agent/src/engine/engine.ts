/**
 * SchedulerEngine — Engine de ejecución background.
 *
 * Loop con setInterval que cada N ms:
 * 1. Consulta tareas vencidas (nextRunAt <= now, status = active)
 * 2. Ejecuta cada tarea vía OrchestratorClient
 * 3. Actualiza estado, executionHistory, nextRunAt
 * 4. Notifica en fallo si corresponde
 *
 * Características:
 * - Lock en memoria (Set<string>) para evitar doble ejecución
 * - Timeout por tarea configurable
 * - Reintentos con backoff en fallo de orquestador
 * - Emite evento 'tick-complete' para tests
 */

import type { TaskRepository } from "../repository/task-repository.js";
import type { OrchestratorClient } from "../clients/orchestrator-client.js";
import type { NotificationClient } from "../clients/notification-client.js";
import type { ScheduledTask, ExecutionLog } from "../types/task.js";
import cronParser from "cron-parser";

export interface EngineStatus {
  running: boolean;
  lastTick: string | null;
  tasksProcessed: number;
}

export interface TickResult {
  found: number;
  executed: number;
  succeeded: number;
  failed: number;
}

type TickCompleteListener = (result: TickResult) => void;

export class SchedulerEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastTick: string | null = null;
  private tasksProcessed = 0;
  /** Lock en memoria: Set de taskIds actualmente en ejecución */
  private executionLocks = new Set<string>();
  /** Listeners para evento tick-complete (tests) */
  private tickListeners: TickCompleteListener[] = [];

  constructor(
    private repository: TaskRepository,
    private orchestratorClient: OrchestratorClient,
    private notificationClient: NotificationClient,
    private intervalMs: number,
    /** Timeout máximo por tarea en ms (default: 5 min) */
    private taskTimeoutMs: number = 300_000
  ) {}

  // ─── Lifecycle ─────────────────────────────────────────────────

  /** Inicia el loop de polling */
  start(): void {
    if (this.running) {
      console.warn("[engine] Already running, ignoring start()");
      return;
    }

    this.running = true;
    console.error(
      `[engine] Starting scheduler engine (interval: ${this.intervalMs}ms, task timeout: ${this.taskTimeoutMs}ms)`
    );

    // Ejecutar primer tick inmediatamente
    this.tick();

    this.intervalId = setInterval(() => this.tick(), this.intervalMs);
  }

  /** Detiene el loop de polling */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.error("[engine] Scheduler engine stopped");
  }

  /** Devuelve el estado actual del engine */
  getStatus(): EngineStatus {
    return {
      running: this.running,
      lastTick: this.lastTick,
      tasksProcessed: this.tasksProcessed,
    };
  }

  // ─── Tick listeners (para tests) ───────────────────────────────

  onTickComplete(listener: TickCompleteListener): void {
    this.tickListeners.push(listener);
  }

  removeTickListener(listener: TickCompleteListener): void {
    this.tickListeners = this.tickListeners.filter((l) => l !== listener);
  }

  // ─── Tick interno ──────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (!this.running) return;

    const now = new Date().toISOString();
    this.lastTick = now;

    try {
      const dueTasks = this.repository.findDueTasks(now);
      const result: TickResult = {
        found: dueTasks.length,
        executed: 0,
        succeeded: 0,
        failed: 0,
      };

      if (dueTasks.length === 0) {
        this.emitTickComplete(result);
        return;
      }

      console.error(
        `[engine] Tick found ${dueTasks.length} due task(s)`
      );

      for (const task of dueTasks) {
        // Saltar si ya está en ejecución (lock en memoria)
        if (this.executionLocks.has(task.id)) {
          console.warn(
            `[engine] Task ${task.id} is already being executed, skipping`
          );
          continue;
        }

        result.executed++;
        await this.executeTask(task, now, result);
      }

      console.error(
        `[engine] Tick complete: ${result.executed} executed, ${result.succeeded} succeeded, ${result.failed} failed`
      );

      this.emitTickComplete(result);
    } catch (err) {
      console.error(
        `[engine] Tick error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ─── Ejecución de una tarea ────────────────────────────────────

  private async executeTask(
    task: ScheduledTask,
    now: string,
    result: TickResult
  ): Promise<void> {
    // Lock en memoria
    this.executionLocks.add(task.id);

    const startTime = Date.now();
    let executionLog: ExecutionLog;

    try {
      // Ejecutar con timeout
      const flowResult = await this.runWithTimeout(
        () => this.orchestratorClient.startFlow(task.workflow, task.workflowInput),
        this.taskTimeoutMs
      );

      const duration = Date.now() - startTime;

      if (flowResult.success) {
        // Éxito
        result.succeeded++;
        executionLog = {
          executedAt: now,
          status: "success",
          duration,
          result: flowResult.result,
          triggeredBy: "scheduler",
        };

        task.lastRunAt = now;
        task.runCount = (task.runCount || 0) + 1;
        task.executionHistory.push(executionLog);

        if (task.type === "one_time") {
          task.status = "completed";
          task.nextRunAt = undefined;
        } else if (task.type === "cron" && task.cron) {
          // Recalcular nextRunAt
          try {
            const interval = cronParser.parseExpression(task.cron, {
              tz: task.timezone || "UTC",
            });
            task.nextRunAt = interval.next().toISOString();

            // Si maxRuns está definido y se alcanzó, completar
            if (task.maxRuns !== undefined && task.runCount >= task.maxRuns) {
              task.status = "completed";
              task.nextRunAt = undefined;
            }
          } catch (cronErr) {
            console.error(
              `[engine] Failed to recalculate nextRunAt for cron task ${task.id}: ${cronErr instanceof Error ? cronErr.message : String(cronErr)}`
            );
            task.status = "failed";
          }
        }

        task.updatedAt = now;
        this.repository.update(task);
        this.tasksProcessed++;
      } else {
        // Error del orquestador
        result.failed++;
        executionLog = {
          executedAt: now,
          status: "failure",
          duration,
          error: flowResult.error,
          triggeredBy: "scheduler",
        };

        task.executionHistory.push(executionLog);
        task.status = "failed";
        task.updatedAt = now;
        this.repository.update(task);
        this.tasksProcessed++;

        // Notificar si corresponde
        if (task.notifyOnFailure && task.notifyTo.length > 0) {
          await this.notificationClient.notify(
            task.id,
            `Task "${task.workflow}" (${task.id}) failed: ${flowResult.error}`,
            task.notifyTo
          );
        }
      }
    } catch (err) {
      // Error interno (timeout, excepción inesperada)
      const duration = Date.now() - startTime;
      result.failed++;
      executionLog = {
        executedAt: now,
        status: "failure",
        duration,
        error: err instanceof Error ? err.message : String(err),
        triggeredBy: "scheduler",
      };

      task.executionHistory.push(executionLog);
      task.status = "failed";
      task.updatedAt = now;
      this.repository.update(task);
      this.tasksProcessed++;

      if (task.notifyOnFailure && task.notifyTo.length > 0) {
        await this.notificationClient.notify(
          task.id,
          `Task "${task.workflow}" (${task.id}) failed with internal error: ${executionLog.error}`,
          task.notifyTo
        );
      }
    } finally {
      // Liberar lock
      this.executionLocks.delete(task.id);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private async runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Task execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          reject(err);
        });
    });
  }

  private emitTickComplete(result: TickResult): void {
    for (const listener of this.tickListeners) {
      try {
        listener(result);
      } catch {
        // Ignorar errores en listeners
      }
    }
  }
}
