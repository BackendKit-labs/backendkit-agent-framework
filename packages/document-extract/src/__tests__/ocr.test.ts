import http from 'http';
import https from 'https';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractDocument, DocumentExtractError, terminateOcr, type DocumentErrorCode } from '../index';

// A 900x420 invoice drawn as text (24-bit PNG), so the tests need no scanner and no real document.
const INVOICE = readFileSync(join(__dirname, 'fixtures', 'invoice.png'));

/** A PDF whose pages are only the picture (what a scanner or "Print to PDF" of an image makes): no text at all. */
function scannedPdf(png: Buffer, pages: number): Buffer {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const idat: Buffer[] = [];
    for (let at = 8; at < png.length;) {
        const len = png.readUInt32BE(at);
        if (png.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
        at += 12 + len;
    }
    const data = Buffer.concat(idat); // already zlib + PNG-filtered rows: a PDF can take that as it is (Predictor 15)
    const parts: Buffer[] = [];
    const offsets: number[] = [];
    let size = 0;
    const put = (b: Buffer | string) => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(x); size += x.length; };
    const obj = (n: number, body: Buffer | string) => { offsets[n] = size; put(`${n} 0 obj\n`); put(body); put('\nendobj\n'); };
    put('%PDF-1.4\n');
    const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
    obj(3, Buffer.concat([
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${width} >> /Length ${data.length} >>\nstream\n`, 'latin1'),
        data, Buffer.from('\nendstream', 'latin1'),
    ]));
    for (let i = 0; i < pages; i++) {
        const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
        obj(4 + i * 2, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${5 + i * 2} 0 R /Resources << /XObject << /Im0 3 0 R >> >> >>`);
        obj(5 + i * 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    }
    const count = 4 + pages * 2;
    const xref = size;
    put(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1, count).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
    put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return Buffer.concat(parts);
}

async function codeOf(p: Promise<unknown>): Promise<DocumentErrorCode | 'no error'> {
    try { await p; return 'no error'; } catch (e) { return e instanceof DocumentExtractError ? e.code : (() => { throw e; })(); }
}

const SPA = { languages: ['spa'] };

describe('OCR', () => {
    // Anything that tries to reach the network is a failure: on-premise installs have none.
    const attempts: string[] = [];
    const originals = { https: https.request, http: http.request, fetch: globalThis.fetch };
    beforeAll(() => {
        const block = (...a: unknown[]) => { attempts.push(String(a[0])); throw new Error('NETWORK BLOCKED'); };
        (https as { request: unknown }).request = block;
        (http as { request: unknown }).request = block;
        globalThis.fetch = block as never;
    });
    afterAll(async () => {
        (https as { request: unknown }).request = originals.https;
        (http as { request: unknown }).request = originals.http;
        globalThis.fetch = originals.fetch;
        await terminateOcr();
    });

    it('reads an image: the text, a confidence, and it says the text came from OCR', async () => {
        const r = await extractDocument(INVOICE, { ocr: SPA });
        expect(r).toMatchObject({ format: 'image', hasTextLayer: false, truncated: false });
        expect(r.ocr?.images).toBe(1);
        expect(r.ocr?.confidence).toBeGreaterThan(70);
        expect(r.text).toContain('459,80');
        expect(r.text).toMatch(/TOTAL A PAGAR/);
        expect(r.text).toMatch(/B12345678/);
    }, 60000);

    it('reads a scanned PDF (pages that are only a picture) without a canvas', async () => {
        const r = await extractDocument(scannedPdf(INVOICE, 1), { ocr: SPA });
        expect(r).toMatchObject({ format: 'pdf', pages: 1, hasTextLayer: false });
        expect(r.text).toContain('--- page 1 ---');
        expect(r.text).toContain('459,80');
    }, 60000);

    it('a page with no picture big enough to be a scan is drawn and read (needs @napi-rs/canvas)', async () => {
        // minImageSide above the picture size stands in for a PDF that draws its page as many small pieces
        const r = await extractDocument(scannedPdf(INVOICE, 1), { ocr: { ...SPA, minImageSide: 5000, renderScale: 1.5 } });
        expect(r.ocr?.images).toBe(1);
        expect(r.text).toContain('459,80');
    }, 90000);

    it('reads only as many pages of a scan as allowed and says the rest was left out', async () => {
        const r = await extractDocument(scannedPdf(INVOICE, 3), { ocr: { ...SPA, maxPages: 1 } });
        expect(r.pages).toBe(3);
        expect(r.truncated).toBe(true);
        expect(r.text).not.toContain('--- page 2 ---');
    }, 60000);

    it('never touched the network', () => {
        expect(attempts).toEqual([]);
    });

    it('with OCR off, an image or a scan fails with NO_TEXT_LAYER, as before', async () => {
        expect(await codeOf(extractDocument(INVOICE))).toBe('NO_TEXT_LAYER');
        expect(await codeOf(extractDocument(scannedPdf(INVOICE, 1)))).toBe('NO_TEXT_LAYER');
    });

    it('a language whose data is not installed is OCR_UNAVAILABLE, not a download', async () => {
        expect(await codeOf(extractDocument(INVOICE, { ocr: { languages: ['zzz'] } }))).toBe('OCR_UNAVAILABLE');
        expect(await codeOf(extractDocument(INVOICE, { ocr: { languages: ['../etc'] } }))).toBe('OCR_UNAVAILABLE');
        expect(attempts).toEqual([]);
    });

    it('refuses an image that declares an absurd size before decoding it', async () => {
        const bomb = Buffer.from(INVOICE);
        bomb.writeUInt32BE(30000, 16);
        bomb.writeUInt32BE(30000, 20);
        expect(await codeOf(extractDocument(bomb, { ocr: SPA }))).toBe('TOO_LARGE');
    });

    it('a blank image has nothing to read: NO_TEXT_LAYER, not empty text', async () => {
        const { encodePng } = await import('../ocr');
        const white = encodePng(200, 200, 3, new Uint8ClampedArray(200 * 200 * 3).fill(255));
        expect(await codeOf(extractDocument(white, { ocr: SPA }))).toBe('NO_TEXT_LAYER');
    }, 60000);

    it('an aborted signal stops it with TIMEOUT', async () => {
        const ctl = new AbortController();
        ctl.abort();
        expect(await codeOf(extractDocument(INVOICE, { ocr: SPA, signal: ctl.signal }))).toBe('TIMEOUT');
    });

    it('several languages at once (their data lives in separate packages)', async () => {
        const r = await extractDocument(INVOICE, { ocr: { languages: ['spa', 'eng'] } });
        expect(r.text).toContain('459,80');
    }, 90000);
});
