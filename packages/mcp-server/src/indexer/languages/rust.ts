import { registerLanguage } from './index';
import { resolveWasm } from './utils';

registerLanguage({
    name: 'rust',
    extensions: ['.rs'],
    wasmFile: resolveWasm('tree-sitter-rust.wasm'),
    queries: {
        symbols: `
            [
              (function_item name: (identifier) @name) @node
              (struct_item name: (type_identifier) @name) @node
              (enum_item name: (type_identifier) @name) @node
              (trait_item name: (type_identifier) @name) @node
              (impl_item
                type: (type_identifier) @name) @node
              (type_item name: (type_identifier) @name) @node
            ]
        `,
        imports: `
            [
              (use_declaration argument: (scoped_identifier path: (identifier) @source))
              (use_declaration argument: (identifier) @source)
              (extern_crate_declaration name: (identifier) @source)
            ]
        `,
        calls: `
            [
              (call_expression function: (identifier) @name)
              (call_expression
                function: (field_expression
                  field: (field_identifier) @name))
              (call_expression
                function: (scoped_identifier
                  name: (identifier) @name))
            ]
        `,
    },
    kindMap: {
        function_item: 'function',
        struct_item:   'class',
        enum_item:     'enum',
        trait_item:    'interface',
        impl_item:     'class',
        type_item:     'type',
    },
});
