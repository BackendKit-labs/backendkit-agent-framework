import 'dotenv/config';

export interface Config {
    ollamaHost:     string;
    ollamaModel:    string;
    embeddingModel: string;
    vaultPath:      string;
}

export function loadConfig(): Config {
    const vaultPath = process.env.VAULT_PATH ?? '';
    if (!vaultPath) throw new Error('Missing VAULT_PATH in .env — set the absolute path to your Obsidian vault');

    return {
        ollamaHost:     process.env.OLLAMA_HOST     ?? 'http://localhost:11434',
        ollamaModel:    process.env.OLLAMA_MODEL    ?? 'llama3.2',
        embeddingModel: process.env.EMBEDDING_MODEL ?? 'nomic-embed-text',
        vaultPath,
    };
}
