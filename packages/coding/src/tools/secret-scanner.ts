/**
 * Non-blocking secret detection for agent write paths.
 *
 * Logs a console.warn when content appears to contain credentials.
 * Does NOT block the write — legitimate code examples may match patterns.
 * The warning is surfaced to the developer/operator, not exposed to the LLM.
 */

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
    { name: 'Anthropic API key',     pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
    { name: 'OpenAI API key',        pattern: /sk-(?!ant-)[a-zA-Z0-9]{32,}/ },
    { name: 'AWS Access Key ID',     pattern: /AKIA[A-Z0-9]{16}/ },
    { name: 'GitHub token (PAT)',    pattern: /ghp_[a-zA-Z0-9]{36}/ },
    { name: 'GitLab token',          pattern: /glpat-[a-zA-Z0-9_-]{20}/ },
    { name: 'Private key block',     pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'Generic secret value',  pattern: /(?:password|secret|apiKey|api_key|auth_token)\s*[:=]\s*["']?[a-zA-Z0-9+\/=_-]{24,}["']?/i },
];

/**
 * Scan content for potential secrets. Returns matched pattern names (empty if clean).
 * The caller decides what to do with the findings (typically log a warning).
 */
export function scanForSecrets(content: string): string[] {
    const found: string[] = [];
    for (const { name, pattern } of SECRET_PATTERNS) {
        if (pattern.test(content)) found.push(name);
    }
    return found;
}

/** Log a non-blocking warning when secrets are detected. Always logs to stderr. */
export function warnIfSecrets(filePath: string, content: string): string | undefined {
    const matches = scanForSecrets(content);
    if (matches.length === 0) return undefined;
    const msg =
        `[SecretScanner] ⚠ Potential secret(s) detected in "${filePath}": ` +
        `${matches.join(', ')}. ` +
        `Verify this is intentional and never commit secrets to version control.`;
    console.warn(msg);
    return msg;
}
