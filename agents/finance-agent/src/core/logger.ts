/**
 * Logger utility for Finance Agent.
 * 
 * Provides a simple logging interface that doesn't depend on
 * @backendkit-labs/agent-core (which may not export createLogger).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Creates a logger instance with a given context name.
 * Outputs structured JSON logs to stdout/stderr.
 */
export function createLogger(name: string): Logger {
  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      name,
      message,
      ...(meta ? { meta } : {}),
    };

    const output = JSON.stringify(entry);

    // Todo va a stderr, nunca a stdout — el entry-point stdio (mcp-stdio.ts)
    // usa stdout exclusivamente para el protocolo JSON-RPC; un log ahí
    // corrompe el stream y rompe al cliente MCP que lo está leyendo.
    process.stderr.write(output + '\n');
  };

  return {
    debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
    info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
    error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  };
}
