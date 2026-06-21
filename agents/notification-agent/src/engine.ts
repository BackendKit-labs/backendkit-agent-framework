// ---------------------------------------------------------------------------
// Engine — Registry pattern + engine factory
// ---------------------------------------------------------------------------

import { CallbackTransport } from '@backendkit-labs/agent-core';
import { auditLogger } from './audit.js';
import { handler as notifyUserHandler } from './tools/notifyUser.js';
import { handler as sendNotificationHandler } from './tools/sendNotification.js';
import { handler as notifyScheduledHandler } from './tools/notifyScheduled.js';
import { handler as registerUserChannelsHandler } from './tools/registerUserChannels.js';
import { handler as userChannelsHandler } from './tools/userChannels.js';
import { handler as listChannelsHandler } from './tools/listChannels.js';
import { handler as testChannelHandler } from './tools/testChannel.js';
import { handler as getHistoryHandler } from './tools/getHistory.js';
import { handler as registerDeviceHandler } from './tools/registerDevice.js';
import { handler as unregisterDeviceHandler } from './tools/unregisterDevice.js';
import { handler as listDevicesHandler } from './tools/listDevices.js';

type ToolHandler = (prompt: string) => Promise<string>;

const toolHandlers = new Map<string, ToolHandler>();

export function registerTool(name: string, handler: ToolHandler): void {
  toolHandlers.set(name, handler);
}

// Registrar handlers desde tools/
registerTool('notify_user', notifyUserHandler);
registerTool('send_notification', sendNotificationHandler);
registerTool('notify_scheduled', notifyScheduledHandler);
registerTool('register_user_channels', registerUserChannelsHandler);
registerTool('user_channels', userChannelsHandler);
registerTool('list_channels', listChannelsHandler);
registerTool('test_channel', testChannelHandler);
registerTool('get_notification_history', getHistoryHandler);
registerTool('register_device', registerDeviceHandler);
registerTool('unregister_device', unregisterDeviceHandler);
registerTool('list_devices', listDevicesHandler);

export function createEngine(transport: CallbackTransport) {
  return {
    run: async (prompt: string): Promise<void> => {
      try {
        for (const [name, handler] of toolHandlers) {
          if (prompt.includes(name)) {
            const start = Date.now();
            try {
              const result = await handler(prompt);
              const parsed = JSON.parse(result) as Record<string, unknown>;
              auditLogger.write({
                tool: name, status: 'ok', durationMs: Date.now() - start,
                extra: parsed['channel'] ? { channel: parsed['channel'], notifStatus: parsed['status'] } : undefined,
              });
              transport.emit({ type: 'token', content: result });
              transport.emit({ type: 'done' });
            } catch (handlerErr) {
              auditLogger.write({ tool: name, status: 'error', durationMs: Date.now() - start, error: String(handlerErr) });
              throw handlerErr;
            }
            return;
          }
        }
        transport.emit({ type: 'token', content: JSON.stringify({ error: 'Unknown tool' }) });
        transport.emit({ type: 'done' });
      } catch (err) {
        transport.emit({ type: 'error', message: `Engine error: ${String(err)}` });
      }
    },
  };
}
