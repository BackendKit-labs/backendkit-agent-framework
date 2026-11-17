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
