/**
 * A name given to `add ...` becomes a file name and is written into generated source (`id: '<name>'`), so a quote, a slash or
 * a line break in it would escape the file name or break out of the string literal. Only a plain kebab-case name is accepted.
 */
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function assertValidName(kind: string, value: string): void {
    if (!NAME.test(value) || value.length > 60) {
        console.error(`\n✗  Invalid ${kind} "${value.slice(0, 60)}": use lowercase letters, digits and single "-" (e.g. "billing-tools").\n`);
        process.exit(1);
    }
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/** A JS string literal in single quotes, with everything that could end it or the line escaped. */
export function quote(value: string): string {
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .split(LINE_SEPARATOR).join('\\u2028')
        .split(PARAGRAPH_SEPARATOR).join('\\u2029');
    return `'${escaped}'`;
}

/** An MCP server URL must be an absolute http(s) URL. */
export function assertHttpUrl(value: string): void {
    let ok = false;
    try { const u = new URL(value); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* not a URL */ }
    if (!ok) {
        console.error(`\n✗  Invalid MCP server URL "${value.slice(0, 80)}": it must be an absolute http(s) URL.\n`);
        process.exit(1);
    }
}
