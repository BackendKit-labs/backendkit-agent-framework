/** Stable codes: a caller (or the model) can act on the code without parsing the message. */
export type DocumentErrorCode =
    | 'UNSUPPORTED_FORMAT'
    | 'TOO_LARGE'
    | 'TOO_MANY_PAGES'
    | 'ARCHIVE_TOO_LARGE'
    | 'ENCRYPTED'
    | 'CORRUPT'
    | 'NO_TEXT_LAYER'
    | 'TIMEOUT';

const RECOVERY: Record<DocumentErrorCode, string> = {
    UNSUPPORTED_FORMAT: 'Only PDF, Word (.docx), Excel (.xlsx), CSV and plain text can be read. Ask for the file in one of those formats.',
    TOO_LARGE: 'The file exceeds the size limit. Ask for a smaller file or a part of it.',
    TOO_MANY_PAGES: 'The document has more pages or sheets than the limit. Ask for the relevant part.',
    ARCHIVE_TOO_LARGE: 'The file expands to more than the limit (or has too many parts) and was not opened. Ask for a smaller file.',
    ENCRYPTED: 'The file is password-protected. Ask the person for an unprotected copy.',
    CORRUPT: 'The file could not be read; it may be damaged or truncated. Ask for the file again.',
    NO_TEXT_LAYER: 'The file has no text to extract (probably a scan or an image). It needs OCR, which is not available here; tell the person.',
    TIMEOUT: 'Reading the file took too long. Ask for a smaller file.',
};

export class DocumentExtractError extends Error {
    readonly recovery: string;

    constructor(readonly code: DocumentErrorCode, detail?: string) {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'DocumentExtractError';
        this.recovery = RECOVERY[code];
    }
}
