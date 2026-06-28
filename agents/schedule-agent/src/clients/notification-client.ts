/**
 * NotificationClient — Cliente de notificaciones estructuradas.
 *
 * Soporta múltiples canales:
 * - console.error (default) con payload JSON estructurado
 * - Callback opcional para integración con Notification-Agent vía MCP
 *
 * Fácil de extender: agregar un nuevo canal en notify().
 * Nunca lanza error — si falla, solo se loguea internamente.
 */

export interface NotificationPayload {
  taskId: string;
  message: string;
  recipients: string[];
  channel: "console" | "callback";
  timestamp: string;
}

export type NotifyCallback = (
  payload: NotificationPayload
) => Promise<void> | void;

export class NotificationClient {
  private callback: NotifyCallback | null = null;

  /**
   * Registra un callback opcional para enviar notificaciones
   * a un canal externo (ej: Notification-Agent vía MCP).
   */
  setCallback(cb: NotifyCallback): void {
    this.callback = cb;
  }

  /**
   * Envía una notificación estructurada.
   *
   * Canales actuales:
   * 1. console.error — siempre, con payload JSON
   * 2. callback — si está registrado
   *
   * @param taskId - ID de la tarea que disparó la notificación
   * @param message - Mensaje descriptivo del evento
   * @param recipients - Lista de destinatarios (emails, canales, etc.)
   */
  async notify(
    taskId: string,
    message: string,
    recipients: string[]
  ): Promise<void> {
    const payload: NotificationPayload = {
      taskId,
      message,
      recipients,
      channel: "console",
      timestamp: new Date().toISOString(),
    };

    // Canal 1: console.error estructurado (siempre)
    try {
      console.error(
        `[notification-client] ${JSON.stringify(payload)}`
      );
    } catch (err) {
      console.error(
        `[notification-client] Failed to log notification for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Canal 2: callback opcional (Notification-Agent vía MCP)
    if (this.callback) {
      try {
        payload.channel = "callback";
        await this.callback(payload);
      } catch (err) {
        console.error(
          `[notification-client] Callback failed for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
}
