import { registerLanguage } from './index';
import { resolveWasm } from './utils';

registerLanguage({
    name: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    wasmFile: resolveWasm('tree-sitter-typescript.wasm'),
    queries: {
        symbols: `
            [
              (function_declaration name: (identifier) @name) @node
              (method_definition name: (property_identifier) @name) @node
              (class_declaration name: (type_identifier) @name) @node
              (interface_declaration name: (type_identifier) @name) @node
              (type_alias_declaration name: (type_identifier) @name) @node
              (enum_declaration name: (identifier) @name) @node
              (lexical_declaration
                (variable_declarator
                  name: (identifier) @name
                  value: [(arrow_function) (function_expression)])) @node
            ]
        `,
        imports: `
            (import_statement
              source: (string (string_fragment) @source))
        `,
        calls: `
            [
              (call_expression function: (identifier) @name)
              (call_expression
                function: (member_expression
                  property: (property_identifier) @name))
            ]
        `,
    },
    kindMap: {
        function_declaration:    'function',
        method_definition:       'method',
        class_declaration:       'class',
        interface_declaration:   'interface',
        type_alias_declaration:  'type',
        enum_declaration:        'enum',
        lexical_declaration:     'arrow',
    },
});
