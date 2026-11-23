import type { OcrOptions } from './ocr';

export type DocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'text' | 'image';

export interface ExtractLimits {
    /** Size of the file itself. Default 20 MiB. */
    maxBytes: number;
    /** Pages (PDF) or sheets (Excel). Default 200. */
    maxPages: number;
    /** What a docx/xlsx expands to, measured by inflating it (the declared size is not trusted). Default 100 MiB. */
    maxUncompressedBytes: number;
    /** Parts inside a docx/xlsx. Default 2000. */
    maxEntries: number;
    /** Characters of text returned; beyond it the text is cut and `truncated` is set. Default 200 000. */
    maxChars: number;
}

export interface ExtractOptions {
    limits?: Partial<ExtractLimits>;
    /** Aborting it makes the call fail with TIMEOUT (a library already running cannot be interrupted, but its result is discarded). */
    signal?: AbortSignal;
    /** Only used to tell CSV from plain text; the format itself is always taken from the bytes. */
    filename?: string;
    /**
     * Read images and scanned PDFs with OCR. Off by default: it needs tesseract.js and language data installed, loads a
     * ~30 MB engine and is slow. Without it an image, or a PDF with no text, fails with NO_TEXT_LAYER.
     */
    ocr?: boolean | OcrOptions;
}

export interface ExtractedDocument {
    format: DocumentFormat;
    /** The text, with `--- page N ---` (PDF) or `--- sheet "name" ---` (Excel) markers. Not interpreted: what it means is for the reader. */
    text: string;
    bytes: number;
    /** Pages of a PDF, or sheets of a workbook. */
    pages?: number;
    /** False when the text came from OCR. A file with nothing to read fails with NO_TEXT_LAYER instead of returning empty. */
    hasTextLayer: boolean;
    /** Present when the text was read by OCR: the mean confidence (0-100) and the images read. Treat low confidence with care. */
    ocr?: { confidence: number; images: number };
    truncated: boolean;
}

export const DEFAULT_LIMITS: ExtractLimits = {
    maxBytes: 20 * 1024 * 1024,
    maxPages: 200,
    maxUncompressedBytes: 100 * 1024 * 1024,
    maxEntries: 2000,
    maxChars: 200_000,
};
