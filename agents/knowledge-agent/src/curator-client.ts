/**
 * Cliente MCP minimo del servidor curator (HTTP, transporte StreamableHTTP).
 *
 * Vivia en el paquete @backendkit-labs/curator-agent, que se elimino por obsoleto (22dfd958); knowledge-agent lo
 * seguia importando y no compilaba. Se conserva aca SOLO lo que usa el REPL (/research de un tema o de una URL), con
 * el mismo protocolo: las herramientas curator_research y curator_research_url del servidor en `${url}/mcp`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface ProcessResult {
    written: string[];
    skipped: string[];
    enriched: string[];
    errors: string[];
    durationMs: number;
}

export class CuratorClient {
    private readonly serverUrl: string;

    constructor(serverUrl: string) {
        this.serverUrl = serverUrl.replace(/\/$/, '');
    }

    research(topic: string): Promise<ProcessResult> {
        return this.call('curator_research', { topic });
    }

    researchUrl(url: string): Promise<ProcessResult> {
        return this.call('curator_research_url', { url });
    }

    private async call(toolName: string, args: Record<string, unknown>): Promise<ProcessResult> {
        const client = new Client({ name: 'curator-client', version: '1.0.0' }, { capabilities: {} });
        const transport = new StreamableHTTPClientTransport(new URL(`${this.serverUrl}/mcp`));
        let text = '';
        try {
            await client.connect(transport);
            const result = await client.callTool({ name: toolName, arguments: args });
            const content = result.content as Array<{ type: string; text?: string }>;
            text = content.find(c => c.type === 'text')?.text ?? '';
        } finally {
            await client.close().catch(() => {});
        }
        try {
            return JSON.parse(text) as ProcessResult;
        } catch {
            // un error del servidor que no es JSON se devuelve como error, no se pierde
            return { written: [], skipped: [], enriched: [], errors: [text], durationMs: 0 };
        }
    }
}
