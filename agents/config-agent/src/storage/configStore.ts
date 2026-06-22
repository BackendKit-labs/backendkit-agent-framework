import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const DATA_DIR = process.env.CONFIG_DATA_DIR || resolve(homedir(), '.backendkit', 'config');
const CONFIG_PATH = resolve(DATA_DIR, 'config-agent.json');

export interface AgentConfig {
  version: string
  settings: {
    autoDetectEnv: boolean
    autoValidate: boolean
    uiPort: number
    uiTheme: 'light' | 'dark'
    uiAutoOpen: boolean
  }
  updatedAt: string
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function defaultConfig(): AgentConfig {
  return {
    version: '1.0.0',
    settings: {
      autoDetectEnv: process.env.CONFIG_AUTO_DETECT_ENV !== 'false',
      autoValidate: process.env.CONFIG_AUTO_VALIDATE !== 'false',
      uiPort: parseInt(process.env.CONFIG_UI_PORT || '3456', 10),
      uiTheme: (process.env.CONFIG_UI_THEME as 'light' | 'dark') || 'light',
      uiAutoOpen: process.env.CONFIG_UI_AUTO_OPEN === 'true',
    },
    updatedAt: new Date().toISOString(),
  };
}

export function readAgentConfig(): AgentConfig {
  ensureDir();
  if (!existsSync(CONFIG_PATH)) {
    const cfg = defaultConfig();
    writeAgentConfig(cfg);
    return cfg;
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as AgentConfig;
  } catch {
    return defaultConfig();
  }
}

export function writeAgentConfig(config: AgentConfig): void {
  ensureDir();
  config.updatedAt = new Date().toISOString();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateAgentSetting(key: string, value: any): AgentConfig {
  const config = readAgentConfig();
  (config.settings as any)[key] = value;
  writeAgentConfig(config);
  return config;
}
