import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'crypto';
import { resolve } from 'path';
import { homedir } from 'os';

const DATA_DIR = process.env.CONFIG_DATA_DIR || resolve(homedir(), '.backendkit', 'config');
const SECRETS_DIR = resolve(DATA_DIR, 'secrets');
const MASTER_KEY_FILE = resolve(SECRETS_DIR, 'master.key');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const TAG_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 32; // 256 bits
const PBKDF2_DIGEST = 'sha512';
const PBKDF2_SALT = 'config-agent-key-derivation-salt-v1';

function ensureDir(): void {
  if (!existsSync(SECRETS_DIR)) mkdirSync(SECRETS_DIR, { recursive: true });
}

function getMasterKey(): Buffer {
  ensureDir();

  // Usar env var si está disponible (prioridad)
  const envKey = process.env.CONFIG_MASTER_KEY;
  if (envKey) {
    return Buffer.from(envKey.padEnd(KEY_LENGTH * 2, '0').slice(0, KEY_LENGTH * 2), 'hex');
  }

  // Generar o leer master.key
  if (!existsSync(MASTER_KEY_FILE)) {
    const key = randomBytes(KEY_LENGTH);
    writeFileSync(MASTER_KEY_FILE, key.toString('hex'), 'utf-8');
    console.warn('[config-agent] ⚠️ Master key generada y guardada en disco.');
    console.warn('[config-agent] ⚠️ Para producción, usa CONFIG_MASTER_KEY env var.');
    return key;
  }

  // Leer master.key y derivar con PBKDF2
  const rawKey = readFileSync(MASTER_KEY_FILE, 'utf-8').trim();
  const keyMaterial = Buffer.from(rawKey, 'hex');
  return pbkdf2Sync(keyMaterial, PBKDF2_SALT, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
}

function secretsPath(agentId: string): string {
  return resolve(SECRETS_DIR, `${agentId}.json`);
}

export function encryptValue(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  // Formato: iv:tag:encrypted (todo en hex)
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

export function decryptValue(encrypted: string): string {
  const key = getMasterKey();
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedText, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

export function readSecrets(agentId: string): Record<string, string> {
  const path = secretsPath(agentId);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

export function writeSecret(agentId: string, key: string, value: string): void {
  ensureDir();
  const secrets = readSecrets(agentId);
  secrets[key] = encryptValue(value);
  writeFileSync(secretsPath(agentId), JSON.stringify(secrets, null, 2), 'utf-8');
}

export function readSecret(agentId: string, key: string): string | null {
  const secrets = readSecrets(agentId);
  const encrypted = secrets[key];
  if (!encrypted) return null;
  try {
    return decryptValue(encrypted);
  } catch {
    return null;
  }
}

export function hasMasterKey(): boolean {
  return !!process.env.CONFIG_MASTER_KEY || existsSync(MASTER_KEY_FILE);
}
