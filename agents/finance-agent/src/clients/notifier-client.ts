// ──────────────────────────────────────────────
// Notifier Client — Re-export from core
// ──────────────────────────────────────────────

/**
 * El NotifierClient se implementa en src/core/notifier-client.ts
 * y se re-exporta desde aquí para mantener una estructura de directorios
 * limpia donde todos los clientes de microservicios residan en src/clients/.
 *
 * Las importaciones existentes desde src/core/engine.ts y src/core/tool-registry.ts
 * siguen funcionando porque importan directamente desde './notifier-client'
 * (relativo a src/core/).
 */

export {
  NotifierClient,
  NotifierClientConfigSchema,
} from '../core/notifier-client';

export type {
  NotifierClientConfig,
} from '../core/notifier-client';

export type {
  INotifierClient,
  NotifyUserInput,
  NotifyUserOutput,
  SendNotificationInput,
  SendNotificationOutput,
  GetHistoryInput,
  GetHistoryOutput,
} from './interfaces/notifier.interface';
