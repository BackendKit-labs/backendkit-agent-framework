import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import type { ConfigSchema } from '../types/schema.js';

const DATA_DIR = process.env.CONFIG_DATA_DIR || resolve(homedir(), '.backendkit', 'config');
const SCHEMAS_DIR = resolve(DATA_DIR, 'schemas');

function ensureDir(): void {
  if (!existsSync(SCHEMAS_DIR)) mkdirSync(SCHEMAS_DIR, { recursive: true });
}

function schemaPath(agentId: string): string {
  return resolve(SCHEMAS_DIR, `${agentId}.json`);
}

export function readSchema(agentId: string): ConfigSchema | null {
  const path = schemaPath(agentId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ConfigSchema;
  } catch {
    return null;
  }
}

export function writeSchema(agentId: string, schema: ConfigSchema): void {
  ensureDir();
  writeFileSync(schemaPath(agentId), JSON.stringify(schema, null, 2), 'utf-8');
}

export function deleteSchema(agentId: string): void {
  const path = schemaPath(agentId);
  if (existsSync(path)) {
    try {
      writeFileSync(path, JSON.stringify({ deleted: true, deletedAt: new Date().toISOString() }), 'utf-8');
    } catch { /* ignore */ }
  }
}

export function listSchemas(): string[] {
  ensureDir();
  try {
    return readdirSync(SCHEMAS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch {
    return [];
  }
}
