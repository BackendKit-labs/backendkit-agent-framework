import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import { getBkHome, bkPaths } from './bk-home.js';

/**
 * Directory structure created under BK_HOME on first run.
 * Each entry is a path relative to BK_HOME.
 */
const DIRS = [
    'vaults',
    'vaults/shared',
    'rag',
    'data/orchestrator',
    'data/orchestrator-mcp',
    'data/vault-manager',
    'director',
];

/**
 * Seed files created only if they don't already exist.
 * Key = path relative to BK_HOME, value = file content.
 */
const SEED_FILES: Record<string, string> = {
    'director/goals.json': JSON.stringify([], null, 2) + '\n',
    'director/user-model.json': JSON.stringify({}, null, 2) + '\n',
    'README.md': `# BackendKit Platform — Infrastructure Home

This directory (\`~/.backendkit/\`) is the unified infrastructure root
for the BackendKit Platform. It is created automatically on first run.

## Structure

\`\`\`
~/.backendkit/
├── vaults/              # Curated knowledge notes (codex-context-agent-v2)
│   ├── {project}/       # Per-project vault
│   └── shared/          # Shared knowledge across projects
├── rag/                 # Semantic search indexes (auto-generated)
├── data/
│   ├── orchestrator/    # orchestrator-agent runtime state
│   ├── orchestrator-mcp/# orchestrator-mcp-agent runtime state
│   └── vault-manager/   # vault-manager SQLite database
└── director/            # director-agent memory
    ├── goals.json        # Long-term goals (cross-session)
    └── user-model.json   # User preferences and patterns
\`\`\`

## Configuration

Set \`BK_HOME\` env var to override this location:
  \`BK_HOME=/var/backendkit node dist/server.js\`
`,
};

/**
 * Initialize the BackendKit Platform home directory.
 *
 * - Creates BK_HOME and all required subdirectories.
 * - Writes seed files (goals.json, user-model.json, README) only if absent.
 * - Safe to call on every startup — idempotent.
 *
 * @returns The resolved BK_HOME path.
 */
export async function initBkHome(): Promise<string> {
    const home = getBkHome();

    // Create all required directories
    for (const dir of DIRS) {
        await fs.mkdir(path.join(home, dir), { recursive: true });
    }

    // Write seed files (skip if already exist)
    for (const [rel, content] of Object.entries(SEED_FILES)) {
        const filePath = path.join(home, rel);
        try {
            await fs.access(filePath);
            // File exists — skip
        } catch {
            await fs.writeFile(filePath, content, 'utf-8');
        }
    }

    return home;
}

/**
 * Check if BK_HOME has been initialized (directory exists).
 */
export async function isBkHomeInitialized(): Promise<boolean> {
    try {
        await fs.access(getBkHome());
        return true;
    } catch {
        return false;
    }
}
