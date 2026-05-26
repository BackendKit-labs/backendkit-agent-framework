import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { AgentProfile } from '@bk/agent-core';

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
            const prompt = readFileSync(join(dir, file), 'utf-8').trim();
            if (prompt) merged.set(id, { ...agent, systemPrompt: prompt });
        } catch { /* skip */ }
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

            // .md overrides systemPrompt in json
            const mdPath = join(dir, `${basename(file, '.json')}.md`);
            const systemPrompt = existsSync(mdPath)
                ? readFileSync(mdPath, 'utf-8').trim()
                : def.systemPrompt ?? '';

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

        const globalDir  = join(homedir(), `.${appName}`, 'agents');
        const projectDir = join(cwd, `.${appName}`, 'agents');

        // Ensure directories exist for discoverability
        mkdirSync(globalDir,  { recursive: true });
        mkdirSync(projectDir, { recursive: true });

        const builtins = (opts.builtins ?? []).map(a => ({ ...a, source: 'builtin' as const }));
        const globals  = readAgentDir(globalDir,  'global');
        const project  = readAgentDir(projectDir, 'project');

        // Merge: builtins first, then override with global, then project
        const merged = new Map<string, AgentProfile>();
        for (const a of [...builtins, ...globals, ...project]) {
            merged.set(a.id, a);
        }

        // Apply .md-only prompt overrides (no .json counterpart)
        for (const dir of [globalDir, projectDir]) {
            applyPromptOverrides(dir, merged);
        }

        return Array.from(merged.values());
    }

    /** Return paths where agents can be defined */
    static dirs(appName = 'bk-agent', cwd = process.cwd()) {
        return {
            global:  join(homedir(), `.${appName}`, 'agents'),
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
            ? join(homedir(), `.${appName}`, 'agents')
            : join(cwd, `.${appName}`, 'agents');

        mkdirSync(dir, { recursive: true });

        const meta: AgentFileDefinition = {
            id: agentId,
            name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
            icon: '◇',
            description: `${agentId} specialist`,
            allowedTools: ['read_file', 'list_directory', 'search_files', 'save_context', 'append_log'],
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
