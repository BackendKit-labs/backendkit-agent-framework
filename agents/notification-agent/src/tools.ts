// ---------------------------------------------------------------------------
// Tools — Schemas Zod + buildPrompt para AgentMCPServer
// ---------------------------------------------------------------------------

import { z } from 'zod';

export const tools = [
  {
    name: 'notify_user',
    description: 'Notificar a un usuario de empresa resolviendo el mejor canal según sus preferencias',
    schema: {
      userId: z.string(),
      companyId: z.string(),
      title: z.string(),
      body: z.string(),
      context: z.object({
        type: z.enum(['factura', 'alerta', 'recordatorio', 'aprobacion', 'sistema', 'otro']),
        action: z.enum(['view', 'approve', 'pay', 'dismiss', 'open']).optional(),
        referenceId: z.string().optional(),
        referenceUrl: z.string().optional(),
      }),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
      forceChannel: z.enum(['email', 'push', 'telegram', 'slack', 'discord', 'in_app']).optional(),
      source: z.string(),
    },
    buildPrompt: (args: any) => `Ejecuta notify_user para ${args.userId} de empresa ${args.companyId}: ${args.title}`,
  },
  {
    name: 'send_notification',
    description: 'Envío directo de notificación por un canal específico',
    schema: {
      channel: z.enum(['console', 'director', 'email', 'slack', 'telegram', 'discord', 'webhook', 'push']),
      to: z.union([z.string(), z.array(z.string())]).optional(),
      subject: z.string().optional(),
      body: z.string(),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
    },
    buildPrompt: (args: any) => `Ejecuta send_notification por canal ${args.channel}: ${args.body}`,
  },
  {
    name: 'notify_scheduled',
    description: 'Programa una notificación para ser enviada en una fecha/hora futura',
    schema: {
      userId: z.string(),
      companyId: z.string(),
      title: z.string(),
      body: z.string(),
      context: z.any(),
      scheduleAt: z.string(),
      timezone: z.string().optional(),
      priority: z.string().optional(),
      source: z.string(),
    },
    buildPrompt: (args: any) => `Ejecuta notify_scheduled para ${args.userId} en ${args.scheduleAt}`,
  },
  {
    name: 'register_user_channels',
    description: 'Registra o actualiza los canales de notificación y preferencias de un usuario',
    schema: {
      userId: z.string(),
      companyId: z.string(),
      channels: z.any(),
      preferences: z.object({
        order: z.array(z.string()),
        quiet_hours: z.object({ start: z.string(), end: z.string(), timezone: z.string() }).optional(),
        do_not_disturb: z.boolean().optional(),
      }).optional(),
    },
    buildPrompt: (args: any) => `Ejecuta register_user_channels para ${args.userId} de empresa ${args.companyId}`,
  },
  {
    name: 'user_channels',
    description: 'Consulta los canales configurados de un usuario',
    schema: { userId: z.string(), companyId: z.string() },
    buildPrompt: (args: any) => `Ejecuta user_channels para ${args.userId} de empresa ${args.companyId}`,
  },
  {
    name: 'list_channels',
    description: 'Lista todos los canales disponibles y su estado de configuración',
    schema: {},
    buildPrompt: () => 'Ejecuta list_channels',
  },
  {
    name: 'test_channel',
    description: 'Envía una notificación de prueba a un canal específico y mide latencia',
    schema: { channel: z.string(), to: z.string().optional() },
    buildPrompt: (args: any) => `Ejecuta test_channel para canal ${args.channel}`,
  },
  {
    name: 'get_notification_history',
    description: 'Consulta el historial de notificaciones con filtros',
    schema: {
      userId: z.string().optional(),
      companyId: z.string().optional(),
      channel: z.string().optional(),
      status: z.enum(['sent', 'failed']).optional(),
      source: z.string().optional(),
      since: z.string().optional(),
      limit: z.number().optional(),
    },
    buildPrompt: (args: any) => `Ejecuta get_notification_history${args.userId ? ' para ' + args.userId : ''}`,
  },
  {
    name: 'register_device',
    description: 'Registra un dispositivo para notificaciones push',
    schema: {
      userId: z.string(),
      companyId: z.string(),
      provider: z.enum(['fcm', 'expo', 'onesignal']),
      token: z.string(),
      platform: z.enum(['ios', 'android', 'web']),
      deviceInfo: z.object({ osVersion: z.string().optional(), appVersion: z.string().optional(), model: z.string().optional() }).optional(),
      tags: z.record(z.string()).optional(),
    },
    buildPrompt: (args: any) => `Ejecuta register_device para ${args.userId} en ${args.platform}`,
  },
  {
    name: 'unregister_device',
    description: 'Da de baja un dispositivo push',
    schema: { token: z.string(), provider: z.string().optional() },
    buildPrompt: (args: any) => `Ejecuta unregister_device para token ${args.token}`,
  },
  {
    name: 'list_devices',
    description: 'Lista dispositivos push registrados con filtros',
    schema: {
      userId: z.string().optional(),
      companyId: z.string().optional(),
      provider: z.string().optional(),
      active: z.boolean().optional(),
      limit: z.number().optional(),
    },
    buildPrompt: (args: any) => `Ejecuta list_devices${args.userId ? ' para ' + args.userId : ''}`,
  },
];
