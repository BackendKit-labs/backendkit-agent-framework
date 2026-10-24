/**
 * A skill or pack name ends up as a file or directory name, and it comes from content the installer does
 * not control (a downloaded skill's frontmatter, a source URL). Anything that could leave the target
 * directory or address a different file is refused: path separators, drive/stream colons, NUL, "." and "..".
 */
const MAX_NAME_LENGTH = 100;

const FORBIDDEN_CHARS = /[\\/:\u0000]/;

export function assertSafeFileName(kind: string, value: string): void {
    const bad =
        value.length === 0 ||
        value.length > MAX_NAME_LENGTH ||
        value === '.' ||
        value === '..' ||
        FORBIDDEN_CHARS.test(value);
    if (bad) {
        throw new Error(
            `Unsafe ${kind} ${JSON.stringify(value.slice(0, 60))}: it must be 1-${MAX_NAME_LENGTH} characters, ` +
            'not "." or "..", and contain no "/", "\\", ":" or NUL.',
        );
    }
}
