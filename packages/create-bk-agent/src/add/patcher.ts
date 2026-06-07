import * as fs from 'fs';

// ── Import block ──────────────────────────────────────────────────────────────

/** Adds `importLine` after the last import statement. No-op if already present. */
export function addImportLine(file: string, importLine: string): void {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes(importLine.trim())) return;

    const lines = content.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^import\s/.test(lines[i])) lastImportIdx = i;
    }

    if (lastImportIdx === -1) {
        fs.writeFileSync(file, importLine + '\n' + content);
    } else {
        lines.splice(lastImportIdx + 1, 0, importLine);
        fs.writeFileSync(file, lines.join('\n'));
    }
}

// ── Line insertion ────────────────────────────────────────────────────────────

/**
 * Inserts `newLine` after the LAST line that matches `pattern`.
 * Returns true if the insertion was done, false if the pattern wasn't found.
 * No-op if `newLine` (trimmed) already exists in the file.
 */
export function insertAfterPattern(file: string, pattern: RegExp, newLine: string): boolean {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes(newLine.trim())) return true;

    const lines = content.split('\n');
    let lastIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) lastIdx = i;
    }
    if (lastIdx === -1) return false;

    lines.splice(lastIdx + 1, 0, newLine);
    fs.writeFileSync(file, lines.join('\n'));
    return true;
}

/**
 * Inserts `newLine` before the FIRST line that matches `pattern`.
 * Returns true if the insertion was done, false if the pattern wasn't found.
 * No-op if `newLine` (trimmed) already exists in the file.
 */
export function insertBeforePattern(file: string, pattern: RegExp, newLine: string): boolean {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes(newLine.trim())) return true;

    const lines = content.split('\n');
    let firstIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) { firstIdx = i; break; }
    }
    if (firstIdx === -1) return false;

    lines.splice(firstIdx, 0, newLine);
    fs.writeFileSync(file, lines.join('\n'));
    return true;
}

// ── package.json helpers ──────────────────────────────────────────────────────

export function addPackageScript(pkgFile: string, name: string, cmd: string): void {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
    pkg.scripts ??= {};
    pkg.scripts[name] = cmd;
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
}

/** Adds `depName@version` to dependencies if not already present. */
export function addPackageDependency(pkgFile: string, depName: string, version: string): boolean {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
    pkg.dependencies ??= {};
    if (pkg.dependencies[depName]) return false;
    pkg.dependencies[depName] = version;
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
    return true;
}

// ── AgentEngine options patcher ───────────────────────────────────────────────

/**
 * Adds `mcpServers: [{ name, url }]` to the first AgentEngine constructor call.
 * If mcpServers already exists, appends a new entry to the existing array.
 * Returns true on success.
 */
export function addMcpServerEntry(file: string, name: string, url: string): boolean {
    const content = fs.readFileSync(file, 'utf-8');
    const entry = `        { name: '${name}', url: '${url}' },`;

    if (content.includes(`url: '${url}'`)) return true; // already registered

    if (content.includes('mcpServers:')) {
        // Append into existing array — insert after 'mcpServers: ['
        const updated = content.replace(
            /(mcpServers:\s*\[)/,
            `$1\n${entry}`,
        );
        if (updated === content) return false;
        fs.writeFileSync(file, updated);
        return true;
    }

    // Insert new mcpServers block before the closing of AgentEngine({ ... })
    const lines = content.split('\n');
    let depth = 0;
    let engineStart = -1;
    let closeIdx = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('new AgentEngine({')) {
            engineStart = i;
            depth = 0;
        }
        if (engineStart !== -1) {
            depth += (lines[i].match(/\{/g) ?? []).length;
            depth -= (lines[i].match(/\}/g) ?? []).length;
            if (depth === 0 && i > engineStart) { closeIdx = i; break; }
        }
    }

    if (closeIdx === -1) return false;

    lines.splice(closeIdx, 0, `        mcpServers: [\n${entry}\n        ],`);
    fs.writeFileSync(file, lines.join('\n'));
    return true;
}

/**
 * Adds a stdio MCP entry `{ name, transport: 'stdio', command, args }` to AgentEngine.
 * If mcpServers already exists, appends. Returns true on success.
 */
export function addMcpStdioEntry(file: string, name: string, npmPackage: string): boolean {
    const content = fs.readFileSync(file, 'utf-8');
    const entry = `        { name: '${name}', transport: 'stdio' as const, command: 'npx', args: ['-y', '${npmPackage}'] },`;

    if (content.includes(`'${npmPackage}'`)) return true; // already registered

    if (content.includes('mcpServers:')) {
        const updated = content.replace(/(mcpServers:\s*\[)/, `$1\n${entry}`);
        if (updated === content) return false;
        fs.writeFileSync(file, updated);
        return true;
    }

    const lines = content.split('\n');
    let depth = 0;
    let engineStart = -1;
    let closeIdx = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('new AgentEngine({')) { engineStart = i; depth = 0; }
        if (engineStart !== -1) {
            depth += (lines[i].match(/\{/g) ?? []).length;
            depth -= (lines[i].match(/\}/g) ?? []).length;
            if (depth === 0 && i > engineStart) { closeIdx = i; break; }
        }
    }

    if (closeIdx === -1) return false;

    lines.splice(closeIdx, 0, `        mcpServers: [\n${entry}\n        ],`);
    fs.writeFileSync(file, lines.join('\n'));
    return true;
}
