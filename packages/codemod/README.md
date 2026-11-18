# @backendkit-labs/codemod

Automated migrations for the breaking releases of `@backendkit-labs/agent-core` and `agent-coding` ([SPEC-0037](../../docs/specs/SPEC-0037-codemods-y-guias-de-migracion.md)). One command per break; it moves imports and flags what needs a decision.

```bash
npx @backendkit-labs/codemod --list                        # what there is, and the release that asks for each
npx @backendkit-labs/codemod coding-split ./src --dry-run  # show what would change, write nothing
npx @backendkit-labs/codemod coding-split ./src            # apply it
```

| Transformation | For | Does |
|---|---|---|
| `scope-rename` | the rename of the npm scope | `@bk/agent-core`, `@bk/agent-coding`, `@bk/mcp-server` become `@backendkit-labs/*` |
| `coding-split` | v0.40.0 (agent-core 0.39) | `Orchestrator`, `QAService` and their types move from `agent-core` to `agent-coding/pipeline`; the subpaths `agent-core/orchestration` and `agent-core/reflection` are replaced |
| `terminal-app-split` | v0.41.0 (agent-core 0.40) | the 66 names of agent discovery, skill loading, built-in commands, checkpoints, workspaces and trust move to `agent-coding/cli` |
| `zod4-record` | the move to zod 4 (agent-core 0.33) | `z.record(x)` becomes `z.record(z.string(), x)`; `invalid_type_error` and `required_error` (one `error` in zod 4, with other messages) are flagged |

The lists of names are not copied from the changelog: they are the names `agent-core` exported before a release and no longer exports after it, checked against what the destination package exports today.

## What it does, and what it leaves to you

It reads each file with the TypeScript parser and edits only the statements it understands (the `import` and `export ... from` of the moves, and the `z.record(...)` calls of `zod4-record`). Spacing, comments, quotes and line endings of everything else stay byte for byte, and running it twice changes nothing.

- **Moves** a name from one module to another, joining an import of the destination that is already there, keeping aliases and `type` marks.
- **Renames** a module that stopped being a subpath.
- **Flags, never guesses.** A statement it cannot rewrite safely gets a `// TODO(codemod): ...` comment above it and is listed in the summary:
  - a name that no longer exists anywhere (it stays where it is);
  - `import * as core from '...'` followed by `core.Name` for a name that moved;
  - `export { Name } from '...'` of a name that moved.

  Search for `TODO(codemod)` after a run.

It does **not** touch `require()`, dynamic `import()`, or `package.json` (the version ranges), and it does not restructure calls: a break that changes how a function is called (for example the options of `createBaseEngine` that became a hook) is described in the migration guide, not rewritten.

## Options

| | |
|---|---|
| `[path]` | a folder or a file; default: the current folder. `node_modules`, `dist`, `build`, `.git` and `*.d.ts` are skipped |
| `--dry-run` | print what would change and write nothing |
| `--list` | the transformations |

Exit code `0` on success, `1` on an unknown transformation or option or a path that does not exist.
