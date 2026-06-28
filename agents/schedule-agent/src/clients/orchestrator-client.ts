/**
 * OrchestratorClient — Cliente HTTP para llamar al orquestador
 * y ejecutar workflows (start_flow).
 *
 * Implementa:
 * - Timeout configurable (default 30s)
 * - Reintentos con backoff exponencial (max 3: 1s, 2s, 4s)
 * - Captura de errores de red → { success: false, error }
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export interface StartFlowResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export class OrchestratorClient {
  constructor(
    private baseUrl: string,
    private timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  /**
   * Ejecuta un workflow en el orquestador.
   * Reintenta hasta MAX_RETRIES veces con backoff exponencial.
   */
  async startFlow(
    workflow: string,
    input: Record<string, unknown>
  ): Promise<StartFlowResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await this.delay(RETRY_DELAYS_MS[attempt - 1]);
      }

      try {
        const result = await this.executeRequest(workflow, input);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(
          `[orchestrator-client] Attempt ${attempt + 1}/${MAX_RETRIES} failed for workflow "${workflow}": ${lastError}`
        );
      }
    }

    return { success: false, error: lastError };
  }

  private async executeRequest(
    workflow: string,
    input: Record<string, unknown>
  ): Promise<StartFlowResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(
        `${this.baseUrl}/api/workflows/${encodeURIComponent(workflow)}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          success: false,
          error: `Orchestrator responded with status ${response.status}: ${body}`,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      return { success: true, result: data };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
