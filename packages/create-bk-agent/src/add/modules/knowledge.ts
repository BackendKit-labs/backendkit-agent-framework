import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { BkProjectInfo } from '../detector';
import { addImportLine, addPackageDependency } from '../patcher';

// ── Arg parsing ───────────────────────────────────────────────────────────────

interface KnowledgeArgs {
    /** Folder or vault path to add */
    target: string;
    /** When true, target is a completely new vault root (not a subfolder) */
    isNewVault: boolean;
}

function parseArgs(args: string[]): KnowledgeArgs | null {
    const vaultIdx = args.indexOf('--vault');
    if (vaultIdx !== -1) {
        const target = args[vaultIdx + 1];
        if (!target) return null;
        return { target, isNewVault: true };
    }
    if (args[0]) return { target: args[0], isNewVault: false };
    return null;
}

// ── Engine.ts patchers ────────────────────────────────────────────────────────

type PatchResult = 'added' | 'already_exists' | 'no_rag_found';

/**
 * Adds `folderPath` to the `folders:` array inside ObsidianRAGProvider({...}).
 *
 * Handles three states of engine.ts:
 *   1. `folders:` already exists (uncommented) → append entry
 *   2. `// folders:` is commented out (template default) → uncomment + set
 *   3. No `folders:` at all → insert before closing `}` of RAG constructor
 */
function patchFolders(engineFile: string, folderPath: string): PatchResult {
    if (!fs.existsSync(engineFile)) return 'no_rag_found';

    const content = fs.readFileSync(engineFile, 'utf-8');
    if (!content.includes('ObsidianRAGProvider')) return 'no_rag_found';

    const normalized = folderPath.replace(/\\/g, '/');

    if (content.includes(`'${normalized}'`)) return 'already_exists';

    // Case 1: folders array already exists (uncommented)
    if (/\bfolders:\s*\[/.test(content)) {
        const patched = content.replace(
            /(\bfolders:\s*\[)([^\]]*)(\])/,
            (_full, open, inner, close) => {
                const trimmed = inner.trimEnd();
                const needsComma = trimmed.length > 0 && !trimmed.endsWith(',');
                return `${open}${inner}${needsComma ? ',' : ''}\n        '${normalized}',\n    ${close}`;
            },
        );
        if (patched !== content) {
            fs.writeFileSync(engineFile, patched);
            return 'added';
        }
    }

    // Case 2: folders line is commented out (// TODO: ... \n // folders: [...])
    if (content.includes('// folders:') || content.includes('// TODO: restrict indexing')) {
        const patched = content.replace(
            /[ \t]*\/\/\s*TODO:\s*restrict indexing[^\n]*\n[ \t]*\/\/\s*folders:[^\n]*\n/,
            `        folders: ['${normalized}'],\n`,
        );
        if (patched !== content) {
            fs.writeFileSync(engineFile, patched);
            return 'added';
        }
        // Fallback: just the commented folders line
        const patched2 = content.replace(
            /[ \t]*\/\/\s*folders:[^\n]*\n/,
            `        folders: ['${normalized}'],\n`,
        );
        if (patched2 !== content) {
            fs.writeFileSync(engineFile, patched2);
            return 'added';
        }
    }

    // Case 3: no folders key — insert before closing `}` of RAG constructor
    const lines = content.split('\n');
    let inRag = false;
    let depth = 0;
    let closeIdx = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('new ObsidianRAGProvider(')) {
            inRag = true;
            depth = 0;
        }
        if (inRag) {
            depth += (lines[i].match(/\{/g) ?? []).length;
            depth -= (lines[i].match(/\}/g) ?? []).length;
            if (depth === 0) { closeIdx = i; break; }
        }
    }

    if (closeIdx === -1) return 'no_rag_found';
    lines.splice(closeIdx, 0, `        folders: ['${normalized}'],`);
    fs.writeFileSync(engineFile, lines.join('\n'));
    return 'added';
}

/**
 * Adds a second ObsidianRAGProvider for a completely new vault and merges
 * its tool into the existing tools registry.
 * Used when --vault flag is passed to add a new vault, not just a folder.
 */
function addNewVault(engineFile: string, vaultPath: string): PatchResult {
    if (!fs.existsSync(engineFile)) return 'no_rag_found';

    const content = fs.readFileSync(engineFile, 'utf-8');
    if (!content.includes('ObsidianRAGProvider')) return 'no_rag_found';

    const normalized = vaultPath.replace(/\\/g, '/');
    const varName = `rag_${path.basename(normalized).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;

    if (content.includes(normalized)) return 'already_exists';

    // Insert new RAG instance after the first one
    const ragBlock = [
        '',
        `    // Additional vault: ${path.basename(normalized)}`,
        `    const ${varName} = new ObsidianRAGProvider({`,
        `        vaultPath:      '${normalized}',`,
        `        ollamaHost:     config.ollamaHost,`,
        `        embeddingModel: config.embeddingModel,`,
        `    });`,
    ].join('\n');

    const patched = content.replace(
        /(const rag = new ObsidianRAGProvider\(\{[\s\S]*?\}\);)/,
        `$1\n${ragBlock}`,
    );

    // Register the new tool
    const withTool = patched.replace(
        /tools\s*\n?\s*\.register\(rag\.createTool\(\)\)/,
        `tools\n        .register(rag.createTool())\n        .register(${varName}.createTool())`,
    );

    if (withTool === content) return 'no_rag_found';

    fs.writeFileSync(engineFile, withTool);
    return 'added';
}

// ── Non-enterprise setup ──────────────────────────────────────────────────────

function setupRagFromScratch(info: BkProjectInfo, vaultPath: string): void {
    console.log('\n📦  Installing @backendkit-labs/agent-enterprise ...');

    const added = addPackageDependency(info.pkgFile, '@backendkit-labs/agent-enterprise', '^0.1.0');
    if (added) {
        execSync('npm install', { cwd: info.cwd, stdio: 'inherit' });
    }

    if (!fs.existsSync(info.engineFile)) {
        console.log('\n⚠  src/engine.ts not found — add RAG manually:');
        printManualInstructions(vaultPath);
        return;
    }

    const content = fs.readFileSync(info.engineFile, 'utf-8');

    if (content.includes('ObsidianRAGProvider')) {
        console.log('\n⚠  ObsidianRAGProvider already present in engine.ts');
        return;
    }

    // Add import
    addImportLine(
        info.engineFile,
        `import { ObsidianRAGProvider } from '@backendkit-labs/agent-enterprise';`,
    );

    // Insert RAG instance + tool registration
    const normalized = vaultPath.replace(/\\/g, '/');

    const ragBlock = [
        '',
        `    // Knowledge base (RAG over Obsidian vault)`,
        `    const rag = new ObsidianRAGProvider({`,
        `        vaultPath: '${normalized}',`,
        `        // ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',`,
        `        // embeddingModel: process.env.EMBEDDING_MODEL ?? 'nomic-embed-text',`,
        `    });`,
        '',
    ].join('\n');

    // Insert before first ToolRegistry or ToolRegistry instantiation
    let patched = fs.readFileSync(info.engineFile, 'utf-8');
    patched = patched.replace(
        /(const tools = new ToolRegistry\(\);)/,
        `${ragBlock}    $1`,
    );

    // Register the tool
    patched = patched.replace(
        /(const tools = new ToolRegistry\(\);[\s\S]*?tools)/,
        (match) => match.replace(
            /tools\s*\n?\s*\.register\(/,
            `tools\n        .register(rag.createTool())\n        .register(`,
        ),
    );

    fs.writeFileSync(info.engineFile, patched);

    console.log('\n✓  Added ObsidianRAGProvider to src/engine.ts');
    console.log('✓  Registered search_knowledge tool');
    console.log('\n  Make sure Ollama is running and nomic-embed-text is available:');
    console.log('  ollama pull nomic-embed-text\n');
}

function printManualInstructions(vaultPath: string): void {
    const normalized = vaultPath.replace(/\\/g, '/');
    console.log(`
  1. Import in engine.ts:
     import { ObsidianRAGProvider } from '@backendkit-labs/agent-enterprise';

  2. Create RAG instance:
     const rag = new ObsidianRAGProvider({ vaultPath: '${normalized}' });

  3. Register tool:
     tools.register(rag.createTool());
`);
}

// ── Main export ───────────────────────────────────────────────────────────────

const USAGE = `
Usage: npx create-bk-agent add knowledge <folder-path>
       npx create-bk-agent add knowledge --vault <vault-path>

Examples:
  npx create-bk-agent add knowledge ./docs
  npx create-bk-agent add knowledge "04-Recursos/Backend"
  npx create-bk-agent add knowledge --vault "C:/Company/HR-Vault"
`;

export function addKnowledge(info: BkProjectInfo, args: string[]): void {
    const parsed = parseArgs(args);

    if (!parsed) {
        console.log(USAGE);
        process.exit(1);
    }

    const absPath = path.resolve(info.cwd, parsed.target);

    if (!info.isEnterprise) {
        console.log('\n⚠  This project does not use @backendkit-labs/agent-enterprise.');
        console.log('   Setting up RAG from scratch...\n');
        setupRagFromScratch(info, absPath);
        return;
    }

    let result: PatchResult;

    if (parsed.isNewVault) {
        result = addNewVault(info.engineFile, absPath);
    } else {
        result = patchFolders(info.engineFile, absPath);
    }

    switch (result) {
        case 'added':
            console.log(`\n✓  Added knowledge source to src/engine.ts`);
            console.log(`   Path: ${absPath}`);
            console.log('\n   The vault will be re-indexed on next run (incremental — only new/changed files).\n');
            break;

        case 'already_exists':
            console.log(`\n⚠  '${absPath}' is already registered in engine.ts\n`);
            break;

        case 'no_rag_found':
            console.log('\n✗  Could not find ObsidianRAGProvider in src/engine.ts');
            console.log('   Add it manually:\n');
            printManualInstructions(absPath);
            break;
    }
}
