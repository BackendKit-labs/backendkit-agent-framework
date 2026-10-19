import * as path from 'node:path';

/** Package root (works from both src/ via tsx and dist/). */
const PKG_ROOT = path.resolve(__dirname, '..');

export interface Config {
    ollamaBaseUrl: string;
    modelName: string;
    embedModel: string;
    dbPath: string;
    logPath: string;
    /** Max chars of alert text forwarded to the LLM / logs. */
    maxAlertChars: number;
    llmTimeoutMs: number;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Build config from environment. No secrets are read or required. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const cfg: Config = {
        ollamaBaseUrl: (env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434').replace(/\/$/, ''),
        modelName: env['MODEL_NAME'] ?? 'llama3.2:3b',
        embedModel: env['EMBED_MODEL'] ?? 'nomic-embed-text',
        dbPath: env['DB_PATH'] ?? path.join(PKG_ROOT, 'data', 'aiops.db'),
        logPath: env['LOG_PATH'] ?? path.join(PKG_ROOT, 'logs', 'decisions.jsonl'),
        maxAlertChars: 2000,
        llmTimeoutMs: Number(env['LLM_TIMEOUT_MS'] ?? 120_000),
    };
    assertLocalOllama(cfg.ollamaBaseUrl, env['ALLOW_REMOTE_OLLAMA'] === '1');
    return cfg;
}

/** Security (T-09): refuse non-local Ollama unless explicitly allowed. */
export function assertLocalOllama(baseUrl: string, allowRemote: boolean): void {
    let host: string;
    try {
        host = new URL(baseUrl).hostname;
    } catch {
        throw new Error(`OLLAMA_BASE_URL inválida: ${baseUrl}`);
    }
    if (!allowRemote && !LOCAL_HOSTS.has(host)) {
        throw new Error(
            `OLLAMA_BASE_URL apunta a un host no local (${host}). ` +
            `Define ALLOW_REMOTE_OLLAMA=1 si es intencional.`,
        );
    }
}
