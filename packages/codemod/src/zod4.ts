import * as ts from 'typescript';
import type { MoveReport } from './move-imports';

/**
 * The part of the move to zod 4 that is mechanical (SPEC-0037 F3). In zod 4 `z.record` takes the key schema too:
 * `z.record(x)` becomes `z.record(z.string(), x)`. What is not mechanical is flagged, not rewritten.
 *
 * It only acts in a file that gets `z` from `zod` or from `@backendkit-labs/agent-core`, and only on that name, so a
 * `.record(...)` of anything else is left alone.
 */
const ZOD_MODULES = new Set(['zod', 'zod/v4', '@backendkit-labs/agent-core']);

const TODO = '// TODO(codemod):';

/** The local names of `z` in a file: `import { z }`, `import { z as zz }`, `import * as z from 'zod'`, `import z from 'zod'`. */
function zodNames(sf: ts.SourceFile): Set<string> {
    const names = new Set<string>();
    for (const s of sf.statements) {
        if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !ZOD_MODULES.has(s.moduleSpecifier.text)) continue;
        const clause = s.importClause;
        if (!clause || clause.isTypeOnly) continue; // a type-only `z` cannot be called
        if (clause.name && s.moduleSpecifier.text !== '@backendkit-labs/agent-core') names.add(clause.name.text);
        const b = clause.namedBindings;
        if (b && ts.isNamespaceImport(b) && s.moduleSpecifier.text !== '@backendkit-labs/agent-core') names.add(b.name.text);
        if (b && ts.isNamedImports(b)) for (const e of b.elements) if (!e.isTypeOnly && (e.propertyName ?? e.name).text === 'z') names.add(e.name.text);
    }
    return names;
}

/** The statement of the top level that holds a node. */
function topLevel(sf: ts.SourceFile, node: ts.Node): ts.Statement {
    let n: ts.Node = node;
    while (n.parent && n.parent !== sf) n = n.parent;
    return n as ts.Statement;
}

export function zod4Text(fileName: string, text: string, report: MoveReport): string {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const names = zodNames(sf);
    if (names.size === 0) return text;
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const flagged = new Set<ts.Statement>();

    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'record'
            && ts.isIdentifier(n.expression.expression) && names.has(n.expression.expression.text) && n.arguments.length === 1) {
            const z = n.expression.expression.text;
            const arg = n.arguments[0];
            // A spread could hold both arguments; leave it.
            if (!ts.isSpreadElement(arg)) {
                edits.push({ start: arg.getStart(), end: arg.getStart(), text: `${z}.string(), ` });
                report.moved.push(`${fileName}: ${z}.record(x) -> ${z}.record(${z}.string(), x)`);
            }
        }
        // Zod 4 reads one `error` where zod 3 had two keys; the messages of the library changed too, so a person looks.
        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && (n.name.text === 'invalid_type_error' || n.name.text === 'required_error')) {
            flagged.add(topLevel(sf, n));
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);

    const message = 'invalid_type_error and required_error are one `error` in zod 4, and its messages changed; see the migration guide';
    for (const s of flagged) {
        const has = (ts.getLeadingCommentRanges(text, s.getFullStart()) ?? []).some(c => text.slice(c.pos, c.end).includes(message));
        if (has) continue;
        const lineStart = text.lastIndexOf('\n', s.getStart() - 1) + 1;
        edits.push({ start: s.getStart(), end: s.getStart(), text: `${TODO} ${message}${newline}${text.slice(lineStart, s.getStart())}` });
        report.flagged.push(`${fileName}: invalid_type_error / required_error`);
    }

    if (edits.length === 0) return text;
    edits.sort((a, b) => b.start - a.start);
    let out = text;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return out;
}
