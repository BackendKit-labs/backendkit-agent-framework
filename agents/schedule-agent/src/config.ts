import path from "node:path";
import os from "node:os";

export interface AppConfig {
  /** Ruta al archivo de base de datos SQLite */
  dbPath: string;
  /** Intervalo del engine en milisegundos (default: 30s) */
  engineIntervalMs: number;
  /** Zona horaria por defecto */
  defaultTimezone: string;
  /** URL base del orquestador para ejecutar workflows */
  orchestratorUrl: string;
  /** Timeout máximo por ejecución de tarea en ms (default: 5 min) */
  engineTimeoutMs: number;
}

function loadConfig(): AppConfig {
  const homeDir = os.homedir();
  const dbPath =
    process.env.SCHEDULER_DB_PATH ||
    path.join(homeDir, ".backendkit", "scheduler", "tasks.db");

  return {
    dbPath,
    engineIntervalMs: Number(process.env.SCHEDULER_ENGINE_INTERVAL) || 30_000,
    defaultTimezone: process.env.SCHEDULER_DEFAULT_TIMEZONE || "UTC",
    orchestratorUrl: process.env.ORCHESTRATOR_URL || "http://localhost:3000",
    engineTimeoutMs: Number(process.env.SCHEDULER_ENGINE_TIMEOUT) || 300_000,
  };
}

export const config = loadConfig();
