/**
 * Excel (.xlsx) export for the official-record tables.
 *
 * CSV stays available for machine ingest, but a workbook is what actually gets
 * filed and circulated: it carries the units in the header, keeps numbers as
 * numbers (a CSV opened in Excel turns "3201.760" into text or, worse,
 * re-formats it), and can size its own columns so nothing arrives as `####`.
 *
 * ExcelJS is ~1 MB, so it is imported dynamically — the dashboard is watched on
 * site connections and must not pay for a library most sessions never use. Same
 * reason html2canvas/jsPDF are lazy in `exportChart`.
 */

interface ExcelJsNamespace {
  Workbook: new () => import("exceljs").Workbook;
}
type ExcelJsModule = Partial<ExcelJsNamespace> & { default: ExcelJsNamespace };

/** One column of an exported sheet. */
export interface SheetColumn<Row> {
  /** Header text, units included — e.g. "Water level (ft)". */
  header: string;
  /** Cell value for a row. Return a number to keep it numeric in Excel. */
  value: (row: Row) => string | number | null;
  /** Excel number format, e.g. "0.000". Applied to numeric cells only. */
  numFmt?: string;
  /** Horizontal alignment; defaults to right for numeric columns. */
  align?: "left" | "center" | "right";
}

export interface SheetSpec<Row> {
  /** Worksheet tab name. Excel forbids : \ / ? * [ ] and caps it at 31 chars. */
  sheetName: string;
  columns: SheetColumn<Row>[];
  rows: Row[];
}

/** Width is measured in characters, so cap it before a long note stretches a column off-screen. */
const MIN_WIDTH = 9;
const MAX_WIDTH = 34;
const WIDTH_PADDING = 2.5;

export async function downloadXlsx<Row>(filename: string, spec: SheetSpec<Row>): Promise<void> {
  const workbook = await buildWorkbook(spec);
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  triggerDownload(filename, buffer);
}

/**
 * Builds the workbook without touching the DOM, so the sheet — headers, number
 * formats, column widths — can be asserted in `tools/excelExportCheck.ts`
 * instead of being eyeballed in Excel after every change.
 */
export async function buildWorkbook<Row>(spec: SheetSpec<Row>): Promise<import("exceljs").Workbook> {
  // ExcelJS is CommonJS: Vite hands back a namespace with the library on
  // `default`, Node's ESM interop sometimes hands back the library itself.
  // Take whichever one actually has the constructor.
  const mod = (await import("exceljs")) as unknown as ExcelJsModule;
  const ExcelJS: ExcelJsNamespace = mod.Workbook ? { Workbook: mod.Workbook } : mod.default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MeECL Water Level Monitoring System";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sanitizeSheetName(spec.sheetName), {
    views: [{ state: "frozen", ySplit: 0 }],
  });

  // The table starts at row 1. Provenance lines above it were tried and
  // removed: they pushed the header to row 8, and freezing everything above
  // the data meant eight rows of preamble stayed pinned over every scroll.
  const HEADER_ROW = 1;
  const headerRow = sheet.getRow(HEADER_ROW);
  spec.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF1E3A5F" } } };
  });
  headerRow.height = 22;
  headerRow.commit();

  spec.rows.forEach((row, r) => {
    const excelRow = sheet.getRow(HEADER_ROW + 1 + r);
    spec.columns.forEach((col, c) => {
      const cell = excelRow.getCell(c + 1);
      const value = col.value(row);
      // An empty cell, not "—" or "": a missing reading is absent data, and a
      // dash in a numeric column makes the whole column text in Excel.
      cell.value = value === null || value === "" ? null : value;
      if (typeof value === "number") {
        if (col.numFmt) cell.numFmt = col.numFmt;
        cell.alignment = { horizontal: col.align ?? "right" };
      } else {
        cell.alignment = { horizontal: col.align ?? "left" };
      }
    });
    excelRow.commit();
  });

  // Freeze the header and let Excel filter/sort the record in place.
  sheet.views = [{ state: "frozen", ySplit: HEADER_ROW }];
  if (spec.rows.length > 0) {
    sheet.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: HEADER_ROW + spec.rows.length, column: spec.columns.length },
    };
  }

  sizeColumns(sheet, spec);

  return workbook;
}

/**
 * Widths come from the rendered text, not from the header alone.
 *
 * Excel's column width unit is "characters of the default font", so the width
 * is the longest rendered value in the column plus padding. Without this every
 * column arrives at the 8.43-character default and any timestamp or long label
 * shows as `####`, which is exactly what makes an exported record unusable.
 */
function sizeColumns<Row>(sheet: import("exceljs").Worksheet, spec: SheetSpec<Row>): void {
  spec.columns.forEach((col, i) => {
    // A wrapped two-word header does not need the full width of both words.
    const headerWidth = Math.max(...col.header.split(" ").map((w) => w.length), 8);
    let widest = headerWidth;

    for (const row of spec.rows) {
      const value = col.value(row);
      if (value === null) continue;
      const rendered =
        typeof value === "number" && col.numFmt
          ? formatWidthSample(value, col.numFmt)
          : String(value);
      if (rendered.length > widest) widest = rendered.length;
    }

    sheet.getColumn(i + 1).width = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, widest + WIDTH_PADDING),
    );
  });
}

/** Approximates how wide a number renders under a "0.000"-style format. */
function formatWidthSample(value: number, numFmt: string): string {
  const decimals = numFmt.includes(".") ? numFmt.split(".")[1].replace(/[^0]/g, "").length : 0;
  return value.toFixed(decimals);
}

/** Excel rejects : \ / ? * [ ] in a sheet name and truncates past 31 characters. */
function sanitizeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet1";
}

// ExcelJS types writeBuffer as its own Buffer alias, which in a browser build is
// an ArrayBuffer; BlobPart is what Blob actually needs.
function triggerDownload(filename: string, buffer: ArrayBuffer): void {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
