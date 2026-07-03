import ExcelJS from 'exceljs';

/**
 * Representa una columna en la hoja de cálculo.
 */
export interface XlsxColumn {
  /** Encabezado visible de la columna */
  header: string;
  /** Clave del campo en los datos (para mapeo automático) */
  key: string;
  /** Ancho opcional de la columna en caracteres */
  width?: number;
  /** Formato opcional de número (ej: '#,##0.00') */
  numberFormat?: string;
}

/**
 * Configuración de una hoja dentro del libro.
 */
export interface XlsxSheet {
  /** Nombre de la pestaña */
  name: string;
  /** Definición de columnas */
  columns: XlsxColumn[];
  /** Filas de datos (array de objetos clave-valor) */
  data: Record<string, unknown>[];
}

/**
 * Opciones generales de exportación XLSX.
 */
export interface XlsxExportOptions {
  /** Título del libro (se muestra en propiedades del documento) */
  title?: string;
  /** Autor del documento */
  author?: string;
  /** Hojas que componen el libro */
  sheets: XlsxSheet[];
  /** Si se debe aplicar auto-filtro en los encabezados (default: true) */
  autoFilter?: boolean;
}

/**
 * Exporta una o varias hojas de datos a un buffer XLSX.
 *
 * @param options - Configuración del libro y las hojas.
 * @returns Un Buffer con el contenido del archivo XLSX.
 * @throws Si alguna hoja no tiene columnas o datos válidos.
 */
export async function exportToXlsx(options: XlsxExportOptions): Promise<Buffer> {
  const { title, author, sheets, autoFilter = true } = options;

  if (!sheets || sheets.length === 0) {
    throw new Error('Debe proporcionar al menos una hoja para exportar.');
  }

  const workbook = new ExcelJS.Workbook();

  // Propiedades del documento
  workbook.creator = author ?? 'Finance Agent';
  workbook.created = new Date();
  if (title) {
    workbook.title = title;
  }

  for (const sheet of sheets) {
    if (!sheet.columns || sheet.columns.length === 0) {
      throw new Error(`La hoja "${sheet.name}" no tiene columnas definidas.`);
    }

    const worksheet = workbook.addWorksheet(sheet.name, {
      views: [{ state: 'frozen', ySplit: 1 }], // Congela la fila de encabezados
    });

    // Definir columnas
    worksheet.columns = sheet.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width ?? 20,
    }));

    // Aplicar formato de número a columnas que lo especifiquen
    for (const col of sheet.columns) {
      if (col.numberFormat) {
        const colIndex = sheet.columns.indexOf(col) + 1; // ExcelJS usa 1-based
        for (let rowIdx = 2; rowIdx <= sheet.data.length + 1; rowIdx++) {
          const cell = worksheet.getCell(rowIdx, colIndex);
          cell.numFmt = col.numberFormat;
        }
      }
    }

    // Escribir datos
    if (sheet.data.length > 0) {
      worksheet.addRows(sheet.data);
    }

    // Estilo del encabezado
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }, // Azul corporativo
    };
    headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 20;

    // Auto-filtro
    if (autoFilter && sheet.columns.length > 0) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: sheet.data.length + 1, column: sheet.columns.length },
      };
    }
  }

  // Generar buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Versión simplificada para exportar una sola hoja.
 *
 * @param sheetName - Nombre de la pestaña.
 * @param columns - Definición de columnas.
 * @param data - Filas de datos.
 * @param options - Opciones adicionales del libro.
 * @returns Un Buffer con el contenido del archivo XLSX.
 */
export async function exportSingleSheet(
  sheetName: string,
  columns: XlsxColumn[],
  data: Record<string, unknown>[],
  options?: { title?: string; author?: string; autoFilter?: boolean }
): Promise<Buffer> {
  return exportToXlsx({
    title: options?.title,
    author: options?.author,
    autoFilter: options?.autoFilter,
    sheets: [{ name: sheetName, columns, data }],
  });
}
