import * as fs   from 'node:fs';
import * as path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtractedFile {
    relativePath: string;
    content:      string;
}

// ── Output directories per agent domain ──────────────────────────────────────

export const DOMAIN_BASE: Record<string, string> = {
    backend:  '',           // writes directly to projectRoot (e.g. src/)
    infra:    '',           // Dockerfile, docker-compose.yml at root
    qa:       '.qa',        // qa-phaseN.md reports
    security: '.security',  // security-review.md
};

// ── Parser ────────────────────────────────────────────────────────────────────
//
// Detects file blocks in LLM output. Handles the formats:
//
//   Format A (preferred — injected in system prompt):
//     ### FILE: src/auth/auth.service.ts
//     ```typescript
//     content
//     ```
//
//   Format B (common LLM natural output):
//     ## `src/auth/auth.service.ts`
//     ```typescript
//     content
//     ```
//
//   Format C (first line comment inside code block):
//     ```typescript
//     // src/auth/auth.service.ts
//     content
//     ```

const FILE_HEADER_A = /^#{1,4}\s+FILE:\s+(.+?)\s*$/i;
const FILE_HEADER_B = /^#{1,4}\s+`?([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)`?\s*$/;
const CODE_BLOCK    = /^```[a-zA-Z0-9]*\s*$/;
const CODE_CLOSE    = /^```\s*$/;
const FIRST_COMMENT = /^\s*(?:\/\/|#|<!--)\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)\s*(?:-->)?\s*$/;

export function extractFiles(llmOutput: string): ExtractedFile[] {
    const lines   = llmOutput.split('\n');
    const results: ExtractedFile[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // ── Format A: ### FILE: path ──────────────────────────────────────────
        const matchA = FILE_HEADER_A.exec(line);
        if (matchA) {
            const filePath = matchA[1].trim();
            i++;
            if (i < lines.length && CODE_BLOCK.test(lines[i])) {
                i++;
                const content = readUntilClose(lines, i);
                i += content.lines + 1;
                results.push({ relativePath: filePath, content: content.text });
                continue;
            }
        }

        // ── Format B: ## `src/file.ts` ───────────────────────────────────────
        const matchB = FILE_HEADER_B.exec(line);
        if (matchB && looksLikePath(matchB[1])) {
            const filePath = matchB[1].trim();
            i++;
            // skip blank lines between header and code block
            while (i < lines.length && lines[i].trim() === '') i++;
            if (i < lines.length && CODE_BLOCK.test(lines[i])) {
                i++;
                const content = readUntilClose(lines, i);
                i += content.lines + 1;
                results.push({ relativePath: filePath, content: content.text });
                continue;
            }
        }

        // ── Format C: code block with file comment on first line ──────────────
        if (CODE_BLOCK.test(line)) {
            i++;
            if (i < lines.length) {
                const firstLineMatch = FIRST_COMMENT.exec(lines[i]);
                if (firstLineMatch && looksLikePath(firstLineMatch[1])) {
                    const filePath = firstLineMatch[1].trim();
                    i++; // skip the comment line itself
                    const content = readUntilClose(lines, i);
                    i += content.lines + 1;
                    results.push({ relativePath: filePath, content: content.text });
                    continue;
                }
                // not a file block — skip the entire code block
                const skip = readUntilClose(lines, i);
                i += skip.lines + 1;
                continue;
            }
        }

        i++;
    }

    return deduplicate(results);
}

function readUntilClose(lines: string[], start: number): { text: string; lines: number } {
    const contentLines: string[] = [];
    let i = start;
    while (i < lines.length && !CODE_CLOSE.test(lines[i])) {
        contentLines.push(lines[i]);
        i++;
    }
    return { text: contentLines.join('\n'), lines: i - start };
}

function looksLikePath(s: string): boolean {
    // Must contain at least one slash OR look like a filename with extension
    return /[/\\]/.test(s) || /^[a-zA-Z0-9_.\-]+\.[a-zA-Z]{1,6}$/.test(s);
}

function deduplicate(files: ExtractedFile[]): ExtractedFile[] {
    const seen = new Map<string, ExtractedFile>();
    for (const f of files) seen.set(f.relativePath, f); // last write wins
    return Array.from(seen.values());
}

// ── Writer ────────────────────────────────────────────────────────────────────

export function writeFiles(
    files:       ExtractedFile[],
    projectRoot: string,
    domain?:     string,
    onFile?:     (p: string) => void,
): number {
    let written = 0;
    const base = domain && DOMAIN_BASE[domain] !== undefined
        ? path.join(projectRoot, DOMAIN_BASE[domain])
        : projectRoot;

    for (const f of files) {
        const absPath = path.resolve(base, f.relativePath);

        // Safety: must stay inside projectRoot
        if (!absPath.startsWith(path.resolve(projectRoot))) {
            continue;
        }

        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, f.content, 'utf-8');
        onFile?.(absPath);
        written++;
    }
    return written;
}

// ── Domain-specific prompt context ───────────────────────────────────────────

export function buildProjectContext(domain: string | undefined, projectRoot: string): string {
    switch (domain) {
        case 'backend':
        case 'infra':
            return [
                `Project root: ${projectRoot}`,
                `When creating files use EXACTLY this format for each file:`,
                `### FILE: relative/path/to/file.ext`,
                '```lang',
                'file content',
                '```',
                '',
            ].join('\n');

        case 'qa':
            return [
                `Project root: ${projectRoot}`,
                `Write your QA report as a markdown file using this format:`,
                `### FILE: qa-phase{N}.md`,
                '```markdown',
                '# QA Report - Phase N',
                '**Verdict:** GO | NO GO | CONDITIONAL',
                '## Criteria Results',
                '| ID | Criterion | Result | Evidence |',
                '...',
                '```',
                '',
            ].join('\n');

        case 'security':
            return [
                `Project root: ${projectRoot}`,
                `Write your security review as a markdown file using this format:`,
                `### FILE: security-review.md`,
                '```markdown',
                '# Security Review',
                '**Verdict:** PASS | FAIL | CONDITIONAL',
                '## Vulnerabilities',
                '| Severity | CWE | Description | File | Line | Recommendation |',
                '...',
                '```',
                '',
            ].join('\n');

        default:
            return `Project root: ${projectRoot}\n`;
    }
}

// ── Convenience: extract + write in one call ──────────────────────────────────

export function extractAndWrite(
    llmOutput:   string,
    projectRoot: string,
    domain?:     string,
    onFile?:     (p: string) => void,
): number {
    const files = extractFiles(llmOutput);
    if (files.length === 0) return 0;
    return writeFiles(files, projectRoot, domain, onFile);
}
