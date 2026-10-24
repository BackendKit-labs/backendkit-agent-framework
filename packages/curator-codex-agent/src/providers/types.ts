export interface CompleteOptions {
    /**
     * Force structured JSON output (default: true).
     * Set to false for free-form text/markdown responses (e.g. synthesis).
     */
    json?: boolean;
}

/**
 * Longest one completion may take. Long enough for a reasoning model writing a full answer, short enough that a
 * stalled connection fails the curation step instead of holding it for the SDK's own default (10 minutes, per retry).
 */
export const DEFAULT_COMPLETION_TIMEOUT_MS = 300_000;

export interface CuratorLLMProvider {
    complete(systemPrompt: string, userMessage: string, opts?: CompleteOptions): Promise<string>;
}
