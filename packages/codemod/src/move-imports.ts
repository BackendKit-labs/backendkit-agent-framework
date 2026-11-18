import * as ts from 'typescript';

/**
 * Moves named imports from one module to another, the mechanical part of a breaking release (SPEC-0037).
 *
 * It reads the file with the TypeScript parser and changes only the text of the statements it understands: everything else,
 * including spacing, comments, quotes and line endings, stays byte for byte. What it does not understand it does not touch: it
 * leaves a `// TODO(codemod)` above the statement and says so in the report. Running it twice changes nothing.
 */
export interface MoveRule {
    /** The module the symbols used to come from (`@backendkit-labs/agent-core`). Matched exactly. */
    from: string;
    /** Symbols that now live in `to`. */
    moves: Array<{ to: string; symbols: readonly string[] }>;
    /** Symbols that no longer exist anywhere: left in place and flagged. */
    gone?: readonly string[];
    /**
     * For a module that stopped being a subpath: every other name now comes from this module (`agent-core/orchestration`
     * is `agent-coding/pipeline` now). The specifier changes, the names do not.
     */
    renameRest?: string;
}

export interface MoveReport {
    /** `file: Symbol -> module`, one per symbol moved. */
    moved: string[];
    /** `file: what needs a person`, one per flagged statement. */
    flagged: string[];
}

const TODO = '// TODO(codemod):';

interface Edit { start: number; end: number; text: string }

interface Spec { name: string; alias?: string; typeOnly: boolean }

const specText = (s: Spec): string => `${s.typeOnly ? 'type ' : ''}${s.name}${s.alias ? ` as ${s.alias}` : ''}`;

/** What a named import brings in: the exported name (`propertyName` when aliased), not the local one. */
const exportedName = (e: ts.ImportSpecifier | ts.ExportSpecifier): string => (e.propertyName ?? e.name).text;

/** The file with the rules applied, or the same text if there is nothing to do. */
export function transformText(fileName: string, text: string, rules: readonly MoveRule[], report: MoveReport): string {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const edits: Edit[] = [];

    const imports = sf.statements.filter(ts.isImportDeclaration);
    const specifierOf = (d: ts.ImportDeclaration | ts.ExportDeclaration): string | undefined =>
        d.moduleSpecifier && ts.isStringLiteral(d.moduleSpecifier) ? d.moduleSpecifier.text : undefined;
    const ruleFor = (from: string | undefined): MoveRule | undefined => rules.find(r => r.from === from);
    /** Where a declaration ends up importing from, once its specifier is renamed. */
    const finalSpecifier = (d: ts.ImportDeclaration): string | undefined => ruleFor(specifierOf(d))?.renameRest ?? specifierOf(d);
    const namedOf = (d: ts.ImportDeclaration): ts.NamedImports | undefined =>
        d.importClause?.namedBindings && ts.isNamedImports(d.importClause.namedBindings) ? d.importClause.namedBindings : undefined;

    // Imports of a target that the file will already have, to join them instead of adding a second one (value and type imports apart).
    const target = (to: string, typeOnly: boolean): ts.ImportDeclaration | undefined =>
        imports.find(d => finalSpecifier(d) === to && !!d.importClause?.isTypeOnly === typeOnly && namedOf(d) !== undefined);
    /** Imports to add, one per target and kind, placed after the first declaration that fed them. */
    const created = new Map<string, { to: string; typeOnly: boolean; specs: Spec[]; after: ts.ImportDeclaration }>();
    /** Names to append to an import that already exists. */
    const appended = new Map<ts.ImportDeclaration, Spec[]>();

    const hasComment = (node: ts.Node, message: string): boolean =>
        (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []).some(c => text.slice(c.pos, c.end).includes(message));
    const flag = (node: ts.Node, message: string, line: string): void => {
        if (hasComment(node, message)) return;
        // The comment goes on its own line above the statement, with the statement's own indentation.
        const lineStart = text.lastIndexOf('\n', node.getStart() - 1) + 1;
        const indent = text.slice(lineStart, node.getStart());
        edits.push({ start: node.getStart(), end: node.getStart(), text: `${TODO} ${message}${newline}${indent}` });
        report.flagged.push(`${fileName}: ${line}`);
    };

    const renameSpecifier = (decl: ts.ImportDeclaration, from: string, to: string): void => {
        const lit = decl.moduleSpecifier as ts.StringLiteral;
        edits.push({ start: lit.getStart() + 1, end: lit.getEnd() - 1, text: to });
        report.moved.push(`${fileName}: ${from} -> ${to}`);
    };

    for (const d of imports) {
        const from = specifierOf(d);
        const rule = ruleFor(from);
        if (!rule || !d.importClause) {
            // `import 'x'` has no names to move; it only follows a renamed module.
            if (rule?.renameRest && !d.importClause) renameSpecifier(d, rule.from, rule.renameRest);
            continue;
        }
        const named = namedOf(d);
        const declTypeOnly = !!d.importClause.isTypeOnly;
        const elements = named ? [...named.elements] : [];
        const everything = new Set([...rule.moves.flatMap(m => m.symbols), ...(rule.gone ?? [])]);
        const movedElements = new Set<ts.ImportSpecifier>();

        for (const move of rule.moves) {
            const wanted = new Set(move.symbols);
            const hit = elements.filter(e => wanted.has(exportedName(e)));
            if (hit.length === 0) continue;
            const specs: Spec[] = hit.map(e => ({
                name: exportedName(e),
                ...(e.propertyName ? { alias: e.name.text } : {}),
                // `import type { A }` makes every name a type; a name marked `type` inside a value import keeps its mark.
                typeOnly: !declTypeOnly && e.isTypeOnly,
            }));
            for (const e of hit) movedElements.add(e);
            for (const s of specs) report.moved.push(`${fileName}: ${s.name} -> ${move.to}`);

            const existing = target(move.to, declTypeOnly);
            if (existing && existing !== d) {
                appended.set(existing, [...(appended.get(existing) ?? []), ...specs]);
            } else {
                const key = `${move.to}|${declTypeOnly}`;
                const entry = created.get(key);
                if (entry) entry.specs.push(...specs);
                else created.set(key, { to: move.to, typeOnly: declTypeOnly, specs, after: d });
            }
        }

        // A name with no destination that is still imported here: say so, do not guess.
        const goneHere = (rule.gone ?? []).filter(g => elements.some(e => exportedName(e) === g));
        if (goneHere.length > 0) {
            flag(d, `${goneHere.join(', ')} no longer ${goneHere.length === 1 ? 'exists' : 'exist'} in ${rule.from}; see the migration guide`, `${goneHere.join(', ')} (no destination)`);
        }
        // `import * as core from '<from>'` and then `core.Symbol`: a namespace use cannot be rewritten safely.
        const ns = d.importClause.namedBindings && ts.isNamespaceImport(d.importClause.namedBindings) ? d.importClause.namedBindings.name.text : undefined;
        if (ns) {
            const use = findNamespaceUse(sf, ns, everything);
            if (use) flag(d, `${ns}.${use} moved out of ${rule.from}; see the migration guide`, `${ns}.${use} (namespace use)`);
        }

        if (movedElements.size > 0) {
            const allMoved = movedElements.size === elements.length;
            if (allMoved && !d.importClause.name) edits.push(removeStatement(d));
            else if (allMoved) edits.push(dropNamedBindings(d));
            else edits.push(...removeElements(named!, movedElements));
        }
        if (rule.renameRest && !(movedElements.size > 0 && movedElements.size === elements.length && !d.importClause.name)) {
            renameSpecifier(d, rule.from, rule.renameRest);
        }
    }

    // `export { Symbol } from '<from>'` is the same problem the other way round; `export * from` only follows a renamed module.
    for (const e of sf.statements.filter(ts.isExportDeclaration)) {
        const rule = ruleFor(specifierOf(e));
        if (!rule) continue;
        const everything = new Set([...rule.moves.flatMap(m => m.symbols), ...(rule.gone ?? [])]);
        const names = e.exportClause && ts.isNamedExports(e.exportClause) ? e.exportClause.elements.map(exportedName).filter(n => everything.has(n)) : [];
        if (names.length > 0) flag(e, `${names.join(', ')} moved out of ${rule.from}; see the migration guide`, `re-export of ${names.join(', ')}`);
        else if (rule.renameRest && e.moduleSpecifier && ts.isStringLiteral(e.moduleSpecifier)) {
            edits.push({ start: e.moduleSpecifier.getStart() + 1, end: e.moduleSpecifier.getEnd() - 1, text: rule.renameRest });
            report.moved.push(`${fileName}: ${rule.from} -> ${rule.renameRest}`);
        }
    }

    // Names joining an import that already exists: after its last element.
    for (const [decl, specs] of appended) {
        const list = namedOf(decl)!;
        const last = list.elements[list.elements.length - 1];
        edits.push({ start: last.getEnd(), end: last.getEnd(), text: specs.map(s => `, ${specText(s)}`).join('') });
    }
    // New imports: a line of their own after the declaration that fed them, with the quotes and the semicolon of that declaration.
    for (const c of created.values()) {
        const decl = c.after;
        const quote = decl.moduleSpecifier.getText()[0];
        const semi = text.slice(decl.getStart(), decl.getEnd()).trimEnd().endsWith(';') ? ';' : '';
        const lineEnd = text.indexOf('\n', decl.getEnd());
        const insertAt = lineEnd === -1 ? text.length : lineEnd + 1;
        const lineText = `import ${c.typeOnly ? 'type ' : ''}{ ${c.specs.map(specText).join(', ')} } from ${quote}${c.to}${quote}${semi}`;
        edits.push({ start: insertAt, end: insertAt, text: lineEnd === -1 ? `${newline}${lineText}` : `${lineText}${newline}` });
    }

    if (edits.length === 0) return text;
    // Applied from the end of the file backwards, so the positions of the ones still to apply do not move.
    edits.sort((a, b) => b.start - a.start || b.end - a.end);
    let out = text;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return out;

    // ── Text of each edit ────────────────────────────────────────────────────────────────────────────────────

    /** The whole statement and its line break; blank lines around it stay. */
    function removeStatement(d: ts.Node): Edit {
        const start = d.getStart();
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const onlyIndent = text.slice(lineStart, start).trim() === '';
        const end = d.getEnd();
        const rest = text.slice(end);
        const eol = /^[ \t]*(\r?\n|$)/.exec(rest);
        return { start: onlyIndent ? lineStart : start, end: eol ? end + eol[0].length : end, text: '' };
    }

    /** `import Def, { A } from 'x'` with A gone: `import Def from 'x'`. */
    function dropNamedBindings(d: ts.ImportDeclaration): Edit {
        const clause = d.importClause!;
        return { start: clause.name!.getEnd(), end: clause.namedBindings!.getEnd(), text: '' };
    }

    /** The names that move, out of a list: each run of consecutive ones is one cut, so the cuts never overlap. */
    function removeElements(list: ts.NamedImports, moved: ReadonlySet<ts.ImportSpecifier>): Edit[] {
        const els = list.elements;
        const cuts: Edit[] = [];
        for (let i = 0; i < els.length; i++) {
            if (!moved.has(els[i])) continue;
            let j = i;
            while (j + 1 < els.length && moved.has(els[j + 1])) j++;
            cuts.push(removeRun(list, i, j));
            i = j;
        }
        return cuts;
    }

    /** Names i..j of a list and their comma; if their line is left empty, the line too. A comment that stays on the line stays. */
    function removeRun(list: ts.NamedImports, i: number, j: number): Edit {
        const els = list.elements;
        let start = els[i].getStart();
        let end = els[j].getEnd();
        const after = /^[ 	]*,[ 	]*/.exec(text.slice(end));
        if (after) end += after[0].length;
        // The last name has no comma of its own: take the comma of the one before.
        else if (i > 0) start = els[i - 1].getEnd();
        // On its own line: nothing left but whitespace around the cut means the line goes.
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const lineEndAt = text.indexOf('\n', end);
        const lineEnd = lineEndAt === -1 ? text.length : lineEndAt;
        if (text.slice(lineStart, start).trim() === '' && text.slice(end, lineEnd).trim() === '' && lineStart > list.getStart()) {
            return { start: lineStart, end: lineEndAt === -1 ? text.length : lineEndAt + 1, text: '' };
        }
        // The spaces that separated it from the next name go with it, so `{ A, B, C }` minus B is `{ A, C }`.
        return { start, end, text: '' };
    }
}

function findNamespaceUse(sf: ts.SourceFile, ns: string, names: ReadonlySet<string>): string | undefined {
    let found: string | undefined;
    const visit = (n: ts.Node): void => {
        if (found) return;
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === ns && names.has(n.name.text)) { found = n.name.text; return; }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}
