// ---------------------------------------------------------------------------
// Storage: Config — configuración global persistente
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const DATA_DIR = process.env.NOTIFIER_DATA_DIR || resolve(homedir(), '.backendkit', 'notifier');
const CONFIG_PATH = resolve(DATA_DIR, 'config.json');

export interface NotifierConfig {
  channels: {
    email: { host?: string; port: number; user?: string; from: string }
    slack: { webhookUrl?: string }
    telegram: { botToken?: string; chatId?: string }
    discord: { webhookUrl?: string }
    push: { fcmKey?: string; expoToken?: string; onesignalAppId?: string; onesignalKey?: string }
  }
  defaults: {
    priority: string
    maxRetries: number
    retryDelayMs: number
  }
  scheduler: { url: string }
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig(): NotifierConfig {
  try {
    ensureDir();
    if (!existsSync(CONFIG_PATH)) return buildDefaultConfig();
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return buildDefaultConfig();
  }
}

function buildDefaultConfig(): NotifierConfig {
  return {
    channels: {
      email: {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        user: process.env.SMTP_USER,
        from: process.env.SMTP_FROM || 'noreply@notification-agent',
      },
      slack: { webhookUrl: process.env.SLACK_WEBHOOK_URL },
      telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID },
      discord: { webhookUrl: process.env.DISCORD_WEBHOOK_URL },
      push: {
        fcmKey: process.env.FCM_SERVER_KEY,
        expoToken: process.env.EXPO_ACCESS_TOKEN,
        onesignalAppId: process.env.ONESIGNAL_APP_ID,
        onesignalKey: process.env.ONESIGNAL_API_KEY,
      },
    },
    defaults: {
      priority: 'normal',
      maxRetries: 3,
      retryDelayMs: 10000,
    },
    scheduler: { url: process.env.SCHEDULER_URL || 'http://localhost:3100' },
  };
}

export function saveConfig(config: NotifierConfig): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// Singleton: se carga una vez al startup
let _config: NotifierConfig | null = null;

export function getConfig(): NotifierConfig {
  if (!_config) {
    _config = loadConfig();
    saveConfig(_config); // Persistir la config inicial
  }
  return _config;
}
