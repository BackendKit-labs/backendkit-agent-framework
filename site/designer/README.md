# Agent designer (SPEC-0040)

From a task to the **design** of an agent and the way to build it with the framework. Not a package: it lives next to the site because the
page that uses it (F1) is part of the site.

| File | What it is |
|---|---|
| `schema.ts` | The design as data. A closed vocabulary of the framework, with zod strict objects: what a model may propose, validated. |
| `validate.ts` | The schema, then whether the pieces fit together. Errors (the design contradicts itself) and warnings (allowed, but a person should look). |
| `render.ts` | The document and the skeleton. Deterministic. The model writes data, never code; everything it wrote is a JSON string literal or a one-line comment. |
| `fixtures/` | Designs written by hand, one of them hostile on purpose. |
| `designer.test.ts` | Schema, validation, document and skeleton shape. |
| `skeleton.test.ts` | Compiles each skeleton against the packages of this repository and runs the tests it generated with the real engine. |

```bash
node --test "site/designer/*.test.ts"      # Node 24 strips the types; no build step. Needs the packages built (CI does it first).
```

The skeletons are written to `.out/` (ignored by git) so that they find the workspace packages in `node_modules`, as a visitor's project would.
