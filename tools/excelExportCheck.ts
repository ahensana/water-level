/**
 * Checks the Excel export of the Trusted Reading History.
 *
 * Builds the workbook from the real feed through the real pipeline, writes it
 * to tools/ for eyeballing, then asserts the properties that make an exported
 * record usable and that are easy to break silently:
 *   - every column is wide enough for its widest value (no `####` in Excel)
 *   - measurements are numbers, not text, so they can be sorted and totalled
 *   - headers carry units, and match the CSV column for column
 *   - the header row is frozen and filterable, below the provenance notes
 *
 * Usage: npx tsx tools/excelExportCheck.ts
 */
import fs from "node:fs";
import { buildWorkbook } from "../app/src/lib/excelExport";
import {
  buildTrustedHistory,
  trustedHistorySheet,
  trustedHistoryToCsv,
} from "../app/src/lib/readingHistory";
import type { RawWaterMonitorReading } from "../app/src/types";

async function main(): Promise<void> {
  const dump = JSON.parse(
    fs.readFileSync(new URL("./sensor-dump.json", import.meta.url), "utf8"),
  ) as Record<string, RawWaterMonitorReading>;

  const readings = Object.values(dump)
    .filter((r) => r && Number.isFinite(r.distance) && Number.isFinite(r.timestamp as number))
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  const rows = buildTrustedHistory(readings);
  console.log(`=== EXCEL EXPORT CHECK === ${rows.length} trusted readings\n`);

  const notes = [
    "Meghalaya Energy Corporation Limited — Water Level Monitoring System",
    "Trusted reading history — every reading the dashboard trusts.",
    "Filters applied: none",
  ];
  const spec = trustedHistorySheet(rows, notes);
  const workbook = await buildWorkbook(spec);
  const sheet = workbook.worksheets[0];

  let failures = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
  };

  const headerRowIndex = notes.length + 2;
  const headerRow = sheet.getRow(headerRowIndex);

  check(
    spec.columns.every((c, i) => headerRow.getCell(i + 1).value === c.header),
    "header row carries every column label",
    `${spec.columns.length} columns at row ${headerRowIndex}`,
  );

  const unitless = spec.columns.filter(
    (c) => !/\(.+\)/.test(c.header) && !["Alert band"].includes(c.header),
  );
  check(unitless.length === 0, "every measurement header names its unit", unitless.map((c) => c.header).join(", "));

  check(
    trustedHistoryToCsv(rows).split("\r\n")[0].split(",").length === spec.columns.length,
    "workbook and CSV agree on column count",
  );

  // Column widths: compare each column's width against its widest rendered cell.
  let narrowest = Infinity;
  let narrowestCol = "";
  for (let c = 0; c < spec.columns.length; c++) {
    const width = sheet.getColumn(c + 1).width ?? 0;
    let widest = String(spec.columns[c].header).length;
    for (let r = 0; r < Math.min(rows.length, 5000); r++) {
      const cell = sheet.getCell(headerRowIndex + 1 + r, c + 1);
      const rendered = cell.value === null ? "" : String(cell.value);
      if (rendered.length > widest) widest = rendered.length;
    }
    // Headers wrap, so they only need their longest single word.
    const needed = Math.max(
      ...String(spec.columns[c].header).split(" ").map((w) => w.length),
      ...rows.slice(0, 1).map(() => 0),
      widestValueOf(sheet, headerRowIndex, c, rows.length),
    );
    const slack = width - needed;
    if (slack < narrowest) {
      narrowest = slack;
      narrowestCol = spec.columns[c].header;
    }
  }
  check(narrowest >= 0, "every column is wider than its widest value", `tightest: ${narrowestCol} (+${narrowest.toFixed(1)} chars)`);

  const firstDataRow = headerRowIndex + 1;
  const numericHeaders = spec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.numFmt !== undefined);
  const textNumbers = numericHeaders.filter(({ i }) => {
    const v = sheet.getCell(firstDataRow, i + 1).value;
    return v !== null && typeof v !== "number";
  });
  check(textNumbers.length === 0, "measurements are stored as numbers", textNumbers.map(({ c }) => c.header).join(", "));

  check(
    sheet.views?.[0]?.state === "frozen" && sheet.views[0].ySplit === headerRowIndex,
    "header row is frozen",
    `ySplit=${sheet.views?.[0]?.ySplit}`,
  );
  check(Boolean(sheet.autoFilter), "autofilter covers the table");
  check(
    sheet.rowCount === headerRowIndex + rows.length,
    "row count = notes + header + readings",
    `${sheet.rowCount} rows`,
  );

  const out = new URL("./trusted-reading-history-sample.xlsx", import.meta.url);
  await workbook.xlsx.writeFile(out.pathname.replace(/^\//, ""));
  console.log(`\nwrote ${out.pathname.replace(/^\//, "")} (${(fs.statSync(out.pathname.replace(/^\//, "")).size / 1024).toFixed(0)} KB)`);

  console.log("\ncolumn widths:");
  spec.columns.forEach((c, i) =>
    console.log(`  ${c.header.padEnd(20)} ${String(sheet.getColumn(i + 1).width).padStart(6)}`),
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

/** Widest rendered value in a column, as Excel would show it. */
function widestValueOf(
  sheet: import("exceljs").Worksheet,
  headerRowIndex: number,
  colIndex: number,
  rowCount: number,
): number {
  let widest = 0;
  for (let r = 0; r < Math.min(rowCount, 5000); r++) {
    const cell = sheet.getCell(headerRowIndex + 1 + r, colIndex + 1);
    if (cell.value === null || cell.value === undefined) continue;
    const rendered =
      typeof cell.value === "number" && typeof cell.numFmt === "string" && cell.numFmt.includes(".")
        ? cell.value.toFixed(cell.numFmt.split(".")[1].length)
        : String(cell.value);
    if (rendered.length > widest) widest = rendered.length;
  }
  return widest;
}
