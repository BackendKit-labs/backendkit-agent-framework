import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync, lstatSync } from 'fs';
import { resolve, join, basename } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import type { ConfigVersion, VersionChange } from '../types/version.js';

const DATA_DIR = process.env.CONFIG_DATA_DIR || resolve(homedir(), '.backendkit', 'config');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function agentsDir(agentId: string): string {
  return resolve(DATA_DIR, 'agents', agentId);
}

function currentPath(agentId: string): string {
  return resolve(agentsDir(agentId), 'current');
}

function versionFileName(version: string, message: string): string {
  const date = new Date().toISOString().split('T')[0];
  const safeMsg = message.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  return `v${version}__${date}_${safeMsg}.json`;
}

function parseVersionNumber(filename: string): number {
  const match = filename.match(/^v(\d+)__/);
  return match ? parseInt(match[1], 10) : 0;
}

function getCurrentVersion(agentId: string): string | null {
  const cp = currentPath(agentId);
  if (!existsSync(cp)) return null;
  try {
    const stat = lstatSync(cp);
    if (stat.isSymbolicLink()) {
      const target = readFileSync(cp, 'utf-8');
      return basename(target).replace(/\.json$/, '');
    }
  } catch {
    // Si falla el symlink, intentar leer como archivo
  }
  try {
    return readFileSync(cp, 'utf-8').trim();
  } catch {
    return null;
  }
}

function setCurrentVersion(agentId: string, filename: string): void {
  const dir = agentsDir(agentId);
  const cp = currentPath(agentId);
  const target = join(dir, filename);

  // Eliminar symlink/archivo anterior si existe
  try { unlinkSync(cp); } catch { /* ignore */ }

  // En Windows, crear archivo con el nombre de la versión (no symlink)
  // En Unix, crear symlink
  try {
    symlinkSync(target, cp);
  } catch {
    // Fallback: archivo con el nombre de la versión
    writeFileSync(cp, filename, 'utf-8');
  }
}

function calculateChecksum(config: Record<string, any>): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

export function readVersion(agentId: string, version?: string): ConfigVersion | null {
  const dir = agentsDir(agentId);
  if (!existsSync(dir)) return null;

  let versionId = version;
  if (!versionId || versionId === 'current') {
    const current = getCurrentVersion(agentId);
    if (!current) return null;
    versionId = current;
  }

  // Buscar archivo que coincida con la versión
  const files = readdirSync(dir).filter(f => f.startsWith(`${versionId}__`));
  if (files.length === 0) return null;

  try {
    const content = readFileSync(join(dir, files[0]), 'utf-8');
    return JSON.parse(content) as ConfigVersion;
  } catch {
    return null;
  }
}

export function writeVersion(
  agentId: string,
  config: Record<string, any>,
  changes: VersionChange[],
  message: string
): ConfigVersion {
  const dir = agentsDir(agentId);
  ensureDir(dir);

  // Determinar número de versión
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'current');
  const maxVersion = files.reduce((max, f) => Math.max(max, parseVersionNumber(f)), 0);
  const newVersionNum = maxVersion + 1;
  const versionId = `v${newVersionNum}`;

  const version: ConfigVersion = {
    version: versionId,
    createdAt: new Date().toISOString(),
    message,
    agent_id: agentId,
    config,
    changes,
    checksum: calculateChecksum(config),
  };

  const filename = versionFileName(versionId, message);
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(version, null, 2), 'utf-8');

  // Actualizar symlink/archivo current
  setCurrentVersion(agentId, filename);

  return version;
}

export function listVersions(agentId: string): { version: string; createdAt: string; message: string }[] {
  const dir = agentsDir(agentId);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'current')
    .sort((a, b) => parseVersionNumber(b) - parseVersionNumber(a));

  return files.map(f => {
    try {
      const content = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as ConfigVersion;
      return { version: content.version, createdAt: content.createdAt, message: content.message };
    } catch {
      return { version: f, createdAt: '', message: '' };
    }
  });
}

export function getCurrentVersionId(agentId: string): string | null {
  return getCurrentVersion(agentId);
}
