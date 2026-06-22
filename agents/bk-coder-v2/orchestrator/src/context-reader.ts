import * as fs   from 'node:fs';
import * as path from 'node:path';

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_FILE_CHARS  = 6000;   // per file
const MAX_SRC_FILES   = 6;      // max source files injected
const CODE_EXTENSIONS = ['.ts', '.js', '.py', '.java', '.go', '.rs', '.tsx', '.jsx'];
const ALL_EXTENSIONS  = [...CODE_EXTENSIONS, '.json', '.yaml', '.yml', '.toml', '.env.example'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function readFile(filePath: string, maxChars = MAX_FILE_CHARS): string | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.trim().length === 0) return null;
        return content.length > maxChars
            ? content.slice(0, maxChars) + '\n... (truncado)'
            : content;
    } catch {
        return null;
    }
}

function listFilesRecursive(
    dir:        string,
    extensions: string[],
    maxDepth:   number = 4,
    depth:      number = 0,
): string[] {
    if (depth > maxDepth) return [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...listFilesRecursive(full, extensions, maxDepth, depth + 1));
            } else if (extensions.some(ext => entry.name.endsWith(ext))) {
                files.push(full);
            }
        }
        return files;
    } catch {
        return [];
    }
}

function readSourceFiles(dir: string, max: number): string {
    const files = listFilesRecursive(dir, CODE_EXTENSIONS).slice(0, max);
    if (files.length === 0) return '';

    const blocks = files.map(f => {
        const rel     = f.replace(dir, '').replace(/^[\\/]/, '');
        const content = readFile(f, 4000);
        if (!content) return null;
        const ext = path.extname(f).slice(1) || 'text';
        return `### ${rel}\n\`\`\`${ext}\n${content}\n\`\`\``;
    }).filter(Boolean);

    return blocks.join('\n\n');
}

function fileListSection(dir: string, extensions: string[], label: string): string {
    const files = listFilesRecursive(dir, extensions);
    if (files.length === 0) return '';
    const lines = files.map(f => `- ${f.replace(dir, '').replace(/^[\\/]/, '')}`);
    return `### ${label}\n${lines.join('\n')}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads project files relevant to the agent's domain and returns them
 * as a formatted markdown string to inject into the user prompt.
 * Returns empty string if projectRoot is not set or no relevant files exist.
 */
export function buildAgentContext(projectRoot: string, domain: string): string {
    const specsDir  = path.join(projectRoot, '.specs');
    const srcDir    = path.join(projectRoot, 'src');
    const qaDir     = path.join(projectRoot, '.qa');

    const spec    = readFile(path.join(specsDir, 'specification.md'));
    const design  = readFile(path.join(specsDir, 'design.md'));
    const roadmap = readFile(path.join(specsDir, 'ROADMAP.md'));

    const sections: string[] = [];

    switch (domain) {

        case 'backend': {
            if (spec)    sections.push(`### specification.md\n${spec}`);
            if (roadmap) sections.push(`### ROADMAP.md\n${roadmap}`);

            // Existing src files — list only (not content) to avoid token bloat
            const srcList = fileListSection(srcDir, CODE_EXTENSIONS, 'Archivos existentes en src/');
            if (srcList) sections.push(srcList);

            // Read key existing files to understand current state
            const existing = readSourceFiles(srcDir, 3);
            if (existing) sections.push(`### Código existente\n${existing}`);
            break;
        }

        case 'qa': {
            if (spec)   sections.push(`### specification.md\n${spec}`);
            if (design) sections.push(`### design.md\n${design}`);

            // Previous QA reports for context
            const qaFiles = listFilesRecursive(qaDir, ['.md']).slice(0, 3);
            for (const f of qaFiles) {
                const content = readFile(f, 2000);
                if (content) sections.push(`### ${path.basename(f)}\n${content}`);
            }

            // Code to validate
            const srcCode = readSourceFiles(srcDir, MAX_SRC_FILES);
            if (srcCode) sections.push(`### Código implementado\n${srcCode}`);
            break;
        }

        case 'security': {
            // Code to review
            const srcCode = readSourceFiles(srcDir, MAX_SRC_FILES);
            if (srcCode) sections.push(`### Código a revisar\n${srcCode}`);

            // package.json for dependency scanning
            const pkgJson = readFile(path.join(projectRoot, 'package.json'), 3000);
            if (pkgJson) sections.push(`### package.json\n\`\`\`json\n${pkgJson}\n\`\`\``);

            // Requirements file for Python stacks
            const requirements = readFile(path.join(projectRoot, 'requirements.txt'), 2000);
            if (requirements) sections.push(`### requirements.txt\n\`\`\`\n${requirements}\n\`\`\``);
            break;
        }

        case 'infra': {
            // package.json / requirements to detect stack
            const pkgJson = readFile(path.join(projectRoot, 'package.json'), 2000);
            if (pkgJson) sections.push(`### package.json\n\`\`\`json\n${pkgJson}\n\`\`\``);

            const requirements = readFile(path.join(projectRoot, 'requirements.txt'), 1000);
            if (requirements) sections.push(`### requirements.txt\n\`\`\`\n${requirements}\n\`\`\``);

            // Source file listing for structure understanding
            const srcList = fileListSection(srcDir, ALL_EXTENSIONS, 'Estructura del proyecto');
            if (srcList) sections.push(srcList);

            if (spec) sections.push(`### specification.md (resumen de requisitos de infra)\n${spec.slice(0, 2000)}`);
            break;
        }

        default:
            if (spec) sections.push(`### specification.md\n${spec}`);
            break;
    }

    if (sections.length === 0) return '';

    return `\n---\n## Contexto del proyecto (${domain})\n\n${sections.join('\n\n')}\n---\n`;
}
