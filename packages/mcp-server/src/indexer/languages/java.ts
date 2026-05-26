import { registerLanguage } from './index';
import { resolveWasm } from './utils';

registerLanguage({
    name: 'java',
    extensions: ['.java'],
    wasmFile: resolveWasm('tree-sitter-java.wasm'),
    queries: {
        symbols: `
            [
              (class_declaration name: (identifier) @name) @node
              (interface_declaration name: (identifier) @name) @node
              (enum_declaration name: (identifier) @name) @node
              (method_declaration name: (identifier) @name) @node
              (constructor_declaration name: (identifier) @name) @node
              (record_declaration name: (identifier) @name) @node
            ]
        `,
        imports: `
            (import_declaration (scoped_identifier) @source)
        `,
        calls: `
            [
              (method_invocation name: (identifier) @name)
              (object_creation_expression type: (type_identifier) @name)
            ]
        `,
    },
    kindMap: {
        class_declaration:       'class',
        interface_declaration:   'interface',
        enum_declaration:        'enum',
        method_declaration:      'method',
        constructor_declaration: 'function',
        record_declaration:      'class',
    },
});
