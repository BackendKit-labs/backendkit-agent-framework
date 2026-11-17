/**
 * The sample vault ships in `vault/`. Agents can write into a vault (`write_knowledge`), so every run works on a
 * throwaway copy in the temp folder and the sample stays as it is.
 */
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const SAMPLE_VAULT = resolve(__dirname, '..', 'vault');

export interface Workspace {
  /** The copy of the vault the agents see. */
  vaultPath: string;
  /** Where the search indexes are kept. */
  indexDir: string;
  /** Where per-session memory is kept. */
  sessionsDir: string;
}

export function makeWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'vault-pilot-'));
  const vaultPath = join(root, 'vault');
  cpSync(SAMPLE_VAULT, vaultPath, { recursive: true });
  return { vaultPath, indexDir: join(root, 'index'), sessionsDir: join(root, 'sessions') };
}
