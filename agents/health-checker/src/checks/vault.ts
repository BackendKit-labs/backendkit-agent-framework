// ---------------------------------------------------------------------------
// Check: Vault — verifica el estado del vault de codex (notas indexadas)
// ---------------------------------------------------------------------------

import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { getCached, setCache } from '../cache.js';
import type { VaultCheck } from '../types.js';

const CODEX_VAULT_PATH = process.env.CODEX_VAULT_PATH || resolve(homedir(), '.backendkit', 'vaults');

function resolvePath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return resolve(homedir(), filePath.slice(1));
  }
  return resolve(filePath);
}

export async function checkVault(): Promise<VaultCheck> {
  const cached = getCached<VaultCheck>('vault');
  if (cached) return cached;

  const resolvedPath = resolvePath(CODEX_VAULT_PATH);

  if (!existsSync(resolvedPath)) {
    const result: VaultCheck = { indexed: false, notes: 0 };
    setCache('vault', result);
    return result;
  }

  try {
    const entries = readdirSync(resolvedPath, { recursive: true });
    const notes = entries.filter((e) => typeof e === 'string' && (e.endsWith('.md') || e.endsWith('.json'))).length;
    const result: VaultCheck = { indexed: notes > 0, notes };
    setCache('vault', result);
    return result;
  } catch {
    const result: VaultCheck = { indexed: false, notes: 0 };
    setCache('vault', result);
    return result;
  }
}
