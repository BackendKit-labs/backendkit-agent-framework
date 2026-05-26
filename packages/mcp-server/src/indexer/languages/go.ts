import { registerLanguage } from './index';
import { resolveWasm } from './utils';

registerLanguage({
    name: 'go',
    extensions: ['.go'],
    wasmFile: resolveWasm('tree-sitter-go.wasm'),
    queries: {
        symbols: `
            [
              (function_declaration name: (identifier) @name) @node
              (method_declaration name: (field_identifier) @name) @node
              (type_declaration
                (type_spec name: (type_identifier) @name)) @node
            ]
        `,
        imports: `
            (import_spec path: (interpreted_string_literal) @source)
        `,
        calls: `
            [
              (call_expression function: (identifier) @name)
              (call_expression
                function: (selector_expression
                  field: (field_identifier) @name))
            ]
        `,
    },
    kindMap: {
        function_declaration: 'function',
        method_declaration:   'method',
        type_declaration:     'type',
    },
});
