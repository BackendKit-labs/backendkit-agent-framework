#!/usr/bin/env node
/**
 * Vault Manager Agent — MCP server wrapping the vault-manager HTTP API.
 *
 * vault-manager (:3000) is the knowledge management web app with human audit
 * loop, multi-vault support, and RAG search. This agent exposes its API as
 * MCP tools so the orchestrator can submit documents, search vaults, and
 * query the audit queue programmatically.
 *
 * Auth: vault-manager requires VAULT_MANAGER_SERVICE_KEY (a shared secret
 * added to vault-manager's env). Requests from this agent include the header
 *   X-Service-Key: <key>
 * vault-manager checks it before the NextAuth session on /api/* routes.
 *
 * Env vars:
 *   VAULT_MANAGER_URL         Base URL (default: http://localhost:3000)
 *   VAULT_MANAGER_SERVICE_KEY Shared secret (required — set on both sides)
 */

import 'dotenv/config';
import { McpServer }            from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z }                    from 'zod';

const BASE_URL    = (process.env.VAULT_MANAGER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SERVICE_KEY = process.env.VAULT_MANAGER_SERVICE_KEY ?? '';

const log = (msg: string) => process.stderr.write(`[vault-manager-agent] ${msg}\n`);

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function api(
    method:    string,
    path:      string,
    body?:     unknown,
    timeoutMs  = 30_000,
): Promise<unknown> {
    if (!SERVICE_KEY) throw new Error('VAULT_MANAGER_SERVICE_KEY is required');

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Service-Key': SERVICE_KEY,
    };

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body:   body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
        throw new Error(`vault-manager ${method} ${path} → HTTP ${res.status}: ${await res.text()}`);
    }

    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
}

const ok  = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const err = (e: unknown)    => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error).message ?? String(e)}` }] });

// ── MCP Server ────────────────────────────────────────────────────────────────

const srv = new McpServer({ name: '@backendkit-labs/vault-manager-agent', version: '0.1.0' });
// @ts-ignore
const t = srv.tool.bind(srv);

// ── Vaults ────────────────────────────────────────────────────────────────────

t('list_vaults',
    'List all active vaults in vault-manager with their ID, name, path, and owner role.',
    {},
    async () => { try { return ok(await api('GET', '/api/vaults')); } catch (e) { return err(e); } });

t('sync_vault',
    'Import all existing .md files from a vault path into vault-manager as approved audit items and reindex.',
    {
        vault_id: z.string().describe('Vault ID from list_vaults'),
    },
    async ({ vault_id }) => {
        try {
            return ok(await api('POST', `/api/vaults/${encodeURIComponent(vault_id)}/sync`, {}));
        } catch (e) { return err(e); }
    });

// ── Search ────────────────────────────────────────────────────────────────────

t('search_knowledge',
    'Semantic RAG search across one or all accessible vaults in vault-manager.',
    {
        query:    z.string().describe('Natural language search query'),
        vault_id: z.string().optional().describe('Restrict to a specific vault ID (omit to search all)'),
        top_k:    z.number().int().min(1).max(20).default(5),
    },
    async ({ query, vault_id, top_k }) => {
        try {
            const params = new URLSearchParams({ q: query, topK: String(top_k) });
            if (vault_id) params.set('vaultId', vault_id);
            return ok(await api('GET', `/api/search?${params}`));
        } catch (e) { return err(e); }
    });

// ── Notes ─────────────────────────────────────────────────────────────────────

t('list_notes',
    'List curated notes in a vault (approved audit items).',
    {
        vault_id: z.string().describe('Vault ID from list_vaults'),
        limit:    z.number().int().min(1).max(100).default(20),
    },
    async ({ vault_id, limit }) => {
        try {
            return ok(await api('GET', `/api/vaults/${encodeURIComponent(vault_id)}/notes?limit=${limit}`));
        } catch (e) { return err(e); }
    });

t('update_note',
    'Update the content or tags of a curated note.',
    {
        note_id: z.string().describe('Note ID from list_notes'),
        content: z.string().optional().describe('New markdown content'),
        tags:    z.array(z.string()).optional(),
    },
    async ({ note_id, content, tags }) => {
        try {
            return ok(await api('PATCH', `/api/notes/${encodeURIComponent(note_id)}`, { content, tags }));
        } catch (e) { return err(e); }
    });

// ── Audit queue ───────────────────────────────────────────────────────────────

t('ingest_text',
    'Submit a text document to vault-manager\'s human audit queue. An AI curator generates structured notes that a human then approves or rejects.',
    {
        vault_id:  z.string().describe('Target vault ID from list_vaults'),
        text:      z.string().describe('Document text content (markdown, plain text, or extracted PDF)'),
        file_name: z.string().describe('Original filename for reference (e.g. "politica-vacaciones.pdf")'),
        area_hint: z.enum(['rrhh','finanzas','operaciones','ventas','soporte','legal','calidad','general'])
                    .default('general').describe('Business area hint to guide the AI curator'),
    },
    async ({ vault_id, text, file_name, area_hint }) => {
        try {
            return ok(await api('POST', '/api/ingest', { vault_id, text, file_name, area_hint }, 60_000));
        } catch (e) { return err(e); }
    });

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
    if (!SERVICE_KEY) {
        log('WARNING: VAULT_MANAGER_SERVICE_KEY not set — all API calls will fail.');
        log('Set the same key in vault-manager env (VAULT_MANAGER_SERVICE_KEY) and here.');
    }
    log(`vault-manager: ${BASE_URL}`);

    const transport = new StdioServerTransport();
    await srv.connect(transport);
    log('MCP ready — tools: list_vaults, sync_vault, search_knowledge, list_notes, update_note, ingest_text');
}

main().catch(e => { log(`Fatal: ${(e as Error).message}`); process.exit(1); });
