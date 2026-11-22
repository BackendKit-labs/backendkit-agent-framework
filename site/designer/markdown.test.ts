/**
 * The document as HTML (SPEC-0040 F1). The text of a design was written by a model that may have been talked into anything, so the
 * point of these tests is what cannot happen: no tag, no attribute, no script and no link out of these docs gets through.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { markdownToHtml, inline } from './markdown.ts';
import { DOCS, renderFullDocument } from './render.ts';
import { validateDesign } from './validate.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = ['refunds', 'support-triage', 'report-readonly', 'invoice-reconciliation', 'injection'];
const htmlOf = (name: string): string => {
    const v = validateDesign(JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8')));
    assert.ok(v.ok);
    return markdownToHtml(renderFullDocument(v.spec, v.warnings));
};

const ALLOWED_TAGS = new Set(['h1', 'h2', 'h3', 'p', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'pre', 'code', 'strong', 'em', 'a']);

describe('what can never get through, whatever a model wrote', () => {
    for (const name of FIXTURES) {
        test(`${name}: only the tags and attributes this file writes`, () => {
            const html = htmlOf(name);
            for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/gi)) {
                assert.ok(ALLOWED_TAGS.has(m[2]!.toLowerCase()), `a tag that is not allowed: <${m[2]}>`);
                const attrs = m[3]!.trim();
                if (m[1] === '/') { assert.equal(attrs, ''); continue; }
                if (m[2] === 'a') assert.match(attrs, /^href="https:\/\/[^"\s]+" target="_blank" rel="noopener noreferrer"$/);
                else assert.equal(attrs, '', `<${m[2]}> carries attributes: ${attrs}`);
            }
            assert.doesNotMatch(html, /<[^>]+\son\w+\s*=/i);
        });

        test(`${name}: every link points into these docs`, () => {
            for (const m of htmlOf(name).matchAll(/<a href="([^"]+)"/g)) assert.ok(m[1]!.startsWith(DOCS), m[1]);
        });
    }

    test('a script, a heading, an image and a javascript: link written by the model stay as text', () => {
        const html = htmlOf('injection');
        assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
        assert.doesNotMatch(html, /<script/i);
        assert.doesNotMatch(html, /href="javascript:/i);
        assert.ok(!/<h1>A heading the model slipped in/.test(html));
        assert.equal((html.match(/<h1>/g) ?? []).length, 1, 'one title, the template\'s');
    });

    test('a link to anywhere but these docs is text, not a link', () => {
        assert.equal(inline('[click](https://evil.example/login)'), 'click');
        assert.equal(inline('[click](javascript:alert(1))'), '[click](javascript:alert(1))');
        assert.equal(inline(`[docs](${DOCS}/concepts/governance/)`), `<a href="${DOCS}/concepts/governance/" target="_blank" rel="noopener noreferrer">docs</a>`);
        assert.equal(inline(`[x](${DOCS}/a"onmouseover="alert(1))`).includes('onmouseover="'), false, 'a quote cannot open an attribute');
    });

    test('quotes, ampersands and angle brackets are escaped everywhere', () => {
        assert.equal(inline('a & b < c > "d" \'e\''), 'a &amp; b &lt; c &gt; &quot;d&quot; &#39;e&#39;');
        assert.equal(inline('`<b>`'), '<code>&lt;b&gt;</code>');
    });

    test('code is shown, never run, and what is inside it is not read as markup', () => {
        assert.equal(inline('`**not bold**`'), '<code>**not bold**</code>');
        const html = markdownToHtml('```ts\nconst a = "<script>";\n```');
        assert.equal(html, '<pre><code>const a = &quot;&lt;script&gt;&quot;;</code></pre>');
    });

    test('a code fence longer than the backticks inside it holds', () => {
        const html = markdownToHtml('````ts\nline\n```\nstill code\n````\n\nafter');
        assert.ok(html.includes('still code'));
        assert.ok(html.includes('<p>after</p>'));
        assert.equal((html.match(/<pre>/g) ?? []).length, 1);
    });
});

describe('what it renders', () => {
    test('headings, a quote, lists, tables with escaped pipes, and inline marks', () => {
        const md = ['# Title', '', '> a quote', '', '## Section', '', '- one `x`', '- two **bold** and *it*', '', '1. first', '2. second', '', '| a | b |', '|---|---|', '| 1 \\| 2 | 3 |', '', 'a paragraph', 'on two lines'].join('\n');
        const html = markdownToHtml(md);
        assert.ok(html.includes('<h1>Title</h1>'));
        assert.ok(html.includes('<blockquote><p>a quote</p></blockquote>'));
        assert.ok(html.includes('<ul><li>one <code>x</code></li><li>two <strong>bold</strong> and <em>it</em></li></ul>'));
        assert.ok(html.includes('<ol><li>first</li><li>second</li></ol>'));
        assert.ok(html.includes('<td>1 | 2</td><td>3</td>'));
        assert.ok(html.includes('<p>a paragraph on two lines</p>'));
    });

    test('every design becomes a document with its tables and its skeleton', () => {
        for (const name of FIXTURES) {
            const html = htmlOf(name);
            assert.match(html, /<h2>Skeleton<\/h2>/);
            assert.match(html, /<table>/);
            assert.match(html, /<pre><code>/);
        }
    });

    test('a table row of the injection design keeps the cells of its header', () => {
        const html = htmlOf('injection');
        for (const table of html.match(/<table>[\s\S]*?<\/table>/g) ?? []) {
            const rows = table.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
            const widths = new Set(rows.map(r => (r.match(/<t[hd]>/g) ?? []).length));
            assert.equal(widths.size, 1, 'a row has another number of cells than the header');
        }
    });
});
