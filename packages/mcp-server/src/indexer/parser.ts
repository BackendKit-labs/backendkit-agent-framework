import Parser from 'web-tree-sitter';
import * as path from 'path';
import type { LanguageConfig, SymbolKind } from './languages/index';

export interface ExtractedSymbol {
    name: string;
    kind: SymbolKind;
    startLine: number;
    endLine: number;
    exported: boolean;
    signature: string;
}

export interface ExtractedImport {
    source: string;
    line: number;
}

export interface ExtractedCall {
    callee: string;
    line: number;
}

export interface ParseResult {
    symbols: ExtractedSymbol[];
    imports: ExtractedImport[];
    calls: ExtractedCall[];
}

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, Parser.Language>();

async function ensureInit(): Promise<void> {
    if (!initPromise) {
        initPromise = Parser.init({
            locateFile: (file: string) => path.join(
                path.dirname(require.resolve('web-tree-sitter')),
                file,
            ),
        });
    }
    return initPromise;
}

async function loadLanguage(config: LanguageConfig): Promise<Parser.Language> {
    if (languageCache.has(config.name)) {
        return languageCache.get(config.name)!;
    }
    await ensureInit();
    const lang = await Parser.Language.load(config.wasmFile);
    languageCache.set(config.name, lang);
    return lang;
}

function isExported(node: Parser.SyntaxNode): boolean {
    return node.parent?.type === 'export_statement';
}

function extractSignature(node: Parser.SyntaxNode, content: string): string {
    const lines = content.split('\n');
    const firstLine = lines[node.startPosition.row] ?? '';
    return firstLine.slice(node.startPosition.column).trim().slice(0, 120);
}

export async function parseFile(
    content: string,
    config: LanguageConfig,
): Promise<ParseResult> {
    const lang = await loadLanguage(config);
    const parser = new Parser();
    parser.setLanguage(lang);

    const tree = parser.parse(content);
    const symbols: ExtractedSymbol[] = [];
    const imports: ExtractedImport[] = [];
    const calls: ExtractedCall[] = [];

    // --- Symbols ---
    const symbolQuery = lang.query(config.queries.symbols);
    const symbolCaptures = symbolQuery.captures(tree.rootNode);

    for (const cap of symbolCaptures) {
        if (cap.name !== 'node') continue;

        let symbolName = '';
        for (const nameCap of symbolCaptures) {
            if (
                nameCap.name === 'name' &&
                nameCap.node.startIndex >= cap.node.startIndex &&
                nameCap.node.endIndex <= cap.node.endIndex
            ) {
                symbolName = nameCap.node.text;
                break;
            }
        }

        if (!symbolName) continue;

        const kind: SymbolKind = config.kindMap[cap.node.type] ?? 'variable';
        symbols.push({
            name: symbolName,
            kind,
            startLine: cap.node.startPosition.row + 1,
            endLine: cap.node.endPosition.row + 1,
            exported: isExported(cap.node),
            signature: extractSignature(cap.node, content),
        });
    }
    symbolQuery.delete();

    // --- Imports ---
    const importQuery = lang.query(config.queries.imports);
    for (const cap of importQuery.captures(tree.rootNode)) {
        if (cap.name === 'source') {
            imports.push({
                source: cap.node.text,
                line: cap.node.startPosition.row + 1,
            });
        }
    }
    importQuery.delete();

    // --- Calls ---
    const callQuery = lang.query(config.queries.calls);
    const seenCalls = new Set<string>();
    for (const cap of callQuery.captures(tree.rootNode)) {
        if (cap.name === 'name') {
            const key = `${cap.node.text}:${cap.node.startPosition.row}`;
            if (!seenCalls.has(key)) {
                seenCalls.add(key);
                calls.push({
                    callee: cap.node.text,
                    line: cap.node.startPosition.row + 1,
                });
            }
        }
    }
    callQuery.delete();

    tree.delete();
    parser.delete();
    return { symbols, imports, calls };
}
