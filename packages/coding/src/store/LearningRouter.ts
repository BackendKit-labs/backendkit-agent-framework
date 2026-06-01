import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LearningType = 'tool_quirk' | 'skill' | 'project' | 'user' | 'session';
export type LearningScope = 'global' | 'project';
export type LLMFn = (prompt: string) => Promise<string>;

interface Classification {
    type:         LearningType;
    target_agent: string;
    skill_name:   string;
    scope:        LearningScope;
}

export interface RouterCtx {
    projectDir: string;
    homeDir:    string;
    llm:        LLMFn;
    /** Emit a compacting event to show progress bar in display */
    emit?: (phase: 'start' | 'done' | 'fail', label: string) => void;
}

export interface RouteResult {
    type:    LearningType;
    target:  string;
    skipped: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const KNOWN_AGENTS   = ['data','backend','frontend','infrastructure','qa-engineer','security','architecture','general'];
const MAX_NOTES_BYTES = 1_500;
const MAX_CTX_BYTES   = 4_000;
const MAX_USER_BYTES  = 2_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeRead(path: string): string {
    try { return readFileSync(path, 'utf-8').trim(); } catch { return ''; }
}

function safeWrite(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}

function parseJSON<T>(raw: string, fallback: T): T {
    try {
        const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
        return JSON.parse(json) as T;
    } catch { return fallback; }
}

// ── LLM helpers ───────────────────────────────────────────────────────────────

async function classify(content: string, llm: LLMFn): Promise<Classification> {
    const prompt = `Classify this learning and respond as JSON only (no markdown).

Categories:
- tool_quirk : specific behavior or limitation of a tool/library/framework
- skill      : reusable step-by-step process worth packaging as a reusable skill
- project    : architectural decision or project-specific fact
- user       : user preference or working style
- session    : ephemeral task info, not worth persisting

Fields required:
- type         : one of the categories
- target_agent : which agent owns this — one of: ${KNOWN_AGENTS.join(', ')}
- skill_name   : if type=skill, suggest a kebab-case name (else empty string "")
- scope        : "global" if applies to all projects | "project" if specific to this one

Learning: "${content.slice(0, 500)}"

JSON only:`;

    const raw = await llm(prompt).catch(() => '{}');
    return parseJSON<Classification>(raw, {
        type: 'tool_quirk', target_agent: 'general', skill_name: '', scope: 'global',
    });
}

async function isDuplicate(content: string, existing: string, llm: LLMFn): Promise<boolean> {
    if (!existing.trim()) return false;
    const prompt = `Does the new learning add any information not already present in the existing notes?
Existing (excerpt): "${existing.slice(0, 600)}"
New: "${content.slice(0, 300)}"
JSON only: {"is_duplicate": true or false}`;

    const raw = await llm(prompt).catch(() => '{"is_duplicate":false}');
    return parseJSON<{ is_duplicate: boolean }>(raw, { is_duplicate: false }).is_duplicate;
}

async function compact(content: string, maxBytes: number, label: string, ctx: RouterCtx): Promise<string> {
    ctx.emit?.('start', label);
    const prompt = `Compact these notes to under ${Math.floor(maxBytes / 2)} bytes. Keep all distinct facts. Remove redundancy. Output only the compacted text, no preamble:\n\n${content}`;
    const result = await ctx.llm(prompt).catch(() => content);
    ctx.emit?.('done', label);
    return result.trim();
}

async function generateSkillYaml(content: string, agent: string, name: string, llm: LLMFn): Promise<string> {
    const prompt = `Generate a YAML skill file. Output YAML only, no markdown fences.

name: ${name}
description: # one concise line
triggers: # comma-separated activation keywords
content: |
  # Step-by-step instructions derived from this learning

Learning: "${content.slice(0, 500)}"
Target agent: ${agent}`;

    const raw = await llm(prompt).catch(() => '');
    return raw.replace(/^```ya?ml\n?/im, '').replace(/```\s*$/m, '').trim()
        || `name: ${name}\ndescription: ${content.slice(0, 80)}\ntriggers: []\ncontent: |\n  ${content}\n`;
}

// ── Main router ───────────────────────────────────────────────────────────────

export async function routeLearning(content: string, ctx: RouterCtx): Promise<RouteResult> {
    const cls = await classify(content, ctx.llm);
    const agent = KNOWN_AGENTS.includes(cls.target_agent) ? cls.target_agent : 'general';

    // session learnings are ephemeral — discard
    if (cls.type === 'session') {
        return { type: 'session', target: 'discarded (ephemeral)', skipped: true };
    }

    if (cls.type === 'tool_quirk') {
        const dir  = cls.scope === 'global'
            ? join(ctx.homeDir, 'agent-notes')
            : join(ctx.projectDir, 'agent-notes');
        const path = join(dir, `${agent}.md`);
        const existing = safeRead(path);

        if (await isDuplicate(content, existing, ctx.llm)) {
            return { type: 'tool_quirk', target: `agent-notes/${agent}.md`, skipped: true };
        }

        let updated = existing ? `${existing}\n- ${content}` : `- ${content}`;
        if (Buffer.byteLength(updated, 'utf-8') > MAX_NOTES_BYTES) {
            updated = await compact(updated, MAX_NOTES_BYTES, `Compacting ${agent} notes`, ctx);
        }
        safeWrite(path, updated);
        return { type: 'tool_quirk', target: `agent-notes/${agent}.md`, skipped: false };
    }

    if (cls.type === 'skill') {
        const name = cls.skill_name || `skill-${Date.now()}`;
        const dir  = cls.scope === 'global'
            ? join(ctx.homeDir, 'skills')
            : join(ctx.projectDir, 'skills');
        const path = join(dir, `${name}.yaml`);

        if (existsSync(path)) {
            return { type: 'skill', target: `skills/${name}.yaml`, skipped: true };
        }

        ctx.emit?.('start', `Generating skill "${name}"`);
        const yaml = await generateSkillYaml(content, agent, name, ctx.llm);
        ctx.emit?.('done', `Generating skill "${name}"`);
        safeWrite(path, yaml);
        return { type: 'skill', target: `skills/${name}.yaml`, skipped: false };
    }

    if (cls.type === 'project') {
        const path = join(ctx.projectDir, 'memory', 'contexto-proyecto.md');
        const existing = safeRead(path);

        if (await isDuplicate(content, existing, ctx.llm)) {
            return { type: 'project', target: 'contexto-proyecto.md', skipped: true };
        }

        let updated = existing ? `${existing}\n\n${content}` : content;
        if (Buffer.byteLength(updated, 'utf-8') > MAX_CTX_BYTES) {
            updated = await compact(updated, MAX_CTX_BYTES, 'Compacting project context', ctx);
        }
        safeWrite(path, updated);
        return { type: 'project', target: 'contexto-proyecto.md', skipped: false };
    }

    if (cls.type === 'user') {
        const path = join(ctx.homeDir, 'USER.md');
        const existing = safeRead(path);

        if (await isDuplicate(content, existing, ctx.llm)) {
            return { type: 'user', target: 'USER.md', skipped: true };
        }

        let updated = existing ? `${existing}\n- ${content}` : `- ${content}`;
        if (Buffer.byteLength(updated, 'utf-8') > MAX_USER_BYTES) {
            updated = await compact(updated, MAX_USER_BYTES, 'Compacting user profile', ctx);
        }
        safeWrite(path, updated);
        return { type: 'user', target: 'USER.md', skipped: false };
    }

    return { type: 'session', target: 'unclassified/discarded', skipped: true };
}
