// ---------------------------------------------------------------------------
// withRetry — Wrapper sobre @backendkit-labs/retry para canales de notificación
// ---------------------------------------------------------------------------

import { retry } from '@backendkit-labs/retry';
import type { ChannelResult } from '../types/notification.js';

/**
 * Ejecuta una función de envío con reintentos usando @backendkit-labs/retry.
 *
 * Características:
 * - Backoff exponencial con jitter
 * - Sliding window budget (evita retry storms)
 * - Clasificación automática: 4xx = permanente (no reintenta), 5xx/429 = transitorio
 * - Timeout por intento
 * - Result pattern consistente con el ecosistema
 */
export async function withRetry(
  fn: () => Promise<ChannelResult>,
  maxAttempts = 3
): Promise<ChannelResult> {
  const result = await retry(fn, { maxAttempts });

  if (result.ok) {
    return result.value;
  }

  // Si el error original es un ChannelResult, devolverlo directamente
  const cause = result.error.cause as ChannelResult | undefined;
  if (cause && 'success' in cause) {
    return cause;
  }

  return {
    success: false,
    status: 'failed',
    deliveredAt: new Date().toISOString(),
    error: `Falló después de ${maxAttempts} intentos: ${result.error.message}`,
    latencyMs: 0,
  };
}
