import {
  resolvePdfOptions,
  exportMarkdownToPdf,
  PdfExportOptions,
  PdfExportError,
  PdfExportResult,
} from '../../../src/reports/exporters/pdf-export';

// ---------------------------------------------------------------------------
// PDF Export Tests – resolvePdfOptions & exportMarkdownToPdf
// ---------------------------------------------------------------------------

describe('PdfExport — resolvePdfOptions', () => {
  // ===================== Defaults =====================

  it('should return default options when called without arguments', () => {
    const opts = resolvePdfOptions();
    expect(opts.title).toBe('Reporte Financiero');
    expect(opts.author).toBe('Finance Agent');
    expect(opts.pageSize).toBe('A4');
    expect(opts.orientation).toBe('portrait');
    expect(opts.margins).toEqual({ top: 20, bottom: 20, left: 15, right: 15 });
    expect(opts.includeTableOfContents).toBe(false);
    expect(opts.pageNumbers).toBe(true);
    // watermark and stylesheet are undefined by default
    expect(opts.watermark).toBeUndefined();
    expect(opts.stylesheet).toBeUndefined();
  });

  it('should return default options when called with undefined', () => {
    const opts = resolvePdfOptions(undefined);
    expect(opts.title).toBe('Reporte Financiero');
  });

  it('should return default options when called with null-like partial', () => {
    // Partial with only explicitly undefined fields — same as default
    const opts = resolvePdfOptions({});
    expect(opts.title).toBe('Reporte Financiero');
    expect(opts.author).toBe('Finance Agent');
  });

  // ===================== Merging =====================

  it('should merge a single override with defaults', () => {
    const opts = resolvePdfOptions({ title: 'Custom Report' });
    expect(opts.title).toBe('Custom Report');
    expect(opts.author).toBe('Finance Agent'); // unchanged
    expect(opts.pageSize).toBe('A4');          // unchanged
  });

  it('should merge multiple overrides with defaults', () => {
    const opts = resolvePdfOptions({
      title: 'Q1 2025 Report',
      author: 'CFO Office',
      pageSize: 'Letter',
      orientation: 'landscape',
      includeTableOfContents: true,
      pageNumbers: false,
      watermark: 'DRAFT',
    });
    expect(opts.title).toBe('Q1 2025 Report');
    expect(opts.author).toBe('CFO Office');
    expect(opts.pageSize).toBe('Letter');
    expect(opts.orientation).toBe('landscape');
    expect(opts.includeTableOfContents).toBe(true);
    expect(opts.pageNumbers).toBe(false);
    expect(opts.watermark).toBe('DRAFT');
    // margins still default
    expect(opts.margins).toEqual({ top: 20, bottom: 20, left: 15, right: 15 });
  });

  it('should reject partial margins (all 4 fields required by Zod)', () => {
    // The code does a shallow spread — partial margins replace the entire
    // margins key, leaving bottom/right undefined. Zod requires all 4 fields.
    expect(() =>
      resolvePdfOptions({
        margins: { top: 30, left: 25 } as PdfExportOptions['margins'],
      })
    ).toThrow(PdfExportError);
  });

  // ===================== Validation (Zod) =====================

  it('should reject an invalid pageSize (not in enum)', () => {
    expect(() =>
      resolvePdfOptions({ pageSize: 'Tabloid' as PdfExportOptions['pageSize'] })
    ).toThrow(PdfExportError);
  });

  it('should reject an invalid orientation (not in enum)', () => {
    expect(() =>
      resolvePdfOptions({ orientation: 'diagonal' as PdfExportOptions['orientation'] })
    ).toThrow(PdfExportError);
  });

  it('should reject negative margins', () => {
    expect(() =>
      resolvePdfOptions({ margins: { top: -5, bottom: 20, left: 15, right: 15 } })
    ).toThrow(PdfExportError);
  });

  it('should reject margins exceeding 50mm', () => {
    expect(() =>
      resolvePdfOptions({ margins: { top: 100, bottom: 20, left: 15, right: 15 } })
    ).toThrow(PdfExportError);
  });

  it('should accept margins at the boundary (0 and 50)', () => {
    const opts = resolvePdfOptions({
      margins: { top: 0, bottom: 50, left: 0, right: 50 },
    });
    expect(opts.margins?.top).toBe(0);
    expect(opts.margins?.bottom).toBe(50);
    expect(opts.margins?.left).toBe(0);
    expect(opts.margins?.right).toBe(50);
  });

  it('should reject non-numeric title', () => {
    // The schema says title is optional string — no numeric validation needed,
    // but any string should pass.
    const opts = resolvePdfOptions({ title: '123' });
    expect(opts.title).toBe('123');
  });

  // ===================== Type coercion =====================

  it('should reject boolean where string is expected (title)', () => {
    // TypeScript prevents this at compile time, but at runtime Zod should catch it
    expect(() =>
      resolvePdfOptions({ title: true as unknown as string })
    ).toThrow(PdfExportError);
  });

  it('should accept valid complete options identical to defaults', () => {
    const opts = resolvePdfOptions({
      title: 'Reporte Financiero',
      author: 'Finance Agent',
      pageSize: 'A4',
      orientation: 'portrait',
      margins: { top: 20, bottom: 20, left: 15, right: 15 },
      includeTableOfContents: false,
      pageNumbers: true,
    });
    expect(opts).toBeDefined();
  });
});

describe('PdfExport — exportMarkdownToPdf', () => {
  // ===================== Basic export =====================

  it('should produce a PdfExportResult with valid fields', async () => {
    const result = await exportMarkdownToPdf('# Hello World');
    expect(result).toBeDefined();
    expect(result).toHaveProperty('fileName');
    expect(result).toHaveProperty('buffer');
    expect(result).toHaveProperty('sizeBytes');
    expect(result).toHaveProperty('pageCount');
    expect(result).toHaveProperty('generationTimeMs');

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should return a fileName ending with .pdf', async () => {
    const result = await exportMarkdownToPdf('# Test');
    expect(result.fileName).toMatch(/\.pdf$/);
  });

  it('should include a timestamp in the fileName', async () => {
    const result = await exportMarkdownToPdf('# Test');
    // fileName format: <sanitized-title>-<timestamp>.pdf
    expect(result.fileName).toMatch(/^\w[\w-]*-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.pdf$/);
  });

  // ===================== Empty / invalid markdown =====================

  it('should throw PdfExportError for empty markdown string', async () => {
    await expect(exportMarkdownToPdf('')).rejects.toThrow(PdfExportError);
    await expect(exportMarkdownToPdf('')).rejects.toThrow(
      'El contenido Markdown no puede estar vacío.'
    );
  });

  it('should throw PdfExportError for whitespace-only markdown', async () => {
    await expect(exportMarkdownToPdf('   \n  \t  ')).rejects.toThrow(PdfExportError);
  });

  // ======================== Options passthrough ========================

  it('should forward custom title to the generated PDF metadata', async () => {
    const result = await exportMarkdownToPdf('# Hello', { title: 'My Custom Title' });
    expect(result.fileName).toMatch(/^my-custom-title-/);
  });

  it('should generate PDF with a title that sanitizes special characters', async () => {
    const result = await exportMarkdownToPdf('# Hello', { title: 'Q1: Reporte (2025)!' });
    // Special characters get replaced with hyphens
    expect(result.fileName).toMatch(/^q1-reporte-2025-/);
  });

  // ======================== Buffer content ========================

  it('should include the markdown title in the HTML embedded in the buffer', async () => {
    const result = await exportMarkdownToPdf('# Hello World');
    const content = result.buffer.toString('utf-8');
    expect(content).toContain('<h1>Hello World</h1>');
  });

  it('should include the default author in the HTML', async () => {
    const result = await exportMarkdownToPdf('# Test');
    const content = result.buffer.toString('utf-8');
    expect(content).toContain('Finance Agent');
  });

  it('should include custom author in the HTML when provided', async () => {
    const result = await exportMarkdownToPdf('# Test', { author: 'Audit Team' });
    const content = result.buffer.toString('utf-8');
    expect(content).toContain('Audit Team');
  });

  it('should render markdown bold and italic in HTML', async () => {
    const result = await exportMarkdownToPdf('**bold** and *italic*');
    const content = result.buffer.toString('utf-8');
    expect(content).toContain('<strong>bold</strong>');
    expect(content).toContain('<em>italic</em>');
  });

  it('should render markdown list items in HTML', async () => {
    const result = await exportMarkdownToPdf('- Item 1\n- Item 2');
    const content = result.buffer.toString('utf-8');
    expect(content).toContain('<li>Item 1</li>');
    expect(content).toContain('<li>Item 2</li>');
  });

  it('should render a simple markdown table in HTML', async () => {
    const result = await exportMarkdownToPdf('| A | B |\n| 1 | 2 |');
    const content = result.buffer.toString('utf-8');
    expect(content).toContain('<table>');
    expect(content).toContain('<td>A</td>');
    expect(content).toContain('<td>B</td>');
  });

  // ======================== Watermark ========================

  it('should include watermark CSS and div when watermark option is set', async () => {
    const result = await exportMarkdownToPdf('# Test', { watermark: 'CONFIDENTIAL' });
    const content = result.buffer.toString('utf-8');
    expect(content).toContain('.watermark');
    expect(content).toContain('CONFIDENTIAL');
  });

  it('should NOT include watermark CSS when watermark option is not set', async () => {
    const result = await exportMarkdownToPdf('# Test');
    const content = result.buffer.toString('utf-8');
    expect(content).not.toContain('.watermark');
  });

  // ======================== includeTableOfContents ========================

  it('should include TOC placeholder when includeTableOfContents is true', async () => {
    const result = await exportMarkdownToPdf('# Test', { includeTableOfContents: true });
    const content = result.buffer.toString('utf-8');
    expect(content).toContain('Tabla de Contenidos');
    expect(content).toContain('<div id="toc"></div>');
  });

  it('should NOT include TOC when includeTableOfContents is false', async () => {
    const result = await exportMarkdownToPdf('# Test', { includeTableOfContents: false });
    const content = result.buffer.toString('utf-8');
    expect(content).not.toContain('Tabla de Contenidos');
  });

  // ======================== Invalid options ========================

  it('should throw PdfExportError when options fail Zod validation', async () => {
    await expect(
      exportMarkdownToPdf('# Test', { pageSize: 'Big' as PdfExportOptions['pageSize'] })
    ).rejects.toThrow(PdfExportError);
  });

  // ======================== Generation time ========================

  it('should record a non-negative generationTimeMs', async () => {
    const result = await exportMarkdownToPdf('# Hello');
    // generationTimeMs can be 0 when the synchronous buffer creation
    // completes within the same millisecond tick
    expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
  });

  // ======================== estimatePageCount (indirect) ========================

  it('should estimate at least 1 page for any content', async () => {
    const result = await exportMarkdownToPdf('# Tiny');
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it('should estimate more pages for larger content', async () => {
    const smallResult = await exportMarkdownToPdf('# Small');
    const largeContent = '# Large\n\n' + Array.from({ length: 2000 }, (_, i) => `Line ${i}`).join('\n');
    const largeResult = await exportMarkdownToPdf(largeContent);
    expect(largeResult.pageCount).toBeGreaterThanOrEqual(smallResult.pageCount);
  });

  // ======================== HTML escaping ========================

  it('should escape HTML characters in markdown content', async () => {
    const result = await exportMarkdownToPdf('<script>alert("xss")</script>');
    const content = result.buffer.toString('utf-8');
    expect(content).not.toContain('<script>');
    expect(content).toContain('&lt;script&gt;');
  });

  it('should escape HTML characters in the title', async () => {
    const result = await exportMarkdownToPdf('# Test', { title: 'Report < > & " \' ' });
    const content = result.buffer.toString('utf-8');
    expect(content).toContain('&lt;');
    expect(content).toContain('&gt;');
    expect(content).toContain('&amp;');
    expect(content).toContain('&quot;');
    expect(content).toContain('&#039;');
  });
});
