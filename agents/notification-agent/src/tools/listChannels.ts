// ---------------------------------------------------------------------------
// Tool: list_channels
// ---------------------------------------------------------------------------

export async function handler(): Promise<string> {
  const channels = [
    { name: 'console', configured: true, type: 'pull' as const },
    { name: 'director', configured: true, type: 'pull' as const },
    { name: 'email', configured: !!process.env.SMTP_HOST, type: 'push' as const },
    { name: 'slack', configured: !!process.env.SLACK_WEBHOOK_URL, type: 'push' as const },
    { name: 'telegram', configured: !!process.env.TELEGRAM_BOT_TOKEN, type: 'push' as const },
    { name: 'discord', configured: !!process.env.DISCORD_WEBHOOK_URL, type: 'push' as const },
    { name: 'webhook', configured: true, type: 'push' as const },
    { name: 'push', configured: !!(process.env.FCM_SERVER_KEY || process.env.EXPO_ACCESS_TOKEN || process.env.ONESIGNAL_APP_ID), type: 'push' as const },
  ];

  return JSON.stringify({ channels });
}
