import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { addMcpServerEntry, addMcpStdioEntry } from '../add/patcher';

const TEMPLATES = path.resolve(__dirname, '../../../templates');

/** Compiles `files` against the real @backendkit-labs/agent-core types and returns the error messages. */
function typeErrors(file: string): string[] {
    const program = ts.createProgram([file], {
        noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts'],
        module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, types: [],
    });
    return ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

/** Syntax only: for real templates, whose imports cannot be resolved outside their own project. */
function syntaxErrors(content: string): string[] {
    const out = ts.transpileModule(content, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    return (out.diagnostics ?? []).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

const BASE = `import { createBaseEngine } from '@backendkit-labs/agent-core';
import type { AgentProfile, LLMProvider } from '@backendkit-labs/agent-core';

declare const myProvider: LLMProvider;
declare const myAgent: AgentProfile;

export const engine = createBaseEngine({
    providers:       { default: myProvider },
    defaultProvider: 'default',
    agents:          [myAgent],
    defaultAgent:    'my-agent'
});
`;

const ENGINE = `import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    CallbackTransport,
} from '@backendkit-labs/agent-core';

declare const agents: AgentRegistry;
declare const tools: ToolRegistry;
declare const providers: ProviderRegistry;
declare const transport: CallbackTransport;

export function createEngine() {
    return new AgentEngine({
        model:           { provider: 'default', id: 'm' },
        agents,
        tools,
        providers,
        defaultProvider: 'default',
        defaultAgentId:  'my-agent',
        transport
    });
}
`;

describe('add mcp-client / plugin patch generated engines that compile', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(__dirname, '.tmp-add-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    const write = (name: string, content: string) => { const f = path.join(dir, name); fs.writeFileSync(f, content); return f; };
    const read = (f: string) => fs.readFileSync(f, 'utf-8');

    describe('createBaseEngine (option: mcpServers)', () => {
        it('a remote server is added and the file still type-checks, even without a trailing comma', () => {
            const f = write('base.ts', BASE);
            expect(typeErrors(f)).toEqual([]);                      // the fixture itself is valid
            expect(addMcpServerEntry(f, 'docs', 'https://mcp.example.com/mcp')).toBe(true);
            expect(read(f)).toContain("mcpServers: [");
            expect(read(f)).not.toContain('mcpManager');
            expect(typeErrors(f)).toEqual([]);
        });

        it('a stdio plugin is added with a valid shape (no invented `transport` field)', () => {
            const f = write('base.ts', BASE);
            expect(addMcpStdioEntry(f, 'github', '@modelcontextprotocol/server-github')).toBe(true);
            expect(read(f)).toContain("command: 'npx'");
            expect(read(f)).not.toMatch(/transport:\s*'stdio'/);
            expect(typeErrors(f)).toEqual([]);
        });
    });

    describe('new AgentEngine (option: mcpManager, mcpServers does not exist there)', () => {
        it('a remote server becomes an mcpManager and MCPClientManager joins the existing import', () => {
            const f = write('engine.ts', ENGINE);
            expect(typeErrors(f)).toEqual([]);
            expect(addMcpServerEntry(f, 'docs', 'https://mcp.example.com/mcp')).toBe(true);
            const out = read(f);
            expect(out).toContain('mcpManager: new MCPClientManager([');
            expect(out).not.toContain('mcpServers');
            expect(out).toMatch(/import \{[^}]*MCPClientManager[^}]*\} from '@backendkit-labs\/agent-core'/);
            expect(typeErrors(f)).toEqual([]);
        });

        it('a stdio plugin compiles too', () => {
            const f = write('engine.ts', ENGINE);
            expect(addMcpStdioEntry(f, 'github', '@modelcontextprotocol/server-github')).toBe(true);
            expect(typeErrors(f)).toEqual([]);
        });

        it('a single-line import gets the name added in place; a file with no agent-core import gets a new line', () => {
            const one = write('one.ts', ENGINE.replace(/import \{[\s\S]*?\} from '@backendkit-labs\/agent-core';/, "import { AgentEngine, AgentRegistry, ToolRegistry, ProviderRegistry, CallbackTransport } from '@backendkit-labs/agent-core';"));
            addMcpServerEntry(one, 'docs', 'https://a.example/mcp');
            expect(read(one)).toMatch(/import \{ AgentEngine, [^}]*MCPClientManager \} from '@backendkit-labs\/agent-core';/);
            expect(typeErrors(one)).toEqual([]);

            const none = write('none.ts', "declare const AgentEngine: any;\nexport const e = new AgentEngine({\n    a: 1\n});\n");
            addMcpServerEntry(none, 'docs', 'https://a.example/mcp');
            expect(read(none)).toContain("import { MCPClientManager } from '@backendkit-labs/agent-core';");
        });
    });

    describe('both', () => {
        it('a second server is appended to the existing list, and a repeat is a no-op', () => {
            for (const [name, src] of [['base.ts', BASE], ['engine.ts', ENGINE]] as const) {
                const f = write(name, src);
                addMcpServerEntry(f, 'one', 'https://one.example/mcp');
                addMcpServerEntry(f, 'two', 'https://two.example/mcp');
                const afterTwo = read(f);
                expect(afterTwo).toContain('https://one.example/mcp');
                expect(afterTwo).toContain('https://two.example/mcp');
                expect(afterTwo.match(/\[\s*\n/g)?.length).toBeGreaterThan(0);
                expect(addMcpServerEntry(f, 'two', 'https://two.example/mcp')).toBe(true);
                expect(read(f)).toBe(afterTwo);                     // idempotent
                expect(typeErrors(f)).toEqual([]);
            }
        });

        it('braces inside strings, templates and comments do not fool the insertion point', () => {
            // transport is the last property: add noise after it (braces in a comment, a block comment, a string and a template)
            const noisy = ENGINE.replace(
                /transport\n    \}\);/,
                [
                    'transport,',
                    '        // a } in a comment',
                    '        /* and a { here */',
                    "        ...({ note: 'a } b', other: `x ${'}'} y {` } as Record<string, unknown>)",
                    '    });',
                ].join('\n'),
            );
            expect(noisy).not.toBe(ENGINE);
            const f = write('tricky.ts', noisy);
            expect(typeErrors(f)).toEqual([]);                       // the fixture itself is valid
            expect(addMcpServerEntry(f, 'docs', 'https://mcp.example.com/mcp')).toBe(true);
            expect(typeErrors(f)).toEqual([]);
            expect(read(f)).toContain('mcpManager: new MCPClientManager([');
        });

        it('returns false when there is no engine call to patch', () => {
            const f = write('none.ts', "export const x = { a: 1 };\n");
            expect(addMcpServerEntry(f, 'docs', 'https://x/mcp')).toBe(false);
            expect(addMcpStdioEntry(f, 'gh', 'pkg')).toBe(false);
            expect(read(f)).toBe("export const x = { a: 1 };\n");
        });
    });

    describe('the real templates', () => {
        const engines = ['single', 'multi-agent', 'enterprise'].map(a => path.join(TEMPLATES, 'base', a, 'src', 'engine.ts'));

        it.each(engines)('%s: patched file is valid TypeScript and registers the server through mcpManager', (src) => {
            const f = write(`${path.basename(path.dirname(path.dirname(src)))}.ts`, fs.readFileSync(src, 'utf-8'));
            expect(addMcpServerEntry(f, 'docs', 'https://mcp.example.com/mcp')).toBe(true);
            expect(addMcpStdioEntry(f, 'github', '@modelcontextprotocol/server-github')).toBe(true);
            const out = read(f);
            expect(out).toContain('mcpManager: new MCPClientManager([');
            expect(out.match(/MCPClientManager/g)!.length).toBeGreaterThanOrEqual(2); // import + use
            expect(out).not.toContain('mcpServers');
            expect(syntaxErrors(out)).toEqual([]);
        });

        it('the minimal template (createBaseEngine) uses mcpServers', () => {
            const f = write('minimal.ts', fs.readFileSync(path.join(TEMPLATES, 'base', 'minimal', 'src', 'index.ts'), 'utf-8'));
            expect(addMcpServerEntry(f, 'docs', 'https://mcp.example.com/mcp')).toBe(true);
            expect(read(f)).toContain('mcpServers: [');
            expect(syntaxErrors(read(f))).toEqual([]);
        });
    });
});
