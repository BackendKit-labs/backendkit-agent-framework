# @backendkit-labs/document-extract

Text out of PDF, Word (`.docx`), Excel (`.xlsx`), CSV and plain-text files, for agents. SPEC-0012, layer 1.

It extracts **content**, not meaning: no "invoice total" or "supplier" fields. What a document is and what to do with it is for the agent (or the host) reading the text.

```ts
import { extractDocument } from '@backendkit-labs/document-extract';

const doc = await extractDocument(bytes, { filename: 'invoice.pdf', limits: { maxPages: 50 }, signal });
// { format: 'pdf', text: '--- page 1 ---\n...', pages: 2, bytes: 48211, hasTextLayer: true, truncated: false }
```

As a tool for an agent (`read_document`, reads a file under the working directory):

```ts
import { createReadDocumentTool } from '@backendkit-labs/document-extract';
const tool = createReadDocumentTool({ limits: { maxBytes: 5 * 1024 * 1024 } });
```

The tool returns the text between `<document-content …>` tags and tells the model it is data, not instructions. A host that keeps uploads by id instead of by path (e.g. a server) should call `extractDocument` directly, or pass `resolvePath` to the tool.

## What it does

| Input | How | Marker in the text |
|---|---|---|
| PDF with a text layer | `unpdf` | `--- page N ---` |
| `.docx` | `mammoth` (raw text) | none |
| `.xlsx` | `read-excel-file` (cells as tab-separated rows) | `--- sheet "name" ---` |
| CSV, text | built in (UTF-8, BOM removed) | none |

The format is taken from the **bytes** (PDF header; ZIP directory with `word/document.xml` or `xl/workbook.xml`), never from the name. The name is only used to tell CSV from text.

## Limits and errors

Every limit has a default and can be changed (`ExtractLimits`): file size (20 MiB), pages/sheets (200), what a ZIP declares to expand to (100 MiB), parts in a ZIP (2000), characters returned (200 000; beyond it the text is cut and `truncated` is true). An aborted `signal` ends with `TIMEOUT`.

Failures are `DocumentExtractError` with a stable `code` and a `recovery` sentence for the model: `UNSUPPORTED_FORMAT`, `TOO_LARGE`, `TOO_MANY_PAGES`, `ARCHIVE_TOO_LARGE`, `ENCRYPTED`, `CORRUPT`, `NO_TEXT_LAYER`, `TIMEOUT`.

A PDF with no text (a scan, or "Print to PDF" of images) fails with `NO_TEXT_LAYER` rather than returning empty text: it needs OCR, which this package does not do yet.

## OCR (images and scanned PDFs)

Off by default. Turn it on per call (`ocr: true` or `ocr: { languages: ['spa', 'eng'] }`) or in the tool (`createReadDocumentTool({ ocr: … })`). It reads PNG and JPEG files, and PDFs with no text layer.

```ts
const doc = await extractDocument(bytes, { ocr: { languages: ['spa'] } });
// doc.hasTextLayer === false, doc.ocr === { confidence: 92, images: 1 }
await terminateOcr(); // when the host shuts down: the OCR workers keep a Node process alive
```

- **Install what you use** (all optional): `tesseract.js` (engine, ~30 MB), `@tesseract.js-data/<lang>` (one per language, ~10–14 MB), and `@napi-rs/canvas` only for PDFs that are not "a picture per page".
- **It never uses the network.** The engine and the language data come from the installed packages (or `ocr.langPath` / `ocr.corePath`); if they are missing the call fails with `OCR_UNAVAILABLE` instead of downloading. The tests intercept `http`, `https` and `fetch` and assert zero attempts.
- **Scanned PDFs without a canvas:** a scan is normally one picture per page; the pictures are taken out of the PDF and read directly. A PDF that draws its page as many tiny pieces or as vectors (e.g. "Microsoft Print To PDF" of bitmap text) has no such picture: the page is drawn with `@napi-rs/canvas` (a native binary) and read. Without it: `OCR_UNAVAILABLE`.
- **Bounds:** pages read (`maxPages`, 20; the rest is left out and `truncated` is set), pixels per image (`maxPixels`, 40 M, checked from the header before decoding), the file size and `signal`. Aborting the signal stops the recognition in progress.
- **Cost:** about a second to start the engine and a second per page (more on large pages; drawing a page adds seconds).
- **Result:** `text` as usual, `hasTextLayer: false`, and `ocr: { confidence (0–100, mean), images }`. A page with nothing readable fails with `NO_TEXT_LAYER`.

## Not covered (known)

- **Images other than PNG and JPEG** (WebP, TIFF, GIF, HEIC): `UNSUPPORTED_FORMAT`. OCR output is text read by a machine: it can be wrong, and handwriting, stamps, tables and columns are weak points. `ocr.confidence` is there to be used.
- **Page order of a scan** with several pictures per page follows the order the PDF draws them, not where they sit on the page.
- **Legacy `.doc` / `.xls`, PowerPoint, OpenDocument**: `UNSUPPORTED_FORMAT`. Password-protected Office files look like legacy ones and get the same code.
- **ZIP sizes are the declared ones.** The directory is checked before opening, so an honest bomb is refused; an archive that **lies** in its directory is not caught by this check. Run with a memory limit on the process, and a `signal` with a deadline, if the files come from the public.
- **A running parse cannot be interrupted.** On `TIMEOUT` the caller stops waiting and the result is discarded; the library may keep working until it finishes.
- Tables and layout: PDF and Word text is linear; columns of a PDF table may interleave.
- Word: headers, footers, comments and tracked changes are whatever `mammoth` returns as raw text.
- Node ≥ 22 (`unpdf`).

## Tests

`npm test` runs jest with `--experimental-vm-modules`: `unpdf` loads its PDF engine with a dynamic `import()`, which jest's default VM does not allow. Outside jest nothing special is needed.
