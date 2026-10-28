import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { deflateSync } from 'zlib';
import { DocumentExtractError } from './errors';

/**
 * OCR runs on tesseract.js, loaded only when OCR is asked for. It never downloads anything: the engine and the language
 * data come from installed packages (`tesseract.js`, `@tesseract.js-data/<lang>`) or from paths the host gives. If they
 * are not there the call fails with OCR_UNAVAILABLE instead of reaching for the network.
 */
export interface OcrOptions {
    /** Tesseract language codes, e.g. ['spa', 'eng']. Default ['eng']. */
    languages?: string[];
    /** Directory holding `<lang>.traineddata(.gz)` for every language. Default: the installed `@tesseract.js-data/<lang>` packages. */
    langPath?: string;
    /** Directory of `tesseract.js-core`. Default: the installed one. */
    corePath?: string;
    /** Pages of a scanned PDF to read; the rest are ignored and `truncated` is set. Default 20. */
    maxPages?: number;
    /** Smallest side (px) of a picture in a PDF page to count as a scan of it; pages without one are drawn instead. Default 100. */
    minImageSide?: number;
    /** Scale used to draw a page that has no scan (needs @napi-rs/canvas). Default 2. */
    renderScale?: number;
    /** An image bigger than this many pixels is refused before decoding (decompression bombs). Default 40 000 000. */
    maxPixels?: number;
}

export interface OcrResult { text: string; confidence: number }

export const DEFAULT_OCR = { languages: ['eng'], maxPages: 20, maxPixels: 40_000_000 };

const DATA_VERSION = '4.0.0_best_int';
const nodeRequire = createRequire(__filename);

interface WorkerLike {
    recognize(image: Buffer): Promise<{ data: { text: string; confidence: number } }>;
    terminate(): Promise<unknown>;
}
const workers = new Map<string, Promise<WorkerLike>>();
let queue: Promise<unknown> = Promise.resolve();

/** Stops every OCR worker. Call it when the host shuts down (the workers keep a Node process alive). */
export async function terminateOcr(): Promise<void> {
    const all = [...workers.values()];
    workers.clear();
    await Promise.all(all.map(w => w.then(x => x.terminate()).catch(() => undefined)));
}

export async function ocrImage(image: Buffer, options: OcrOptions, signal?: AbortSignal): Promise<OcrResult> {
    checkPixels(image, options.maxPixels ?? DEFAULT_OCR.maxPixels);
    const worker = await workerFor(options);
    const key = keyOf(options);
    const run = queue.then(async () => {
        if (signal?.aborted) throw new DocumentExtractError('TIMEOUT');
        // Aborting is the one way to interrupt a recognition in progress: the worker is stopped and rebuilt next time.
        const stop = () => { workers.delete(key); void worker.terminate().catch(() => undefined); };
        signal?.addEventListener('abort', stop, { once: true });
        try {
            const { data } = await worker.recognize(image);
            return { text: data.text.trim(), confidence: data.confidence };
        } catch (err) {
            if (signal?.aborted) throw new DocumentExtractError('TIMEOUT');
            throw new DocumentExtractError('CORRUPT', `OCR failed: ${(err as Error)?.message ?? err}`.slice(0, 200));
        } finally {
            signal?.removeEventListener('abort', stop);
        }
    });
    queue = run.catch(() => undefined);
    return run;
}

const keyOf = (o: OcrOptions) => JSON.stringify([o.languages ?? DEFAULT_OCR.languages, o.langPath ?? '', o.corePath ?? '']);

function workerFor(options: OcrOptions): Promise<WorkerLike> {
    const key = keyOf(options);
    let w = workers.get(key);
    if (!w) {
        w = createWorker(options);
        workers.set(key, w);
        w.catch(() => workers.delete(key)); // a failed start is retried by the next call
    }
    return w;
}

async function createWorker(options: OcrOptions): Promise<WorkerLike> {
    const languages = options.languages ?? DEFAULT_OCR.languages;
    let tesseract: typeof import('tesseract.js');
    try {
        tesseract = await import('tesseract.js');
    } catch {
        throw new DocumentExtractError('OCR_UNAVAILABLE', 'the tesseract.js package is not installed');
    }
    const langPath = options.langPath ?? languageDirectory(languages);
    const corePath = options.corePath ?? coreDirectory();
    try {
        // gzip: the packaged data is .gz; cacheMethod none: nothing is written or fetched.
        return (await tesseract.createWorker(languages.join('+'), 1, { langPath, corePath, gzip: !options.langPath, cacheMethod: 'none', logger: () => undefined })) as unknown as WorkerLike;
    } catch (err) {
        throw new DocumentExtractError('OCR_UNAVAILABLE', `the OCR engine could not start (${(err as Error)?.message ?? err})`.slice(0, 200));
    }
}

function coreDirectory(): string {
    try {
        let from = [__dirname];
        try { from = [dirname(nodeRequire.resolve('tesseract.js'))]; } catch { /* resolved from this package instead */ }
        return dirname(nodeRequire.resolve('tesseract.js-core/package.json', { paths: from }));
    } catch {
        throw new DocumentExtractError('OCR_UNAVAILABLE', 'tesseract.js-core is not installed');
    }
}

/** One directory with every language: the installed data packages, gathered into a cache directory when they live apart. */
function languageDirectory(languages: string[]): string {
    const files = languages.map(lang => {
        if (!/^[a-z_]{2,12}$/i.test(lang)) throw new DocumentExtractError('OCR_UNAVAILABLE', `invalid language code "${lang}"`);
        try {
            return { lang, dir: join(dirname(nodeRequire.resolve(`@tesseract.js-data/${lang}/package.json`)), DATA_VERSION) };
        } catch {
            throw new DocumentExtractError('OCR_UNAVAILABLE', `no data for language "${lang}": install @tesseract.js-data/${lang} or pass langPath`);
        }
    });
    if (new Set(files.map(f => f.dir)).size === 1) return files[0].dir;
    const target = join(tmpdir(), `bk-document-extract-ocr-${DATA_VERSION}`);
    mkdirSync(target, { recursive: true });
    for (const { lang, dir } of files) {
        const name = `${lang}.traineddata.gz`;
        if (!existsSync(join(target, name))) copyFileSync(join(dir, name), join(target, name));
    }
    return target;
}

// ── images ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function imageKind(bytes: Uint8Array): 'png' | 'jpeg' | undefined {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d) return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
    return undefined;
}

/** Width and height from the header, before anything decodes the image. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const kind = imageKind(bytes);
    if (kind === 'png') return bytes.length >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : undefined;
    if (kind === 'jpeg') {
        let at = 2;
        while (at + 9 < bytes.length) {
            if (bytes[at] !== 0xff) { at++; continue; }
            const marker = bytes[at + 1];
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
            }
            if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue; }
            at += 2 + view.getUint16(at + 2);
        }
    }
    return undefined;
}

function checkPixels(image: Uint8Array, maxPixels: number): void {
    const size = imageSize(image);
    if (!size || size.width === 0 || size.height === 0) throw new DocumentExtractError('CORRUPT', 'the image header is not readable');
    if (size.width * size.height > maxPixels) throw new DocumentExtractError('TOO_LARGE', `${size.width}x${size.height} pixels, limit ${maxPixels}`);
}

// ── raw pixels (what a PDF scan holds) to PNG ──────────────────────────────────────────────────────────────

const CRC = (() => {
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf: Uint8Array): number {
    let x = 0xffffffff;
    for (const v of buf) x = CRC[(x ^ v) & 255] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

export function encodePng(width: number, height: number, channels: 1 | 3 | 4, pixels: Uint8ClampedArray): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
    const stride = width * channels;
    const raw = Buffer.alloc((stride + 1) * height); // each row starts with filter type 0
    for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
