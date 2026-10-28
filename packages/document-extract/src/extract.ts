import { DocumentExtractError } from './errors';
import { listZip } from './zip';
import { DEFAULT_OCR, encodePng, imageKind, ocrImage, type OcrOptions } from './ocr';
import { DEFAULT_LIMITS, type DocumentFormat, type ExtractedDocument, type ExtractLimits, type ExtractOptions } from './types';

/** Fewer visible characters than this in a whole PDF means there is no text layer (a scan), not a short document. */
const MIN_TEXT_CHARS = 10;

/**
 * Turns the bytes of a PDF, Word (.docx), Excel (.xlsx), CSV or text file into text. The format comes from the bytes, never
 * from the name. Nothing is interpreted: the result is the content, for whoever reads it to make sense of.
 */
export async function extractDocument(input: Uint8Array, options: ExtractOptions = {}): Promise<ExtractedDocument> {
    const limits: ExtractLimits = { ...DEFAULT_LIMITS, ...options.limits };
    if (input.byteLength > limits.maxBytes) throw new DocumentExtractError('TOO_LARGE', `${input.byteLength} bytes, limit ${limits.maxBytes}`);
    if (input.byteLength === 0) throw new DocumentExtractError('CORRUPT', 'empty file');

    if (options.signal?.aborted) throw new DocumentExtractError('TIMEOUT'); // before any work starts: nothing is left running
    const format = detect(input, limits, options.filename);
    const ocr = options.ocr ? (options.ocr === true ? {} : options.ocr) : undefined;
    const work = (async () => {
        switch (format) {
            case 'pdf': return fromPdf(input, limits, ocr, options.signal);
            case 'image': return fromImage(input, ocr, options.signal);
            case 'docx': return fromDocx(input);
            case 'xlsx': return fromXlsx(input, limits);
            default: return fromText(input, format);
        }
    })();
    const body = await withAbort(work, options.signal);

    const cut = body.text.length > limits.maxChars;
    return {
        format,
        text: cut ? body.text.slice(0, limits.maxChars) : body.text,
        bytes: input.byteLength,
        ...(body.pages !== undefined ? { pages: body.pages } : {}),
        hasTextLayer: !body.ocr,
        ...(body.ocr ? { ocr: body.ocr } : {}),
        truncated: cut || !!body.truncated,
    };
}

interface Body { text: string; pages?: number; truncated?: boolean; ocr?: { confidence: number; images: number } }

function detect(bytes: Uint8Array, limits: ExtractLimits, filename?: string): DocumentFormat {
    // The PDF header opens the file (after an optional BOM or blank space); a text file that merely mentions it is text.
    const start = Buffer.from(bytes.subarray(0, 64)).toString('latin1').replace(/^(\xEF\xBB\xBF|\s)+/, '');
    if (/^%PDF-\d/.test(start)) return 'pdf';
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
        const { names } = listZip(bytes, limits.maxEntries, limits.maxUncompressedBytes);
        if (names.includes('word/document.xml')) return 'docx';
        if (names.includes('xl/workbook.xml')) return 'xlsx';
        throw new DocumentExtractError('UNSUPPORTED_FORMAT', 'a ZIP that is neither Word nor Excel');
    }
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
        throw new DocumentExtractError('UNSUPPORTED_FORMAT', 'legacy Office (.doc/.xls) or a password-protected Office file');
    }
    if (imageKind(bytes)) return 'image';
    if (bytes.subarray(0, 8000).includes(0)) throw new DocumentExtractError('UNSUPPORTED_FORMAT', 'binary content of an unknown kind');
    return filename && /\.csv$/i.test(filename) ? 'csv' : 'text';
}

function fromText(bytes: Uint8Array, format: DocumentFormat): Body {
    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '') };
    } catch {
        throw new DocumentExtractError('UNSUPPORTED_FORMAT', `${format} that is not UTF-8`);
    }
}

/** An image is only readable with OCR; without it the answer is the same as for a scan: there is no text to extract. */
async function fromImage(bytes: Uint8Array, ocr: OcrOptions | undefined, signal?: AbortSignal): Promise<Body> {
    if (!ocr) throw new DocumentExtractError('NO_TEXT_LAYER', 'an image has no text and OCR is not enabled');
    const { text, confidence } = await ocrImage(Buffer.from(bytes), ocr, signal);
    if (!text) throw new DocumentExtractError('NO_TEXT_LAYER', 'OCR found no text in the image');
    return { text, ocr: { confidence: Math.round(confidence), images: 1 } };
}

/** Largest images are the page scans; tiny ones (logos, rules, masks) are not worth reading. */
const MIN_SCAN_SIDE = 100;
const MAX_IMAGES_PER_PAGE = 20;

async function ocrPdfPages(pdf: PdfProxy, ocr: OcrOptions, signal?: AbortSignal): Promise<Body> {
    const { extractImages } = await import('unpdf');
    const maxPages = ocr.maxPages ?? DEFAULT_OCR.maxPages;
    const out: string[] = [];
    let images = 0;
    let confidenceSum = 0;
    const pages = Math.min(pdf.numPages, maxPages);
    const minSide = ocr.minImageSide ?? MIN_SCAN_SIDE;
    let renderMissing = false;
    for (let p = 1; p <= pages; p++) {
        const found = (await extractImages(pdf, p)).filter(i => i.width >= minSide && i.height >= minSide).slice(0, MAX_IMAGES_PER_PAGE);
        // A real scan is a picture per page; some PDFs (e.g. "Print to PDF" of bitmap text) draw the page as hundreds of tiny
        // pieces or as vectors. Those can only be read by drawing the page, which needs the optional @napi-rs/canvas.
        const pictures = found.map(i => encodePng(i.width, i.height, i.channels, i.data));
        if (!pictures.length) {
            const drawn = await renderPage(pdf, p, ocr.renderScale ?? 2);
            if (drawn) pictures.push(drawn); else renderMissing = true;
        }
        const parts: string[] = [];
        for (const picture of pictures) {
            const r = await ocrImage(picture, ocr, signal);
            images++;
            confidenceSum += r.confidence;
            if (r.text) parts.push(r.text);
        }
        out.push(`--- page ${p} ---\n${parts.join('\n')}`);
    }
    if (out.every(page => page.replace(/^--- page \d+ ---\s*/, '') === '')) {
        if (renderMissing) throw new DocumentExtractError('OCR_UNAVAILABLE', 'this PDF draws its pages without one picture per page; reading it needs @napi-rs/canvas to draw them');
        throw new DocumentExtractError('NO_TEXT_LAYER', 'OCR found no text in the scanned pages');
    }
    return { text: out.join('\n\n'), pages: pdf.numPages, truncated: pdf.numPages > pages, ocr: { confidence: images ? Math.round(confidenceSum / images) : 0, images } };
}

/** The page drawn as a PNG, or undefined when the optional canvas package is not installed. */
async function renderPage(pdf: PdfProxy, page: number, scale: number): Promise<Buffer | undefined> {
    const { renderPageAsImage } = await import('unpdf');
    try {
        await import('@napi-rs/canvas');
    } catch {
        return undefined;
    }
    return Buffer.from(await renderPageAsImage(pdf, page, { canvasImport: () => import('@napi-rs/canvas'), scale }));
}

type PdfProxy =Awaited<ReturnType<typeof import('unpdf').getDocumentProxy>>;

async function fromPdf(bytes: Uint8Array, limits: ExtractLimits, ocr: OcrOptions | undefined, signal?: AbortSignal): Promise<Body> {
    const { getDocumentProxy, extractText } = await import('unpdf');
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
        pdf = await getDocumentProxy(new Uint8Array(bytes)); // a copy: the library takes ownership of the buffer it is given
    } catch (err) {
        throw pdfError(err);
    }
    try {
        if (pdf.numPages > limits.maxPages) throw new DocumentExtractError('TOO_MANY_PAGES', `${pdf.numPages} pages, limit ${limits.maxPages}`);
        const { text } = await extractText(pdf, { mergePages: false });
        const pages = text as string[];
        if (pages.join('').replace(/\s/g, '').length < MIN_TEXT_CHARS) {
            if (ocr) return await ocrPdfPages(pdf, ocr, signal); // a scan: read the page images
            throw new DocumentExtractError('NO_TEXT_LAYER');
        }
        return { text: pages.map((t, i) => `--- page ${i + 1} ---\n${t.trim()}`).join('\n\n'), pages: pdf.numPages };
    } catch (err) {
        throw err instanceof DocumentExtractError ? err : pdfError(err);
    } finally {
        await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
    }
}

function pdfError(err: unknown): DocumentExtractError {
    const name = (err as { name?: string })?.name;
    if (name === 'PasswordException') return new DocumentExtractError('ENCRYPTED');
    return new DocumentExtractError('CORRUPT', `the PDF could not be read (${name ?? 'error'}: ${(err as Error)?.message ?? ''})`.slice(0, 200));
}

async function fromDocx(bytes: Uint8Array): Promise<Body> {
    const mammoth = await import('mammoth');
    try {
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        return { text: value };
    } catch {
        throw new DocumentExtractError('CORRUPT', 'the Word file could not be read');
    }
}

async function fromXlsx(bytes: Uint8Array, limits: ExtractLimits): Promise<Body> {
    const { default: readXlsxFile } = await import('read-excel-file/universal');
    let sheets: Array<{ sheet: string; data: unknown[][] }>;
    try {
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        sheets = (await readXlsxFile(buffer)) as typeof sheets;
    } catch {
        throw new DocumentExtractError('CORRUPT', 'the Excel file could not be read');
    }
    if (sheets.length > limits.maxPages) throw new DocumentExtractError('TOO_MANY_PAGES', `${sheets.length} sheets, limit ${limits.maxPages}`);
    const out: string[] = [];
    let size = 0;
    for (const { sheet, data } of sheets) {
        out.push(`--- sheet "${sheet}" ---`);
        for (const row of data) {
            const line = row.map(cell).join('\t');
            out.push(line);
            size += line.length + 1;
            if (size > limits.maxChars) return { text: out.join('\n'), pages: sheets.length }; // already over the cap: the caller cuts and flags it
        }
    }
    return { text: out.join('\n'), pages: sheets.length };
}

function cell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value).replace(/[\t\r\n]+/g, ' ');
}

function withAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return work;
    if (signal.aborted) return Promise.reject(new DocumentExtractError('TIMEOUT'));
    return new Promise<T>((resolve, reject) => {
        // If the caller stops waiting, the work may still fail later: that failure must not surface as an unhandled rejection.
        work.catch(() => undefined);
        const onAbort = () => reject(new DocumentExtractError('TIMEOUT'));
        signal.addEventListener('abort', onAbort, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}
