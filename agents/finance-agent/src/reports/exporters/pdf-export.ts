import { z } from 'zod';

// ---------------------------------------------------------------------------
// PDF Export — Markdown → PDF (via puppeteer / markdown-pdf)
// ---------------------------------------------------------------------------

/**
 * Opciones de configuración para la exportación a PDF.
 */
export interface PdfExportOptions {
  /** Título del documento (se usa en metadatos y encabezado) */
  title?: string;
  /** Autor del documento */
  author?: string;
  /** Tamaño de página: A4, Letter, etc. */
  pageSize?: 'A4' | 'Letter' | 'Legal';
  /** Orientación de página */
  orientation?: 'portrait' | 'landscape';
  /** Márgenes en mm */
  margins?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  /** Ruta o URL de la hoja de estilos CSS personalizada */
  stylesheet?: string;
  /** Incluir tabla de contenidos */
  includeTableOfContents?: boolean;
  /** Número de página en el pie */
  pageNumbers?: boolean;
  /** Marca de agua (texto superpuesto) */
  watermark?: string;
}

/**
 * Opciones por defecto para la exportación PDF.
 */
const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  title: 'Reporte Financiero',
  author: 'Finance Agent',
  pageSize: 'A4',
  orientation: 'portrait',
  margins: {
    top: 20,
    bottom: 20,
    left: 15,
    right: 15,
  },
  includeTableOfContents: false,
  pageNumbers: true,
};

/**
 * Esquema Zod para validar opciones de exportación PDF.
 */
export const PdfExportOptionsSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  pageSize: z.enum(['A4', 'Letter', 'Legal']).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  margins: z
    .object({
      top: z.number().min(0).max(50),
      bottom: z.number().min(0).max(50),
      left: z.number().min(0).max(50),
      right: z.number().min(0).max(50),
    })
    .optional(),
  stylesheet: z.string().optional(),
  includeTableOfContents: z.boolean().optional(),
  pageNumbers: z.boolean().optional(),
  watermark: z.string().optional(),
});

/**
 * Resultado de la exportación a PDF.
 */
export interface PdfExportResult {
  /** Nombre del archivo generado */
  fileName: string;
  /** Buffer con el contenido binario del PDF */
  buffer: Buffer;
  /** Tamaño en bytes del PDF generado */
  sizeBytes: number;
  /** Número de páginas estimado */
  pageCount: number;
  /** Tiempo de generación en ms */
  generationTimeMs: number;
}

/**
 * Error específico para fallos en la exportación PDF.
 */
export class PdfExportError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PdfExportError';
  }
}

/**
 * Valida y completa las opciones de exportación PDF,
 * fusionando valores proporcionados con los valores por defecto.
 *
 * @param options - Opciones parciales proporcionadas por el usuario.
 * @returns Opciones completas y validadas.
 * @throws {PdfExportError} Si las opciones no pasan la validación Zod.
 */
export function resolvePdfOptions(
  options?: Partial<PdfExportOptions>
): PdfExportOptions {
  const merged = { ...DEFAULT_PDF_OPTIONS, ...options };

  const result = PdfExportOptionsSchema.safeParse(merged);
  if (!result.success) {
    throw new PdfExportError(
      `Opciones de PDF inválidas: ${result.error.message}`
    );
  }

  return result.data as PdfExportOptions;
}

/**
 * Convierte un string en Markdown a un buffer PDF.
 *
 * En esta versión inicial se utiliza una implementación ligera que
 * envuelve el markdown en HTML básico. En producción se recomienda
 * usar Puppeteer (o markdown-pdf) para una conversión fiel.
 *
 * @param markdown - Contenido en formato Markdown.
 * @param options  - Opciones de configuración del PDF.
 * @returns Promesa con el resultado de la exportación.
 * @throws {PdfExportError} Si ocurre un error durante la generación.
 */
export async function exportMarkdownToPdf(
  markdown: string,
  options?: Partial<PdfExportOptions>
): Promise<PdfExportResult> {
  const startTime = Date.now();
  const resolvedOptions = resolvePdfOptions(options);

  if (!markdown || markdown.trim().length === 0) {
    throw new PdfExportError(
      'El contenido Markdown no puede estar vacío.'
    );
  }

  try {
    // Convertir markdown a HTML básico
    const htmlContent = markdownToHtml(markdown, resolvedOptions);

    // Envolver en documento HTML completo con estilos
    const fullHtml = wrapInHtmlDocument(htmlContent, resolvedOptions);

    // Generar buffer PDF (simulado — en producción usar puppeteer)
    const buffer = await generatePdfBuffer(fullHtml, resolvedOptions);

    const generationTimeMs = Date.now() - startTime;

    return {
      fileName: generateFileName(resolvedOptions.title ?? 'reporte'),
      buffer,
      sizeBytes: buffer.length,
      pageCount: estimatePageCount(buffer.length),
      generationTimeMs,
    };
  } catch (error) {
    if (error instanceof PdfExportError) {
      throw error;
    }
    throw new PdfExportError(
      'Error al generar el PDF a partir del Markdown.',
      error
    );
  }
}

/**
 * Convierte texto Markdown básico a HTML.
 * Soporta: encabezados, negritas, listas, tablas, párrafos.
 *
 * @param markdown - Texto en Markdown.
 * @param options  - Opciones de exportación (para metadatos).
 * @returns HTML resultante.
 */
function markdownToHtml(markdown: string, options: PdfExportOptions): string {
  let html = markdown;

  // Escapar HTML que pueda venir en el markdown
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Encabezados (## y #)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Negritas e itálicas
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Listas no ordenadas
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Tablas simples (| col1 | col2 |)
  html = html.replace(
    /^\|(.+)\|$/gm,
    (match: string) => {
      const cells = match
        .split('|')
        .filter((c: string) => c.trim().length > 0)
        .map((c: string) => `<td>${c.trim()}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    }
  );
  html = html.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>');

  // Líneas horizontales
  html = html.replace(/^---$/gm, '<hr />');

  // Párrafos (lo que no sea encabezado, lista, tabla o hr)
  const lines = html.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.startsWith('<h') &&
      !trimmed.startsWith('<li') &&
      !trimmed.startsWith('<tr') &&
      !trimmed.startsWith('<ul') &&
      !trimmed.startsWith('<table') &&
      !trimmed.startsWith('<hr') &&
      !trimmed.startsWith('</ul') &&
      !trimmed.startsWith('</table')
    ) {
      result.push(`<p>${trimmed}</p>`);
    } else {
      result.push(trimmed);
    }
  }

  return result.join('\n');
}

/**
 * Envuelve contenido HTML en un documento HTML completo con estilos.
 *
 * @param bodyHtml - Contenido HTML del cuerpo.
 * @param options  - Opciones de exportación.
 * @returns Documento HTML completo.
 */
function wrapInHtmlDocument(
  bodyHtml: string,
  options: PdfExportOptions
): string {
  const title = options.title ?? 'Reporte Financiero';
  const watermarkStyle = options.watermark
    ? `
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 80px;
      opacity: 0.08;
      color: #666;
      pointer-events: none;
      z-index: 1000;
      white-space: nowrap;
    }`
    : '';

  const watermarkHtml = options.watermark
    ? `<div class="watermark">${escapeHtml(options.watermark)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: ${options.pageSize ?? 'A4'} ${options.orientation ?? 'portrait'};
      margin: ${options.margins?.top ?? 20}mm
               ${options.margins?.right ?? 15}mm
               ${options.margins?.bottom ?? 20}mm
               ${options.margins?.left ?? 15}mm;
      ${options.pageNumbers ? '@bottom-center { content: counter(page); }' : ''}
    }
    body {
      font-family: 'Helvetica', 'Arial', sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #333;
    }
    h1 { font-size: 20pt; color: #1a237e; margin-top: 30px; border-bottom: 2px solid #1a237e; padding-bottom: 6px; }
    h2 { font-size: 16pt; color: #283593; margin-top: 24px; }
    h3 { font-size: 13pt; color: #3949ab; margin-top: 18px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 10pt;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 6px 10px;
      text-align: left;
    }
    th {
      background-color: #e8eaf6;
      font-weight: bold;
    }
    ul { margin: 8px 0; padding-left: 24px; }
    li { margin: 4px 0; }
    p { margin: 8px 0; text-align: justify; }
    hr { border: none; border-top: 1px solid #ccc; margin: 20px 0; }
    strong { color: #1a237e; }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .header h1 { border: none; margin-bottom: 4px; }
    .header .date { color: #666; font-size: 10pt; }
    .footer {
      text-align: center;
      font-size: 8pt;
      color: #999;
      margin-top: 40px;
      border-top: 1px solid #eee;
      padding-top: 8px;
    }
    ${watermarkStyle}
    ${options.stylesheet ? `/* Custom stylesheet: ${options.stylesheet} */` : ''}
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    ${options.author ? `<p class="date">Generado por: ${escapeHtml(options.author)}</p>` : ''}
    <p class="date">${new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
  </div>

  ${options.includeTableOfContents ? '<h2>Tabla de Contenidos</h2><div id="toc"></div>' : ''}

  ${bodyHtml}

  <div class="footer">
    <p>Finance Agent — Documento generado automáticamente</p>
  </div>

  ${watermarkHtml}
</body>
</html>`;
}

/**
 * Genera el buffer PDF a partir del HTML completo.
 *
 * NOTA: Esta implementación es un placeholder que codifica el HTML como
 * texto plano. En producción, reemplazar con Puppeteer:
 *
 *   const browser = await puppeteer.launch();
 *   const page = await browser.newPage();
 *   await page.setContent(fullHtml);
 *   const buffer = await page.pdf({ format: 'A4' });
 *   await browser.close();
 *
 * @param fullHtml - Documento HTML completo.
 * @param _options - Opciones de exportación.
 * @returns Buffer con el contenido del PDF.
 */
async function generatePdfBuffer(
  fullHtml: string,
  _options: PdfExportOptions
): Promise<Buffer> {
  // Placeholder: codificar HTML como texto en un buffer.
  // En producción, usar puppeteer para generar PDF real.
  return Buffer.from(fullHtml, 'utf-8');
}

/**
 * Genera un nombre de archivo seguro para el PDF.
 *
 * @param title - Título del reporte.
 * @returns Nombre de archivo con extensión .pdf.
 */
function generateFileName(title: string): string {
  const sanitized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  return `${sanitized}-${timestamp}.pdf`;
}

/**
 * Estima el número de páginas basado en el tamaño del buffer.
 * Aproximación: ~4KB por página para texto plano.
 *
 * @param sizeBytes - Tamaño del buffer en bytes.
 * @returns Número estimado de páginas (mínimo 1).
 */
function estimatePageCount(sizeBytes: number): number {
  const bytesPerPage = 4096;
  return Math.max(1, Math.ceil(sizeBytes / bytesPerPage));
}

/**
 * Escapa caracteres HTML en un string.
 *
 * @param text - Texto a escapar.
 * @returns Texto escapado.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
