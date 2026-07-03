/**
 * Mock for @backendkit-labs/agent-core
 * Proporciona implementaciones stub para las funciones usadas por los módulos del proyecto.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createLogger(_name: string) {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

/**
 * Mock de StdoutTransport — implementación stub que no depende de readline.
 */
export class StdoutTransport {
  emit(_event: unknown): void {
    // no-op en tests
  }
  onInput(_handler: (input: string) => void): () => void {
    return () => { /* no-op */ };
  }
  close(): void {
    // no-op
  }
}

/**
 * Mock de CallbackTransport — implementación stub.
 */
export class CallbackTransport {
  private readonly onEvent: (event: unknown) => void;
  private inputHandlers: Array<(input: string) => void> = [];

  constructor(onEvent: (event: unknown) => void) {
    this.onEvent = onEvent;
  }

  emit(event: unknown): void {
    this.onEvent(event);
  }
  onInput(handler: (input: string) => void): () => void {
    this.inputHandlers.push(handler);
    return () => {
      this.inputHandlers = this.inputHandlers.filter((h) => h !== handler);
    };
  }
  send(input: string): void {
    for (const handler of this.inputHandlers) {
      handler(input);
    }
  }
  close(): void {
    this.inputHandlers = [];
  }
}

/**
 * Mock de createBaseEngine — retorna un objeto con callLLM.
 */
export function createBaseEngine(_opts: unknown): { callLLM: (prompt: string) => Promise<string> } {
  return {
    callLLM: async (prompt: string): Promise<string> => {
      return `Mock response for: ${prompt}`;
    },
  };
}
