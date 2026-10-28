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

## Not covered (known)

- **OCR** (scans, images): next slice. Images are not read at all.
- **Legacy `.doc` / `.xls`, PowerPoint, OpenDocument**: `UNSUPPORTED_FORMAT`. Password-protected Office files look like legacy ones and get the same code.
- **ZIP sizes are the declared ones.** The directory is checked before opening, so an honest bomb is refused; an archive that **lies** in its directory is not caught by this check. Run with a memory limit on the process, and a `signal` with a deadline, if the files come from the public.
- **A running parse cannot be interrupted.** On `TIMEOUT` the caller stops waiting and the result is discarded; the library may keep working until it finishes.
- Tables and layout: PDF and Word text is linear; columns of a PDF table may interleave.
- Word: headers, footers, comments and tracked changes are whatever `mammoth` returns as raw text.
- Node ≥ 22 (`unpdf`).

## Tests

`npm test` runs jest with `--experimental-vm-modules`: `unpdf` loads its PDF engine with a dynamic `import()`, which jest's default VM does not allow. Outside jest nothing special is needed.
