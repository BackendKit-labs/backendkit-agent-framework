import type { AgentProfile } from '../types';
import type { Skill } from '../skills/types';
import type { EngineHooks } from '../governance/hooks';

/**
 * Where an engine gets agents, skills and instructions from (SPEC-0016 §2). The engine only knows these
 * contracts; reading `AGENT.md`, `~/.appName/skills` or a remote registry is an adapter that a vertical or an
 * app provides. An engine built without sources touches no file.
 */
export interface AgentSource {
    list(): Promise<AgentProfile[]>;
}

export interface SkillSource {
    list(): Promise<Skill[]>;
}

/** One block of instructions for the system prompt. */
export interface InstructionLayer {
    /** Section heading, e.g. "Project Instructions (AGENT.md)". */
    title: string;
    content: string;
    /** Cap on the characters kept. Default: no cap. */
    maxChars?: number;
    /**
     * `true` (default) strips what lets text impersonate the conversation (see `sanitizeDiskContent`). Set
     * `false` only for text your own code produced.
     */
    sanitize?: boolean;
}

export interface InstructionSource {
    load(ctx: { cwd?: string }): Promise<InstructionLayer[]>;
}

/**
 * Text read from disk ends up inside the system prompt, and anyone who can write a file in the repo can write
 * it. Remove what lets a file impersonate the conversation: chat-template delimiters ([INST], <<SYS>>,
 * <|im_start|>), role tags (<system>, <assistant>...) and line-leading role prefixes (SYSTEM:, ASSISTANT:,
 * USER:). Ordinary markup and generics (Promise<void>, <details>) are kept, and so are the instructions
 * themselves: AGENT.md is meant to guide the agent.
 */
export function sanitizeDiskContent(content: string): string {
    return content
        .replace(/\[\/?INST\]|<<\/?SYS>>/g, '')
        .replace(/<\|[a-z_]+\|>/gi, '')
        .replace(/<\/?(?:system|assistant|user|human|instructions?|tool_call|function_calls?)\b[^>]*>/gi, '')
        .replace(/^(?:SYSTEM|ASSISTANT|USER|HUMAN):[ \t]*/gim, '');
}

/** Joins the layers into prompt sections, sanitizing each one. Returns `undefined` when there is nothing. */
export function composeInstructionLayers(layers: InstructionLayer[]): string | undefined {
    const sections: string[] = [];
    for (const layer of layers) {
        let content = layer.sanitize === false ? layer.content : sanitizeDiskContent(layer.content);
        if (layer.maxChars !== undefined) content = content.slice(0, layer.maxChars);
        content = content.trim();
        if (!content) continue;
        sections.push(`## ${layer.title}\n\n${content}`);
    }
    return sections.length ? sections.join('\n\n') : undefined;
}

const LAYERS_KEY = 'instructions.sections';

/**
 * The instruction sources as an engine hook: `beforeRun` loads them once per turn and `systemPrompt` appends
 * the composed layers. A source that throws fails the turn, like any hook (fail-closed).
 */
export function instructionSourceHooks(sources: InstructionSource[], opts: { cwd?: string } = {}): EngineHooks {
    return {
        name: 'instruction-sources',
        async beforeRun(ctx) {
            const layers: InstructionLayer[] = [];
            for (const source of sources) layers.push(...await source.load({ cwd: opts.cwd }));
            ctx.state.set(LAYERS_KEY, composeInstructionLayers(layers));
        },
        systemPrompt(ctx) {
            return ctx.state.get(LAYERS_KEY) as string | undefined;
        },
    };
}

/** Agents of all the sources, in order. A later source overrides an earlier agent with the same id. */
export async function listAgentSources(sources: AgentSource[]): Promise<AgentProfile[]> {
    const byId = new Map<string, AgentProfile>();
    for (const source of sources) for (const agent of await source.list()) byId.set(agent.id, agent);
    return [...byId.values()];
}

/** Skills of all the sources, in order. A later source overrides an earlier skill with the same name. */
export async function listSkillSources(sources: SkillSource[]): Promise<Skill[]> {
    const byName = new Map<string, Skill>();
    for (const source of sources) for (const skill of await source.list()) byName.set(skill.name, skill);
    return [...byName.values()];
}
