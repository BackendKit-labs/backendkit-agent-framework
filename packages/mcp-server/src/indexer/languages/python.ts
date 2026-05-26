import { registerLanguage } from './index';
import { resolveWasm } from './utils';

registerLanguage({
    name: 'python',
    extensions: ['.py', '.pyi'],
    wasmFile: resolveWasm('tree-sitter-python.wasm'),
    queries: {
        symbols: `
            [
              (function_definition name: (identifier) @name) @node
              (class_definition name: (identifier) @name) @node
              (decorated_definition
                definition: [
                  (function_definition name: (identifier) @name)
                  (class_definition name: (identifier) @name)
                ]) @node
            ]
        `,
        imports: `
            [
              (import_statement name: (dotted_name) @source)
              (import_from_statement module_name: (dotted_name) @source)
              (import_from_statement module_name: (relative_import) @source)
            ]
        `,
        calls: `
            [
              (call function: (identifier) @name)
              (call function: (attribute attribute: (identifier) @name))
            ]
        `,
    },
    kindMap: {
        function_definition:  'function',
        class_definition:     'class',
        decorated_definition: 'function',
    },
});
