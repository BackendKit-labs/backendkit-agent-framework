/**
 * An error of a tool with a stable `code` (`RISK_MAX_POSITION`, `ERP_PERIOD_CLOSED`). The engine puts the code in the audit
 * event of the failed call, and the learning module tells failures of the same tool apart by it. A tool author can declare
 * what to do about each code in `errorHints`.
 *
 * The code starts with a letter and has letters, digits, `_`, `.`, `:` or `-`, up to 64 characters: anything else is not
 * taken as a code (a message must never end up in the audit).
 */
export class ToolError extends Error {
    constructor(readonly code: string, message: string) {
        super(message);
        this.name = 'ToolError';
    }
}

/** The arguments of a call did not match the schema of the tool. */
export class ToolArgumentError extends ToolError {
    constructor(readonly tool: string, readonly issues: string) {
        super('INVALID_ARGUMENTS', `Invalid arguments for tool "${tool}" — ${issues}`);
        this.name = 'ToolArgumentError';
    }
}
