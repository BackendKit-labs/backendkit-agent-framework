import { ToolError } from '../tools/tool-error';

/**
 * The class of an error, safe to put in an audit event: its string `code` (`ECONNRESET`, `ERP_PERIOD_CLOSED`) or, when it
 * has none, its name if that is not the generic `Error` (`TypeError`, `TimeoutError`). Never the message. A `ToolError`
 * is only ever known by its code: its class name says nothing about what went wrong.
 */
export function errorCodeOf(err: unknown): string | undefined {
    if (!err || typeof err !== 'object') return undefined;
    const e = err as { code?: unknown; name?: unknown };
    const clean = (v: unknown): string | undefined =>
        typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(v) ? v : undefined;
    const code = clean(e.code);
    if (code) return code;
    if (err instanceof ToolError) return undefined;
    const name = clean(e.name);
    return name && name !== 'Error' ? name : undefined;
}
