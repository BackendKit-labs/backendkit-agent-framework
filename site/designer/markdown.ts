/**
 * A small, safe Markdown to HTML for the document of the designer (SPEC-0040 F1). Not a general Markdown: only what the templates
 * emit (headings, a quote, tables, lists, fenced code, paragraphs, `code`, **bold**, *italic* and links).
 *
 * Safe by construction, because the text of the design was written by a model that may have been talked into anything:
 * every character of text is escaped before any markup is added, so nothing of the model's can become a tag or an attribute; the
 * only attributes are the ones this file writes; and a link is kept only when it points into these docs, everything else is text.
 */
import { DOCS } from './render.ts';

const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inlineText(escaped: string): string {
    return escaped
        .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) =>
            url.startsWith(DOCS) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>` : text)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*(?!\*)/g, '$1<em>$2</em>');
}

/** Inline markup on a line of text: `code` spans first, so nothing inside them is touched. */
export function inline(text: string): string {
    return text.split(/(`[^`]*`)/g).map(part =>
        part.length >= 2 && part.startsWith('`') && part.endsWith('`')
            ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
            : inlineText(escapeHtml(part)),
    ).join('');
}

const cells = (line: string): string[] => {
    const out: string[] = [];
    let current = '';
    const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    for (let i = 0; i < body.length; i++) {
        if (body[i] === '\\' && body[i + 1] === '|') { current += '|'; i += 1; continue; }
        if (body[i] === '|') { out.push(current.trim()); current = ''; continue; }
        current += body[i];
    }
    out.push(current.trim());
    return out;
};

export function markdownToHtml(markdown: string): string {
    const lines = markdown.split('\n');
    const html: string[] = [];
    let i = 0;
    const isBlank = (l: string | undefined) => l === undefined || l.trim() === '';
    const isSpecial = (l: string) => /^(#{1,3} |> |\||[-] |\d+\. |`{3,})/.test(l);

    while (i < lines.length) {
        const line = lines[i]!;
        if (isBlank(line)) { i += 1; continue; }

        const fence = /^(`{3,})(\w*)\s*$/.exec(line);
        if (fence) {
            const closing = fence[1]!;
            const body: string[] = [];
            i += 1;
            while (i < lines.length && lines[i]!.trimEnd() !== closing) { body.push(lines[i]!); i += 1; }
            i += 1;
            html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
            continue;
        }
        const heading = /^(#{1,3}) (.*)$/.exec(line);
        if (heading) { html.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`); i += 1; continue; }
        if (line.startsWith('> ')) { html.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`); i += 1; continue; }

        if (line.startsWith('|')) {
            const rows: string[][] = [];
            while (i < lines.length && lines[i]!.startsWith('|')) { rows.push(cells(lines[i]!)); i += 1; }
            const [head, , ...body] = rows;
            html.push('<table><thead><tr>' + (head ?? []).map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
                + body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
            continue;
        }
        if (/^- /.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^- /.test(lines[i]!)) { items.push(lines[i]!.slice(2)); i += 1; }
            html.push('<ul>' + items.map(t => `<li>${inline(t)}</li>`).join('') + '</ul>');
            continue;
        }
        if (/^\d+\. /.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\d+\. /.test(lines[i]!)) { items.push(lines[i]!.replace(/^\d+\. /, '')); i += 1; }
            html.push('<ol>' + items.map(t => `<li>${inline(t)}</li>`).join('') + '</ol>');
            continue;
        }
        const paragraph: string[] = [];
        while (i < lines.length && !isBlank(lines[i]) && (paragraph.length === 0 || !isSpecial(lines[i]!))) { paragraph.push(lines[i]!.trim()); i += 1; }
        html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    }
    return html.join('\n');
}
