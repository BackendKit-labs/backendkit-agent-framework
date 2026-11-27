/**
 * The most of each context file that goes into the system prompt. These files are read from disk on every session and
 * can grow without bound (a session log, a project context the agent keeps appending to, an AGENT.md from a cloned repo):
 * whole, they could fill the context window and cost on every call, and a planted file could bury the real instructions
 * (audit D-02). What is cut is said, so the model knows it did not see everything.
 */
export const CONTEXT_LIMITS = {
    agentMd: 16_000,
    userMd: 8_000,
    project: 16_000,
    session: 12_000,
    lessons: 3_000,
} as const;

/** `text` up to `max` characters, with a line saying how much was left out. */
export function capContext(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n\n[... ${text.length - max} more characters not loaded: the file is longer than ${max} ...]`;
}
