import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { getFrameworkDir } from '@backendkit-labs/agent-core';
import { isProjectTrusted } from '../cli/trust/workspace-trust';
import type { AgentProfile } from '@backendkit-labs/agent-core';

// ── Agent file format ─────────────────────────────────────────────────────────
// Each agent is defined by a pair of files:
//   {id}.json  — metadata (required)
//   {id}.md    — system prompt (optional, overrides json.systemPrompt)

interface AgentFileDefinition {
    id: string;
    name: string;
    icon: string;
    description: string;
    systemPrompt?: string;
    allowedTools: string[];
    delegatesTo?: string[];
    provider?: string;
    suppressDefaultOutput?: boolean;
}

interface MdFrontmatter {
    name?: string;
    icon?: string;
    description?: string;
    provider?: string;
    model?: string;
}

function parseMd(raw: string): { frontmatter: MdFrontmatter; body: string } {
    const fm: MdFrontmatter = {};
    let body = raw.trim();

    if (body.startsWith('---')) {
        const end = body.indexOf('\n---', 3);
        if (end !== -1) {
            const block = body.slice(3, end).trim();
            for (const line of block.split('\n')) {
                const colon = line.indexOf(':');
                if (colon === -1) continue;
                const key = line.slice(0, colon).trim();
                const val = line.slice(colon + 1).trim();
                (fm as Record<string, string>)[key] = val;
            }
            body = body.slice(end + 4).trim();
        }
    }

    return { frontmatter: fm, body };
}

function applyPromptOverrides(dir: string, merged: Map<string, AgentProfile>): void {
    if (!existsSync(dir)) return;
    const mdOnlyFiles = readdirSync(dir)
        .filter(f => f.endsWith('.md') && f !== 'README.md')
        .filter(f => !existsSync(join(dir, f.replace(/\.md$/, '.json'))));

    for (const file of mdOnlyFiles) {
        const id = basename(file, '.md');
        const agent = merged.get(id);
        if (!agent) continue;
        try {
            const raw = readFileSync(join(dir, file), 'utf-8');
            const { frontmatter: fm, body } = parseMd(raw);
            if (!body) continue;
            merged.set(id, {
                ...agent,
                ...(fm.name        && { name: fm.name }),
                ...(fm.icon        && { icon: fm.icon }),
                ...(fm.description && { description: fm.description }),
                ...(fm.provider    && { provider: fm.provider }),
                ...(fm.model       && { provider: fm.model }),  // model maps to provider
                systemPrompt: body,
            });
        } catch (err) {
            console.warn(`[AgentLoader] Could not apply .md override for "${id}": ${(err as Error).message}`);
        }
    }
}

function readAgentDir(dir: string, source: AgentProfile['source']): AgentProfile[] {
    if (!existsSync(dir)) return [];

    const jsonFiles = readdirSync(dir).filter(f => f.endsWith('.json'));
    const profiles: AgentProfile[] = [];

    for (const file of jsonFiles) {
        try {
            const raw = readFileSync(join(dir, file), 'utf-8');
            const def = JSON.parse(raw) as AgentFileDefinition;

            // .md overrides systemPrompt (and optionally profile fields) from json
            const mdPath = join(dir, `${basename(file, '.json')}.md`);
            let systemPrompt = def.systemPrompt ?? '';
            if (existsSync(mdPath)) {
                const { frontmatter: fm, body } = parseMd(readFileSync(mdPath, 'utf-8'));
                systemPrompt = body || systemPrompt;
                if (fm.name)        def.name = fm.name;
                if (fm.icon)        def.icon = fm.icon;
                if (fm.description) def.description = fm.description;
                if (fm.provider)    def.provider = fm.provider;
                if (fm.model)       def.provider = fm.model;
            }

            if (!systemPrompt) {
                console.warn(`[AgentLoader] Agent "${def.id}" has no system prompt — skipped`);
                continue;
            }

            profiles.push({ ...def, systemPrompt, source });
        } catch (err) {
            console.warn(`[AgentLoader] Could not load "${file}": ${(err as Error).message}`);
        }
    }

    return profiles;
}

export interface AgentLoaderOptions {
    appName?: string;
    cwd?: string;
    builtins?: AgentProfile[];
    /**
     * Whether the project layer (`{cwd}/.{appName}/agents`) may load. Default: asked of the workspace trust
     * (ADR-0006), i.e. true only for a project the user trusted or with BK_TRUST_PROJECT=1. Pass it when the host
     * has already decided, so the answer is the same everywhere it matters.
     */
    trusted?: boolean;
}

export class AgentLoader {
    /**
     * Load agents with priority: project > global > builtins
     * Returns merged array ready to register in AgentRegistry.
     *
     * A directory can contain:
     *   {id}.json + {id}.md  — full agent definition (json profile + md system prompt)
     *   {id}.json only       — full agent definition (system prompt inside json)
     *   {id}.md only         — system prompt override for a built-in with the same id
     */
    static load(opts: AgentLoaderOptions = {}): AgentProfile[] {
        const appName = opts.appName ?? 'bk-agent';
        const cwd = opts.cwd ?? process.cwd();

        // Same home directory as the rest of the framework (getFrameworkDir), so trust and agents agree on it.
        const globalDir  = join(getFrameworkDir(appName), 'agents');
        const projectDir = join(cwd, `.${appName}`, 'agents');

        // The project layer is the repository's own content: it loads only when the project is trusted (ADR-0006).
        // The .md overrides of built-ins are part of it, so an untrusted repo cannot rewrite a built-in prompt either.
        const trusted = opts.trusted ?? isProjectTrusted(appName, cwd).trusted;

        // Ensure directories exist for discoverability. Never create anything inside a project that is not trusted.
        mkdirSync(globalDir,  { recursive: true });
        if (trusted) mkdirSync(projectDir, { recursive: true });

        const builtins = (opts.builtins ?? []).map(a => ({ ...a, source: 'builtin' as const }));
        const globals  = readAgentDir(globalDir,  'global');
        const project  = trusted ? readAgentDir(projectDir, 'project') : [];

        // Merge: builtins first, then override with global, then project
        const merged = new Map<string, AgentProfile>();
        for (const a of [...builtins, ...globals, ...project]) {
            merged.set(a.id, a);
        }

        // Apply .md-only prompt overrides (no .json counterpart)
        for (const dir of trusted ? [globalDir, projectDir] : [globalDir]) {
            applyPromptOverrides(dir, merged);
        }

        return Array.from(merged.values());
    }

    /** Return paths where agents can be defined */
    static dirs(appName = 'bk-agent', cwd = process.cwd()) {
        return {
            global:  join(getFrameworkDir(appName), 'agents'),
            project: join(cwd, `.${appName}`, 'agents'),
        };
    }

    /**
     * Generate a starter JSON + MD pair for a new agent.
     * Writes to the project agents directory.
     */
    static scaffold(agentId: string, opts: { appName?: string; cwd?: string; scope?: 'global' | 'project' } = {}): void {
        const appName = opts.appName ?? 'bk-agent';
        const cwd     = opts.cwd ?? process.cwd();
        const scope   = opts.scope ?? 'project';
        const dir     = scope === 'global'
            ? join(getFrameworkDir(appName), 'agents')
            : join(cwd, `.${appName}`, 'agents');

        mkdirSync(dir, { recursive: true });

        const meta: AgentFileDefinition = {
            id: agentId,
            name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
            icon: '◇',
            description: `${agentId} specialist`,
            allowedTools: ['read_file', 'list_directory', 'search_files', 'save_context'],
            delegatesTo: ['coder'],
        };

        const jsonPath = join(dir, `${agentId}.json`);
        const mdPath   = join(dir, `${agentId}.md`);

        if (!existsSync(jsonPath)) {
            writeFileSync(jsonPath, JSON.stringify(meta, null, 2), 'utf-8');
        }
        if (!existsSync(mdPath)) {
            writeFileSync(mdPath, `You are a ${agentId} specialist.\n\nYour responsibilities:\n- `, 'utf-8');
        }

        console.log(`[AgentLoader] Scaffolded ${scope} agent "${agentId}" at ${dir}`);
    }
}
