import type { CuratorLLMProvider } from './providers/types.js';

/** Hard cap enforced by the note schemas. */
export const MAX_TITLE = 120;
/** What the prompts ask the LLM for, leaving headroom below the hard cap. */
export const TARGET_TITLE = 80;

const SHORTEN_PROMPT =
    'You shorten note titles. Rewrite the title so it keeps its meaning and its key terms ' +
    'but fits the length limit. Same language as the input. ' +
    'Return ONLY the new title: no quotes, no explanation, a single line.';

/**
 * Cut at a word boundary and mark the cut with an ellipsis. Never splits a word
 * unless the first word alone is longer than the limit. Result is always <= max.
 */
export function truncateAtWord(text: string, max: number = MAX_TITLE): string {
    const t = text.trim().replace(/\s+/g, ' ');
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(' ');
    const base = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
    return base.replace(/[\s,;:.\-–—(\[]+$/, '') + '…';
}

/**
 * Guarantee title <= max without breaking its meaning: ask the LLM to shorten it once;
 * if that fails or is still too long, fall back to a word-boundary truncation.
 */
export async function fitTitle(
    title: string,
    provider: CuratorLLMProvider,
    max: number = MAX_TITLE,
): Promise<string> {
    if (title.length <= max) return title;
    try {
        const raw = await provider.complete(
            SHORTEN_PROMPT,
            `Limit: ${TARGET_TITLE} characters.\n\nTitle: ${title}`,
            { json: false },
        );
        const line = (raw.split('\n').find(l => l.trim()) ?? '').trim();
        const shorter = line.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim();
        if (shorter && shorter.length <= max) return shorter;
    } catch {
        // fall through to the deterministic fallback
    }
    return truncateAtWord(title, max);
}

/** Filename slug, cut at a word boundary (a hyphen) instead of mid-word. */
export function slugify(title: string, max: number = 60): string {
    const s = title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const i = cut.lastIndexOf('-');
    return (i > max * 0.5 ? cut.slice(0, i) : cut).replace(/-+$/, '');
}

const STOPWORDS = new Set([
    'para', 'como', 'esta', 'este', 'estos', 'estas', 'sobre', 'entre', 'desde', 'hasta', 'with', 'from',
    'that', 'this', 'into', 'over', 'sin', 'por', 'los', 'las', 'del', 'una', 'uno', 'que', 'and', 'the',
]);

function terms(text: string): string[] {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter(w => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Cheap coherence heuristic: at least one significant term of the title must appear in
 * the resumen or content. Returns a warning message, or null when it looks coherent.
 * Heuristic only — it flags suspicious titles, it does not prove coherence.
 */
export function titleCoherenceWarning(note: { title: string; resumen: string; content: string }): string | null {
    const titleTerms = terms(note.title);
    if (!titleTerms.length) return null;
    const body = new Set(terms(`${note.resumen} ${note.content}`));
    return titleTerms.some(t => body.has(t))
        ? null
        : `Title shares no key terms with its resumen/content: "${note.title}"`;
}
