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

/** Adds `depName@version` to devDependencies if it is in neither dependencies nor devDependencies. */
export function addPackageDevDependency(pkgFile: string, depName: string, version: string): boolean {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
    if (pkg.dependencies?.[depName] || pkg.devDependencies?.[depName]) return false;
    pkg.devDependencies ??= {};
    pkg.devDependencies[depName] = version;
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
    return true;
}

// ── Engine MCP patcher ────────────────────────────────────────────────────────

/** The two ways a generated project builds its engine, and where MCP servers go in each. */
type EngineCall =
    | { kind: 'base';   open: number }   // createBaseEngine({ ... mcpServers: [...] })
    | { kind: 'engine'; open: number };  // new AgentEngine({ ... mcpManager: new MCPClientManager([...]) })

/**
 * `mcpServers` is an option of createBaseEngine only. AgentEngine takes an `mcpManager`, so patching
 * `mcpServers` into `new AgentEngine({...})` produced code that does not compile (an unknown property).
 */
function findEngineCall(content: string): EngineCall | null {
    const base = content.search(/createBaseEngine\s*\(\s*\{/);
    if (base !== -1) return { kind: 'base', open: content.indexOf('{', base) };
    const engine = content.search(/new AgentEngine\s*\(\s*\{/);
    if (engine !== -1) return { kind: 'engine', open: content.indexOf('{', engine) };
    return null;
}

/** Index of the `}` that closes the object literal opened at `open`, skipping strings, templates and comments. */
function matchingBrace(content: string, open: number): number {
    let depth = 0;
    for (let i = open; i < content.length; i++) {
        const c = content[i];
        const next = content[i + 1];
        if (c === '/' && next === '/') { i = content.indexOf('\n', i); if (i === -1) return -1; continue; }
        if (c === '/' && next === '*') { i = content.indexOf('*/', i + 2); if (i === -1) return -1; i++; continue; }
        if (c === "'" || c === '"') {
            for (i++; i < content.length && content[i] !== c; i++) if (content[i] === '\\') i++;
            continue;
        }
        if (c === '`') {
            for (i++; i < content.length && content[i] !== '`'; i++) {
                if (content[i] === '\\') { i++; continue; }
                if (content[i] === '$' && content[i + 1] === '{') {
                    const inner = matchingBrace(content, i + 1);
                    if (inner === -1) return -1;
                    i = inner;
                }
            }
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return i;
    }
    return -1;
}

/**
 * Registers one MCP server entry (an object literal source) in the project's engine:
 * appends to an existing list, or adds the option, keeping the file valid TypeScript.
 */
function addMcpEntry(file: string, entry: string, alreadyThere: string): boolean {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes(alreadyThere)) return true;

    const call = findEngineCall(content);
    if (!call) return false;
    const line = `        ${entry},`;

    // An existing list: add to its start.
    const existing = call.kind === 'base' ? /mcpServers:\s*\[/ : /new MCPClientManager\(\s*\[/;
    const m = existing.exec(content);
    if (m) {
        fs.writeFileSync(file, content.slice(0, m.index + m[0].length) + '\n' + line + content.slice(m.index + m[0].length));
        return true;
    }

    // No list yet: add the option just before the closing brace of the options object.
    const close = matchingBrace(content, call.open);
    if (close === -1) return false;
    const before = content.slice(0, close).replace(/\s+$/, '');
    const needsComma = !/[,{]$/.test(before);       // the last property may have no trailing comma
    const option = call.kind === 'base'
        ? `        mcpServers: [\n${line}\n        ],`
        : `        mcpManager: new MCPClientManager([\n${line}\n        ]),`;
    fs.writeFileSync(file, before + (needsComma ? ',' : '') + '\n' + option + '\n' + content.slice(close));

    if (call.kind === 'engine') addMcpManagerImport(file);
    return true;
}

/** Makes `MCPClientManager` available from agent-core: into the existing import, or as a new one. */
function addMcpManagerImport(file: string): void {
    const content = fs.readFileSync(file, 'utf-8');
    if (/\bMCPClientManager\b[^;]*from\s+['"]@backendkit-labs\/agent-core['"]/.test(content)) return;
    const named = /import\s*\{([^}]*)\}\s*from\s*(['"])@backendkit-labs\/agent-core\2/.exec(content);
    if (named) {
        const names = named[1].replace(/\s+$/, '');
        const sep = names.trim().endsWith(',') ? '' : ',';
        const multiline = named[1].includes('\n');
        const added = multiline ? `${names}${sep}\n    MCPClientManager,\n` : `${names}${sep} MCPClientManager `;
        fs.writeFileSync(file, content.replace(named[0], `import {${added}} from ${named[2]}@backendkit-labs/agent-core${named[2]}`));
        return;
    }
    addImportLine(file, "import { MCPClientManager } from '@backendkit-labs/agent-core';");
}

/**
 * Adds a remote MCP server `{ name, url }` to the engine of a generated project (createBaseEngine or AgentEngine).
 * Appends if a list exists. Returns true on success.
 */
export function addMcpServerEntry(file: string, name: string, url: string): boolean {
    return addMcpEntry(file, `{ name: '${name}', url: '${url}' }`, `url: '${url}'`);
}

/**
 * Adds a stdio MCP server `{ name, command: 'npx', args: ['-y', pkg] }`. Returns true on success.
 */
export function addMcpStdioEntry(file: string, name: string, npmPackage: string): boolean {
    return addMcpEntry(file, `{ name: '${name}', command: 'npx', args: ['-y', '${npmPackage}'] }`, `'${npmPackage}'`);
}
