// ──────────────────────────────────────────────
// Notifier Client Interfaces
// ──────────────────────────────────────────────

/**
 * Interfaz del cliente del Notifier Agent.
 * Define los contratos para enviar notificaciones y consultar historial.
 */
export interface INotifierClient {
  notifyUser(input: NotifyUserInput): Promise<NotifyUserOutput>;
  sendNotification(input: SendNotificationInput): Promise<SendNotificationOutput>;
  getHistory(input?: GetHistoryInput): Promise<GetHistoryOutput>;
}

// ──────────────────────────────────────────────
// Input/Output Types
// ──────────────────────────────────────────────

export interface NotifyUserInput {
  userId: string;
  title: string;
  message: string;
  channel?: 'email' | 'slack' | 'telegram';
  priority?: 'low' | 'normal' | 'high';
}

export interface NotifyUserOutput {
  notificationId: string;
  status: string;
  channel: string;
}

export interface SendNotificationInput {
  to: string[];
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType: string;
  }>;
  channel?: 'email' | 'slack' | 'telegram';
}

export interface SendNotificationOutput {
  notificationId: string;
  status: string;
  sentTo: string[];
}

export interface GetHistoryInput {
  limit?: number;
  offset?: number;
  status?: string;
}

export interface GetHistoryOutput {
  notifications: Array<{
    notificationId: string;
    title: string;
    status: string;
    channel: string;
    createdAt: string;
  }>;
  total: number;
}
