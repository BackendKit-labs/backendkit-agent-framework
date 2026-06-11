import * as path from 'path';
import * as os from 'os';
import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    createMemorySystem,
    defineTool,
    z,
} from '@backendkit-labs/agent-core';
import type { Transport, AgentProfile } from '@backendkit-labs/agent-core';
import { ObsidianRAGProvider } from './rag/ObsidianRAGProvider';
import type { Embedder } from './rag/ObsidianRAGProvider';
import { VaultWriter } from './rag/VaultWriter';
import { SimpleEmbedder } from './rag/SimpleEmbedder';
import {
    ALL_ENTERPRISE_PROFILES,
    ENTERPRISE_TOOLS,
    VAULT_FOLDERS,
} from './profiles';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnterpriseSetupOptions {
    /** Absolute path to the shared Obsidian vault. */
    vaultPath: string;
    /** Directory where RAG index files are stored. Default: ~/.bk-agent/rag/enterprise/ */
    indexDir?: string;
    /** Embedder to use. Default: SimpleEmbedder (no Ollama required). */
    embedder?: Embedder;
    /** Pre-configured ProviderRegistry with at least one LLM provider. */
    providers: ProviderRegistry;
    /** Default provider ID to use when no per-agent override is set. */
    defaultProvider: string;
    /** Directory for per-session memory files. Default: ~/.bk-agent/sessions/ */
    sessionsDir?: string;
    /** Additional AgentProfiles to register alongside the 6 enterprise defaults. */
    extraProfiles?: AgentProfile[];
    /** Max iterations per engine run. Default: 20. */
    maxIterations?: number;
}

export interface EnterpriseSetup {
    /** Call once at startup to index all vault folders. */
    indexAll(opts?: { verbose?: boolean }): Promise<void>;
    /** EngineFactory compatible with AgentServer from @backendkit-labs/agent-web. */
    engineFactory: (sessionId: string, transport: Transport) => AgentEngine;
}

// ── Department RAG config ─────────────────────────────────────────────────────

const DEPT_CONFIGS: Array<{ toolName: string; folders: string[] }> = [
    { toolName: ENTERPRISE_TOOLS.SEARCH_SUPPORT,  folders: [VAULT_FOLDERS.SUPPORT,  VAULT_FOLDERS.GENERAL, VAULT_FOLDERS.POLICIES] },
    { toolName: ENTERPRISE_TOOLS.SEARCH_HR,       folders: [VAULT_FOLDERS.HR,       VAULT_FOLDERS.GENERAL, VAULT_FOLDERS.POLICIES] },
    { toolName: ENTERPRISE_TOOLS.SEARCH_SALES,    folders: [VAULT_FOLDERS.SALES,    VAULT_FOLDERS.GENERAL, VAULT_FOLDERS.POLICIES] },
    { toolName: ENTERPRISE_TOOLS.SEARCH_FINANCE,  folders: [VAULT_FOLDERS.FINANCE,  VAULT_FOLDERS.GENERAL, VAULT_FOLDERS.POLICIES] },
    { toolName: ENTERPRISE_TOOLS.SEARCH_OPS,      folders: [VAULT_FOLDERS.OPS,      VAULT_FOLDERS.GENERAL, VAULT_FOLDERS.POLICIES] },
];

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Creates a fully-wired enterprise setup with:
 * - One RAG instance per department (scoped to its vault folders)
 * - One global RAG for the General agent
 * - VaultWriter shared across all agents
 * - EngineFactory that creates a new AgentEngine per WebSocket session
 *
 * Usage:
 * ```ts
 * const enterprise = createEnterpriseSetup({ vaultPath, providers, defaultProvider });
 * await enterprise.indexAll();
 *
 * const server = new AgentServer({ port: 3000, engineFactory: enterprise.engineFactory, cors: '*' });
 * await server.start();
 * ```
 */
export function createEnterpriseSetup(opts: EnterpriseSetupOptions): EnterpriseSetup {
    const embedder  = opts.embedder ?? new SimpleEmbedder();
    const indexDir  = opts.indexDir  ?? path.join(os.homedir(), '.bk-agent', 'rag', 'enterprise');
    const sessionsDir = opts.sessionsDir ?? path.join(os.homedir(), '.bk-agent', 'sessions');

    // ── Shared RAG instances (one per department + one global) ───────────────

    const globalRAG = new ObsidianRAGProvider({
        vaultPath:  opts.vaultPath,
        indexPath:  path.join(indexDir, 'global.json'),
        embedder,
        topK: 5,
        minScore: 0.1,
    });

    const deptRAGs = new Map<string, ObsidianRAGProvider>(
        DEPT_CONFIGS.map(({ toolName, folders }) => [
            toolName,
            new ObsidianRAGProvider({
                vaultPath: opts.vaultPath,
                folders,
                indexPath: path.join(indexDir, `${folders[0]}.json`),
                embedder,
                topK: 5,
                minScore: 0.1,
            }),
        ])
    );

    // ── Shared VaultWriter ───────────────────────────────────────────────────

    const writer = new VaultWriter({ vaultPath: opts.vaultPath });

    // ── Index all ────────────────────────────────────────────────────────────

    async function indexAll(indexOpts: { verbose?: boolean } = {}): Promise<void> {
        const all = [globalRAG, ...deptRAGs.values()];
        await Promise.all(all.map(rag => rag.index(indexOpts)));
    }

    // ── Engine factory ────────────────────────────────────────────────────────

    function engineFactory(sessionId: string, transport: Transport): AgentEngine {
        const tools = new ToolRegistry();

        // Global search (General agent)
        tools.register(globalRAG.createTool());

        // Department search tools
        for (const [toolName, rag] of deptRAGs) {
            const deptRag = rag;
            tools.register(
                defineTool({
                    name: toolName,
                    description: `Search the ${toolName.replace('search_', '').replace('_kb', '')} department knowledge base.`,
                    input: z.object({
                        query: z.string().describe('What to search for'),
                    }),
                    execute: async ({ query }) => deptRag.search(query),
                })
            );
        }

        // Write to vault
        tools.register(writer.createTool('general'));

        // Agents
        const agents = new AgentRegistry();
        const profiles = [...ALL_ENTERPRISE_PROFILES, ...(opts.extraProfiles ?? [])];
        for (const profile of profiles) agents.register(profile);

        // Per-session memory
        const memory = createMemorySystem({
            episodic:   { provider: 'json', path: path.join(sessionsDir, sessionId, 'ep.json') },
            semantic:   { provider: 'json', path: path.join(sessionsDir, sessionId, 'sem.json') },
            procedural: { provider: 'json', path: path.join(sessionsDir, sessionId, 'proc.json') },
            retention:  { maxEpisodes: 100 },
        });

        return new AgentEngine({
            model:           { provider: opts.defaultProvider, id: '' },
            agents,
            tools,
            providers:       opts.providers,
            defaultProvider: opts.defaultProvider,
            defaultAgentId:  'general',
            transport,
            maxIterations:   opts.maxIterations ?? 20,
            iterationMode:   'auto',
            memorySystem:    memory,
            sessionId,
        });
    }

    return { indexAll, engineFactory };
}
