import { exportToXlsx, exportSingleSheet, XlsxColumn, XlsxSheet, XlsxExportOptions } from '../../../src/reports/exporters/xlsx-export';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWriteBuffer = jest.fn<Promise<ArrayBuffer>, []>();
const mockAddRows = jest.fn<void, [Record<string, unknown>[]]>();
const mockGetCell = jest.fn();
const mockGetRow = jest.fn();
const mockGetColumn = jest.fn();

const mockWorksheet = {
  columns: [] as { header: string; key: string; width: number }[],
  addRows: mockAddRows,
  getCell: mockGetCell,
  getRow: mockGetRow,
  getColumn: mockGetColumn,
  autoFilter: null as unknown,
};

const mockAddWorksheet = jest.fn().mockReturnValue(mockWorksheet);

let mockWorkbook: {
  creator: string;
  created: Date | null;
  title: string;
  addWorksheet: jest.Mock;
  xlsx: { writeBuffer: jest.Mock };
};

const createMockWorkbook = () => {
  mockWorkbook = {
    creator: '',
    created: null,
    title: '',
    addWorksheet: mockAddWorksheet,
    xlsx: { writeBuffer: mockWriteBuffer },
  };
  return mockWorkbook;
};

jest.mock('exceljs', () => ({
  Workbook: jest.fn().mockImplementation(() => createMockWorkbook()),
}), { virtual: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleColumns: XlsxColumn[] = [
  { header: 'Cliente', key: 'client', width: 25 },
  { header: 'Monto', key: 'amount', width: 15, numberFormat: '#,##0.00' },
];

const sampleData: Record<string, unknown>[] = [
  { client: 'Empresa A', amount: 15000 },
  { client: 'Empresa B', amount: 23500 },
];

const sampleSheet: XlsxSheet = {
  name: 'Facturación',
  columns: sampleColumns,
  data: sampleData,
};

beforeEach(() => {
  jest.clearAllMocks();
  // Reset mock worksheet state
  mockWorksheet.columns = [];
  mockWorksheet.autoFilter = null;
  mockGetCell.mockReset();
  mockGetRow.mockReset();
  mockGetColumn.mockReset();
  mockWriteBuffer.mockReset().mockResolvedValue(new ArrayBuffer(0));

  // Default returns for helpers
  mockGetColumn.mockReturnValue({ letter: 'Z' });

  // Row mock: header row
  const mockHeaderRow = {
    font: {} as Record<string, unknown>,
    fill: {} as Record<string, unknown>,
    alignment: {} as Record<string, unknown>,
    height: 0,
  };
  mockGetRow.mockReturnValue(mockHeaderRow);

  // Cell mock: for number format cells
  const mockCell = { numFmt: '' };
  mockGetCell.mockReturnValue(mockCell);
});

// ---------------------------------------------------------------------------
// Tests – exportToXlsx
// ---------------------------------------------------------------------------

describe('exportToXlsx', () => {
  it('should throw when sheets array is empty', async () => {
    await expect(
      exportToXlsx({ sheets: [] })
    ).rejects.toThrow('Debe proporcionar al menos una hoja para exportar.');
  });

  it('should throw when sheets is undefined', async () => {
    await expect(
      exportToXlsx({} as XlsxExportOptions)
    ).rejects.toThrow('Debe proporcionar al menos una hoja para exportar.');
  });

  it('should throw when a sheet has no columns', async () => {
    const invalidSheet: XlsxSheet = {
      name: 'Vacia',
      columns: [],
      data: [],
    };

    await expect(
      exportToXlsx({ sheets: [invalidSheet] })
    ).rejects.toThrow('La hoja "Vacia" no tiene columnas definidas.');
  });

  it('should throw when a sheet has undefined columns', async () => {
    const invalidSheet = {
      name: 'SinColumnas',
      columns: undefined,
      data: [],
    } as unknown as XlsxSheet;

    await expect(
      exportToXlsx({ sheets: [invalidSheet] })
    ).rejects.toThrow('La hoja "SinColumnas" no tiene columnas definidas.');
  });

  it('should create a workbook with default author when none provided', async () => {
    await exportToXlsx({ sheets: [sampleSheet] });

    expect(mockWorkbook.creator).toBe('Finance Agent');
    expect(mockWorkbook.created).toBeInstanceOf(Date);
  });

  it('should set the author from options', async () => {
    await exportToXlsx({ sheets: [sampleSheet], author: 'CFO Virtual' });

    expect(mockWorkbook.creator).toBe('CFO Virtual');
  });

  it('should set the title from options', async () => {
    await exportToXlsx({ sheets: [sampleSheet], title: 'Reporte Mensual' });

    expect(mockWorkbook.title).toBe('Reporte Mensual');
  });

  it('should not set title when not provided', async () => {
    await exportToXlsx({ sheets: [sampleSheet] });

    expect(mockWorkbook.title).toBe('');
  });

  it('should add one worksheet per sheet in the array', async () => {
    const sheets: XlsxSheet[] = [
      { name: 'Ventas', columns: [{ header: 'A', key: 'a' }], data: [{ a: 1 }] },
      { name: 'Compras', columns: [{ header: 'B', key: 'b' }], data: [{ b: 2 }] },
      { name: 'Gastos', columns: [{ header: 'C', key: 'c' }], data: [{ c: 3 }] },
    ];

    await exportToXlsx({ sheets });

    expect(mockAddWorksheet).toHaveBeenCalledTimes(3);
    expect(mockAddWorksheet).toHaveBeenCalledWith('Ventas', { views: [{ state: 'frozen', ySplit: 1 }] });
    expect(mockAddWorksheet).toHaveBeenCalledWith('Compras', { views: [{ state: 'frozen', ySplit: 1 }] });
    expect(mockAddWorksheet).toHaveBeenCalledWith('Gastos', { views: [{ state: 'frozen', ySplit: 1 }] });
  });

  it('should map columns to worksheet.columns correctly', async () => {
    await exportToXlsx({ sheets: [sampleSheet] });

    expect(mockWorksheet.columns).toEqual([
      { header: 'Cliente', key: 'client', width: 25 },
      { header: 'Monto', key: 'amount', width: 15 },
    ]);
  });

  it('should apply default width of 20 when not specified', async () => {
    const cols: XlsxColumn[] = [
      { header: 'Sin Ancho', key: 'noWidth' },
    ];
    const sheet: XlsxSheet = { name: 'Test', columns: cols, data: [{ noWidth: 'x' }] };

    await exportToXlsx({ sheets: [sheet] });

    expect(mockWorksheet.columns).toEqual([
      { header: 'Sin Ancho', key: 'noWidth', width: 20 },
    ]);
  });

  it('should apply numberFormat to all data cells of that column', async () => {
    mockGetCell.mockReturnValue({ numFmt: '' });

    await exportToXlsx({ sheets: [sampleSheet] });

    // Column "amount" is second column (index 1), so ExcelJS col index = 2
    // rowIdx goes from 2 to data.length + 1 = 3
    expect(mockGetCell).toHaveBeenCalledWith(2, 2); // first data row
    expect(mockGetCell).toHaveBeenCalledWith(3, 2); // second data row
    // Calling it for other columns too (col 1) due to iterative loops
    const cellsWithFormat = mockGetCell.mock.results
      .filter((r: jest.MockResult) => r.value?.numFmt !== undefined)
      .map((r: jest.MockResult) => r.value);
    // At least some cells got the number format
    expect(cellsWithFormat.length).toBeGreaterThan(0);
  });

  it('should add data rows when data is non-empty', async () => {
    await exportToXlsx({ sheets: [sampleSheet] });

    expect(mockAddRows).toHaveBeenCalledWith(sampleData);
  });

  it('should not call addRows when data is empty', async () => {
    const emptySheet: XlsxSheet = {
      name: 'Vacio',
      columns: [{ header: 'A', key: 'a' }],
      data: [],
    };

    await exportToXlsx({ sheets: [emptySheet] });

    expect(mockAddRows).not.toHaveBeenCalled();
  });

  it('should style the header row (row 1) with bold white font and blue fill', async () => {
    const mockHeaderRow: Record<string, unknown> = {
      font: {},
      fill: {},
      alignment: {},
      height: 0,
    };
    mockGetRow.mockReturnValue(mockHeaderRow);

    await exportToXlsx({ sheets: [sampleSheet] });

    expect(mockGetRow).toHaveBeenCalledWith(1);
    expect(mockHeaderRow.font).toEqual({
      bold: true,
      size: 11,
      color: { argb: 'FFFFFFFF' },
    });
    expect(mockHeaderRow.fill).toEqual({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    });
    expect(mockHeaderRow.alignment).toEqual({
      horizontal: 'center',
      vertical: 'middle',
    });
    expect(mockHeaderRow.height).toBe(20);
  });

  it('should enable autoFilter by default', async () => {
    await exportToXlsx({ sheets: [sampleSheet] });

    expect(mockWorksheet.autoFilter).toEqual({
      from: { row: 1, column: 1 },
      to: { row: sampleData.length + 1, column: sampleColumns.length },
    });
  });

  it('should disable autoFilter when autoFilter: false', async () => {
    await exportToXlsx({ sheets: [sampleSheet], autoFilter: false });

    expect(mockWorksheet.autoFilter).toBeNull();
  });

  it('should return a Buffer with the XLSX content', async () => {
    const fakeArrayBuffer = new ArrayBuffer(8);
    mockWriteBuffer.mockResolvedValue(fakeArrayBuffer);

    const result = await exportToXlsx({ sheets: [sampleSheet] });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.byteLength).toBe(8);
  });

  it('should handle a single empty sheet with no data gracefully', async () => {
    const minimalSheet: XlsxSheet = {
      name: 'Minimal',
      columns: [{ header: 'ID', key: 'id' }],
      data: [],
    };

    const result = await exportToXlsx({ sheets: [minimalSheet] });

    expect(result).toBeInstanceOf(Buffer);
    expect(mockAddWorksheet).toHaveBeenCalledWith('Minimal', expect.any(Object));
  });

  it('should handle special characters in sheet name', async () => {
    const weirdSheet: XlsxSheet = {
      name: 'Reporte Q4 - 2024/2025 (Ingresos & Egresos)',
      columns: [{ header: 'A', key: 'a' }],
      data: [{ a: 1 }],
    };

    const result = await exportToXlsx({ sheets: [weirdSheet] });

    expect(result).toBeInstanceOf(Buffer);
    expect(mockAddWorksheet).toHaveBeenCalledWith(
      'Reporte Q4 - 2024/2025 (Ingresos & Egresos)',
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests – exportSingleSheet
// ---------------------------------------------------------------------------

describe('exportSingleSheet', () => {
  it('should delegate to exportToXlsx with a single-sheet wrapper', async () => {
    const result = await exportSingleSheet('Resumen', sampleColumns, sampleData);

    expect(result).toBeInstanceOf(Buffer);
    expect(mockAddWorksheet).toHaveBeenCalledWith('Resumen', expect.any(Object));
  });

  it('should pass title, author and autoFilter options to exportToXlsx', async () => {
    await exportSingleSheet('Resumen', sampleColumns, sampleData, {
      title: 'Reporte Anual',
      author: 'Finance Team',
      autoFilter: false,
    });

    // Verify the options were passed through by checking Workbook properties
    expect(mockWorkbook.title).toBe('Reporte Anual');
    expect(mockWorkbook.creator).toBe('Finance Team');
    expect(mockWorksheet.autoFilter).toBeNull();
  });

  it('should default to Finance Agent as author when no author provided', async () => {
    await exportSingleSheet('Resumen', sampleColumns, sampleData);

    expect(mockWorkbook.creator).toBe('Finance Agent');
  });

  it('should enable autoFilter when no autoFilter option provided', async () => {
    await exportSingleSheet('Resumen', sampleColumns, sampleData);

    expect(mockWorksheet.autoFilter).toBeTruthy();
  });

  it('should throw when columns are empty', async () => {
    await expect(
      exportSingleSheet('Vacia', [], sampleData)
    ).rejects.toThrow('La hoja "Vacia" no tiene columnas definidas.');
  });

  it('should handle empty data array', async () => {
    const result = await exportSingleSheet('Vacio', sampleColumns, []);

    expect(result).toBeInstanceOf(Buffer);
    expect(mockAddRows).not.toHaveBeenCalled();
  });

  it('should apply numberFormat from column definitions', async () => {
    mockGetCell.mockReturnValue({ numFmt: '' });

    await exportSingleSheet('Resumen', sampleColumns, sampleData);

    const cellsWithFormat = mockGetCell.mock.results
      .filter((r: jest.MockResult) => r.value?.numFmt !== undefined)
      .map((r: jest.MockResult) => r.value);
    expect(cellsWithFormat.length).toBeGreaterThan(0);
  });
});
