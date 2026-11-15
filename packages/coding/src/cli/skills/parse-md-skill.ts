import * as yaml from 'yaml';
import type { Skill } from '@backendkit-labs/agent-core';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parses a .md file with YAML frontmatter into a Skill.
 * The markdown body becomes systemPromptAddition (unless already set in frontmatter).
 * Returns null if frontmatter is missing or invalid.
 */
export function parseMdSkill(content: string): Skill | null {
    const match = content.match(FRONTMATTER_RE);
    if (!match) return null;

    const [, frontmatter, body] = match;

    let parsed: Record<string, unknown>;
    try {
        parsed = yaml.parse(frontmatter) as Record<string, unknown>;
    } catch {
        return null;
    }

    if (!parsed || typeof parsed.name !== 'string' || !parsed.name) return null;

    const skill: Skill = {
        ...(parsed as Partial<Skill>),
        name: parsed.name as string,
        version: typeof parsed.version === 'string' ? parsed.version : '1.0.0',
        description: typeof parsed.description === 'string' ? parsed.description : '',
        triggers: Array.isArray(parsed.triggers) ? (parsed.triggers as string[]) : [],
    };

    const bodyText = body.trim();
    if (bodyText && !skill.systemPromptAddition) {
        skill.systemPromptAddition = bodyText;
    }

    return skill;
}

/**
 * Serializes a Skill to .md format.
 * scope and pack are excluded from frontmatter — they are set by the loader
 * based on where the file lives, not stored in the file itself.
 */
export function skillToMd(skill: Skill): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { systemPromptAddition, scope, pack, ...frontmatterFields } = skill;
    const frontmatter = yaml.stringify(frontmatterFields).trimEnd();
    const body = systemPromptAddition?.trim() ?? '';
    return body
        ? `---\n${frontmatter}\n---\n\n${body}\n`
        : `---\n${frontmatter}\n---\n`;
}
