/**
 * Replaces `{{payload}}` and `{{payload.a.b}}` with values from the payload.
 * Objects are JSON-stringified; missing paths render as `null`.
 */
export function interpolate(template: string, payload: unknown): string {
    return template.replace(/\{\{\s*payload((?:\.[\w-]+)*)\s*\}\}/g, (_match, pathStr: string) => {
        const value = pathStr
            ? pathStr.slice(1).split('.').reduce<unknown>(
                (acc, key) => (acc as Record<string, unknown> | undefined)?.[key],
                payload,
            )
            : payload;
        if (value === undefined || value === null) return 'null';
        return typeof value === 'string' ? value : JSON.stringify(value);
    });
}

const WHOLE_REFERENCE = /^\{\{\s*payload((?:\.[\w-]+)*)\s*\}\}$/;

/**
 * Resolves `{{payload.x}}` in the arguments of a tool step (SPEC-0046), at any depth. A value that is **exactly one reference** keeps its type (a number
 * stays a number, an object an object; a missing path is `null`); any other text is interpolated like a prompt. What is not text is left as it is.
 */
export function interpolateArgs(value: unknown, payload: unknown): unknown {
    if (typeof value === 'string') {
        const whole = WHOLE_REFERENCE.exec(value.trim());
        if (!whole) return interpolate(value, payload);
        const resolved = whole[1]
            ? whole[1].slice(1).split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], payload)
            : payload;
        return resolved === undefined ? null : resolved;
    }
    if (Array.isArray(value)) return value.map(v => interpolateArgs(v, payload));
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolateArgs(v, payload)]));
    return value;
}
