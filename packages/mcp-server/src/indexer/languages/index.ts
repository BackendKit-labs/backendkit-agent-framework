export type SymbolKind =
    | 'function'
    | 'method'
    | 'class'
    | 'interface'
    | 'type'
    | 'enum'
    | 'variable'
    | 'arrow';

export interface LanguageQueries {
    /** S-expr query — captures @node (container) and @name (identifier) */
    symbols: string;
    /** S-expr query — captures @source (module path string) */
    imports: string;
    /** S-expr query — captures @name (called function/method) */
    calls: string;
}

export interface LanguageConfig {
    name: string;
    extensions: string[];
    /** Absolute path to the .wasm grammar file */
    wasmFile: string;
    queries: LanguageQueries;
    /** Maps tree-sitter node types to SymbolKind */
    kindMap: Record<string, SymbolKind>;
}

const REGISTRY = new Map<string, LanguageConfig>();

export function registerLanguage(config: LanguageConfig): void {
    for (const ext of config.extensions) {
        REGISTRY.set(ext, config);
    }
}

export function detectLanguage(filePath: string): LanguageConfig | undefined {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    return REGISTRY.get(ext);
}

export function registeredExtensions(): string[] {
    return [...REGISTRY.keys()];
}

// Eagerly import all language configs so they self-register
import './typescript';
