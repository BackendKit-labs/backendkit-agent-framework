import { createHash } from 'node:crypto';
import * as yaml from 'yaml';

/** A lesson that belongs to no tool in particular. */
export const GENERAL_UNIT = 'general';

/**
 * What the engine itself knows about how a call failed, whatever the domain: said once, the same for every agent. The
 * advice that depends on the domain comes from whoever knows it (`ToolDefinition.errorHints`, `teach`).
 */
export const ENGINE_HINTS: Record<string, string> = {
    policy_denied: 'A policy denied this call: do not repeat it unchanged; ask for approval or choose another way.',
    guardrail_blocked: 'A guardrail blocked this call: change what you send instead of retrying it.',
    sandbox_denied: 'The sandbox denied this call: it is outside what this agent may touch.',
    tool_timeout: 'This call timed out: try a smaller request instead of repeating the same one.',
    tool_too_large: 'The result was too large: narrow the request.',
    tool_not_found: 'This tool does not exist: use only the tools you were given.',
    tool_not_allowed: 'This agent may not use this tool: use only the tools you were given.',
};

/** What the engine knows of an error code that any tool can raise. */
export const ENGINE_ERROR_CODES: Record<string, string> = {
    INVALID_ARGUMENTS: 'The arguments did not match the schema of the tool: read the schema and send every required field with the right type.',
};

export interface UnitEntry {
    source: 'taught' | 'learned';
    /** Already one line, without the leading dash. */
    text: string;
}

export interface UnitGroup {
    name: string;
    entries: UnitEntry[];
}

/** Units first `general`, then by name; inside a unit what a person taught goes before what was learned. */
export function groupEntries(items: Array<{ unit: string; source: UnitEntry['source']; text: string; order: string }>): UnitGroup[] {
    const byUnit = new Map<string, typeof items>();
    for (const item of items) {
        const list = byUnit.get(item.unit);
        if (list) list.push(item); else byUnit.set(item.unit, [item]);
    }
    const names = [...byUnit.keys()].sort((a, b) => (a === GENERAL_UNIT ? -1 : b === GENERAL_UNIT ? 1 : a.localeCompare(b)));
    return names.map(name => {
        const list = byUnit.get(name)!;
        const taught = list.filter(i => i.source === 'taught').sort((a, b) => a.order.localeCompare(b.order));
        const learned = list.filter(i => i.source === 'learned').sort((a, b) => a.order.localeCompare(b.order));
        return { name, entries: [...taught, ...learned].map(i => ({ source: i.source, text: i.text })) };
    });
}

const render = (groups: UnitGroup[]): string =>
    groups.map(g => `### ${g.name}\n${g.entries.map(e => `- ${e.text}`).join('\n')}`).join('\n\n');

/**
 * The text of the units, cut to `maxChars` by dropping whole entries from the end, never in the middle of one: the same
 * units always give the same text, so the system prompt stays cacheable. What was learned goes first; a lesson a person
 * taught is only dropped when nothing learned is left.
 */
export function fitUnits(groups: UnitGroup[], maxChars: number): string | undefined {
    let live = groups.map(g => ({ ...g, entries: [...g.entries] })).filter(g => g.entries.length);
    const dropLast = (source: UnitEntry['source']): boolean => {
        for (let g = live.length - 1; g >= 0; g--) {
            for (let e = live[g].entries.length - 1; e >= 0; e--) {
                if (live[g].entries[e].source === source) { live[g].entries.splice(e, 1); return true; }
            }
        }
        return false;
    };
    while (live.length && render(live).length > maxChars) {
        if (!dropLast('learned') && !dropLast('taught')) break;
        live = live.filter(g => g.entries.length);
    }
    return live.length ? render(live) : undefined;
}

// ── Markdown: a unit a person can write and review in git ──────────────────────────────────────────────────────────

export interface UnitDocument {
    unit: string;
    tools: string[];
    agentId?: string;
    tenantId?: string;
    /** The lessons of the `## Taught` section: the only part an import reads. */
    taught: string[];
    /** The `## Learned` section: regenerated on export, ignored on import. */
    learned: string[];
}

export function unitToMarkdown(doc: UnitDocument): string {
    const front: Record<string, unknown> = { unit: doc.unit, ...(doc.tools.length ? { tools: doc.tools } : {}), ...(doc.agentId ? { agent: doc.agentId } : {}), ...(doc.tenantId ? { tenant: doc.tenantId } : {}) };
    const bullets = (list: string[]): string => list.length ? list.map(t => `- ${t}`).join('\n') : '_none_';
    return `---\n${yaml.stringify(front).trimEnd()}\n---\n\n## Taught\n\n${bullets(doc.taught)}\n\n## Learned (generated: regenerated on export and ignored on import)\n\n${bullets(doc.learned)}\n`;
}

export function unitFromMarkdown(markdown: string): UnitDocument {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown.trim());
    if (!m) throw new Error('A unit starts with a front matter between --- lines');
    const front = (yaml.parse(m[1]) ?? {}) as Record<string, unknown>;
    if (typeof front.unit !== 'string' || !front.unit.trim()) throw new Error('A unit needs a `unit` name in its front matter');
    const str = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim() : undefined;
    const tools = Array.isArray(front.tools) ? front.tools.filter((t): t is string => typeof t === 'string' && !!t) : [];
    const sections = m[2].split(/^## /m).slice(1);
    const taughtSection = sections.find(s => /^Taught\b/i.test(s));
    const taught = (taughtSection ?? '').split(/\r?\n/).slice(1)
        .map(l => /^\s*[-*]\s+(.*\S)\s*$/.exec(l)?.[1])
        .filter((t): t is string => !!t);
    return {
        unit: front.unit.trim(), tools,
        ...(str(front.agent) ? { agentId: str(front.agent) } : {}),
        ...(str(front.tenant) ? { tenantId: str(front.tenant) } : {}),
        taught, learned: [],
    };
}

/** The same lesson in the same unit has the same id, so importing a file twice changes nothing. */
export function lessonIdFor(unit: string, tenantId: string | undefined, agentId: string | undefined, text: string): string {
    return `lesson-${createHash('sha256').update([unit, tenantId ?? '', agentId ?? '', text].join('\u0000')).digest('hex').slice(0, 16)}`;
}
