// ---------------------------------------------------------------------------
// Notification-Agent — Entry point
// ---------------------------------------------------------------------------

import 'dotenv/config';
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { CallbackTransport, type AgentEngine } from '@backendkit-labs/agent-core';
import { createEngine } from './engine.js';
import { tools } from './tools.js';
import { getConfig } from './storage/config.js';
import { sendConsole } from './channels/console.js';
import { sendDirector } from './channels/director.js';
import { sendEmail } from './channels/email.js';
import { sendSlack } from './channels/slack.js';
import { sendTelegram } from './channels/telegram.js';
import { sendDiscord } from './channels/discord.js';
import { sendWebhook } from './channels/webhook.js';
import { sendPush } from './channels/push/index.js';
import { notifyUser } from './services/notifyUser.js';

async function main(): Promise<void> {
  try {
    // Inicializar configuración persistente
    getConfig();

    // Detectar flag --test-all
    if (process.argv.includes('--test-all')) {
      console.log('\nTesting all configured channels...\n');

      // Probar console
      const consoleResult = await sendConsole({ body: 'Test de consola', priority: 'normal' });
      console.log(`  ${consoleResult.success ? '✅' : '❌'} console    → OK (${consoleResult.latencyMs}ms)`);

      // Probar director
      const directorResult = await sendDirector({ body: 'Test de director', priority: 'high' });
      console.log(`  ${directorResult.success ? '✅' : '❌'} director   → OK (${directorResult.latencyMs}ms)`);

      // Probar email (puede fallar si no hay SMTP)
      const emailResult = await sendEmail({ to: 'test@test.com', subject: 'Test', body: 'Test email' });
      if (emailResult.success) {
        console.log(`  ✅ email      → OK (${emailResult.latencyMs}ms)`);
      } else if (emailResult.error?.includes('no configurado')) {
        console.log(`  ⚪ email      → not configured`);
      } else {
        console.log(`  ❌ email      → FAILED: ${emailResult.error}`);
      }

      // Probar slack
      const slackResult = await sendSlack({ body: 'Test Slack', priority: 'normal' });
      if (slackResult.success) {
        console.log(`  ✅ slack      → OK (${slackResult.latencyMs}ms)`);
      } else if (slackResult.error?.includes('no configurado')) {
        console.log(`  ⚪ slack      → not configured`);
      } else {
        console.log(`  ❌ slack      → FAILED: ${slackResult.error}`);
      }

      // Probar telegram
      const telegramResult = await sendTelegram({ body: 'Test Telegram' });
      if (telegramResult.success) {
        console.log(`  ✅ telegram   → OK (${telegramResult.latencyMs}ms)`);
      } else if (telegramResult.error?.includes('no configurados')) {
        console.log(`  ⚪ telegram   → not configured`);
      } else {
        console.log(`  ❌ telegram   → FAILED: ${telegramResult.error}`);
      }

      // Probar discord
      const discordResult = await sendDiscord({ body: 'Test Discord', priority: 'high' });
      if (discordResult.success) {
        console.log(`  ✅ discord    → OK (${discordResult.latencyMs}ms)`);
      } else if (discordResult.error?.includes('no configurado')) {
        console.log(`  ⚪ discord    → not configured`);
      } else {
        console.log(`  ❌ discord    → FAILED: ${discordResult.error}`);
      }

      // Probar webhook
      const webhookResult = await sendWebhook({ to: 'https://hook.example.com', body: 'Test Webhook' });
      if (webhookResult.success) {
        console.log(`  ✅ webhook    → OK (${webhookResult.latencyMs}ms)`);
      } else if (webhookResult.error?.includes('no proporcionada')) {
        console.log(`  ⚪ webhook    → not configured`);
      } else {
        console.log(`  ❌ webhook    → FAILED: ${webhookResult.error}`);
      }

      // Probar push
      const pushResult = await sendPush({
        provider: 'fcm',
        tokens: ['test-token'],
        title: 'Test Push',
        body: 'Test de push notification',
      });
      if (pushResult.success) {
        console.log(`  ✅ push (FCM) → OK (${pushResult.latencyMs}ms)`);
      } else if (pushResult.error?.includes('no configurado')) {
        console.log(`  ⚪ push (FCM) → not configured`);
      } else {
        console.log(`  ❌ push (FCM) → FAILED: ${pushResult.error}`);
      }

      // Probar notifyUser (Fase 5)
      console.log('\n--- Fase 5: notifyUser ---');
      const notifyResult = await notifyUser({
        userId: 'test-user',
        companyId: 'test-company',
        title: 'Test Fase 5',
        body: 'Notificación de prueba para Fase 5',
        context: { type: 'test' },
        priority: 'normal',
        source: 'test-all',
      });
      console.log(`  ${notifyResult.status === 'sent' ? '✅' : '❌'} notifyUser → ${notifyResult.status} (canal: ${notifyResult.channel || 'ninguno'})`);
      if (notifyResult.attempts.length > 0) {
        console.log(`    attempts: ${notifyResult.attempts.map(a => `${a.channel}=${a.status}`).join(', ')}`);
      }

      const configured = [consoleResult.success, directorResult.success, emailResult.success, slackResult.success, telegramResult.success, discordResult.success, webhookResult.success, pushResult.success].filter(Boolean).length;
      console.log(`\nSummary: ${configured}/8 configured`);
      process.exit(0);
    }

    const server = new AgentMCPServer({
      name: 'notification-agent',
      tools,
      engineFactory: (transport) => createEngine(transport) as unknown as AgentEngine,
    });

    await server.startStdio();
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
