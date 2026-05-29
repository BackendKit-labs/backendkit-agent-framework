export interface MCPServerConfig {
    /** Human-readable identifier used to namespace tool names: mcp:{name}:{tool} */
    name: string;
    /** Executable to spawn (e.g. 'node', 'npx', 'python') */
    command: string;
    /** Arguments to the command (e.g. ['@modelcontextprotocol/server-github']) */
    args?: string[];
    /** Extra environment variables merged with process.env */
    env?: Record<string, string>;
    /** Timeout for individual tool calls in ms. Default: 30 000 */
    timeoutMs?: number;
}
