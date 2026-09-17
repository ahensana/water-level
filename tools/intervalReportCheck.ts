/**
 * Validates the in-app Interval Report and Gauge Verification against the
 * staff-gauge logbook.
 *
 * `pipelineCheck.ts` verifies the LIVE pipeline — what the gauge shows right
 * now. This verifies the AUDIT path: the interval table an operator opens to
 * cross-check a past period, and the verification that decides whether the
 * sensor is within tolerance. They are different code paths (the report shows
 * physically-valid samples rather than the jump-filtered live stream), so an
 * offset derived from a table that disagreed with the live reading would quietly
 * mis-calibrate the dashboard.
 *
 * Checks:
 *  1. every granularity produces coherent rows and agrees with the logbook
 *  2. no badly-wrong interval escapes the suspect flag (those feed the trim)
 *  3. `verifyAgainstGauge` reaches the right PASS/FAIL verdict at 0.3 ft
 *  4. the suggested offset is stable regardless of display granularity
 *
 * Usage: npx tsx tools/intervalReportCheck.ts
 */
import fs from "node:fs";
import {
  buildIntervalReport,
  GRANULARITIES,
  intervalReportToCsv,
  verifyAgainstGauge,
  verificationToCsv,
} from "../app/src/lib/intervalReport";
import { SITE_CONFIG } from "../app/src/config";
import { resolveDeviceTimeMs } from "../app/src/lib/waterLevel";
import type { RawWaterMonitorReading } from "../app/src/types";
import { FIELD_LOG } from "./fieldLog.mjs";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const TOLERANCE = SITE_CONFIG.crossCheckToleranceFt;

const dump = JSON.parse(fs.readFileSync(new URL("./sensor-dump.json", import.meta.url), "utf8")) as Record<
  string,
  RawWaterMonitorReading
>;
const all = Object.values(dump)
  .filter((r) => r && typeof r.timestamp === "number")
  .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

// Use the app's own resolver rather than reading `timestamp` directly, so the
// check cannot pass on a unit convention the app does not actually apply.
const times = all.map((r) => resolveDeviceTimeMs(r)).filter((t): t is number => t !== null);
const from = Math.max(SITE_CONFIG.dataStartMs, Math.min(...times));
const to = Math.max(...times);

console.log("=== INTERVAL REPORT & VERIFICATION CHECK ===");
console.log(`window    : ${new Date(from).toISOString()} → ${new Date(to).toISOString()}`);
console.log(`tolerance : ${TOLERANCE.toFixed(2)} ft\n`);

// ---------------------------------------------------------------- 1 + 2
console.log("--- 1/2. every granularity vs logbook ---");
console.log("interval        rows   matched   median    worst    >tol   flagged   leaked");

interface Row {
  label: string;
  suggested: number | null;
}
const perGranularity: Row[] = [];

for (const g of GRANULARITIES) {
  const report = buildIntervalReport(all, from, to, g.ms);

  let matched = 0;
  let flagged = 0;
  let overTolerance = 0;
  let leaked = 0; // grossly wrong but NOT flagged — these could be calibrated against
  const errors: number[] = [];

  for (const bucket of report.buckets) {
    if (bucket.waterLevelFt === null) continue;
    // Compare against the logbook entry for the IST hour this interval starts in.
    // Only intervals of an hour or less can be attributed to a single entry.
    if (g.ms > 3_600_000) continue;
    const ist = new Date(bucket.startMs + IST_OFFSET_MS);
    const logged = (FIELD_LOG as Record<string, Record<number, number>>)[
      ist.toISOString().slice(0, 10)
    ]?.[ist.getUTCHours()];
    if (typeof logged !== "number") continue;

    const err = bucket.waterLevelFt - logged;
    matched++;
    if (bucket.suspectReason) {
      flagged++;
      continue;
    }
    errors.push(err);
    if (Math.abs(err) > TOLERANCE) overTolerance++;
    if (Math.abs(err) > 0.5) leaked++;
  }

  errors.sort((a, b) => a - b);
  const med = errors.length ? errors[errors.length >> 1] : NaN;
  const worst = errors.length ? Math.max(...errors.map(Math.abs)) : NaN;

  console.log(
    `${g.label.padEnd(14)} ${String(report.buckets.length).padStart(6)} ` +
      `${String(matched).padStart(8)} ${fmt(med).padStart(8)} ${fmt(worst).padStart(8)} ` +
      `${String(overTolerance).padStart(6)} ${String(flagged).padStart(9)} ` +
      `${String(leaked).padStart(7)}${leaked === 0 ? " ✓" : " ✗"}`,
  );

  perGranularity.push({ label: g.label, suggested: null });
}

// ---------------------------------------------------------------- 3
// Feed the real logbook in as if the operator had typed it, at the top of every
// logged hour, and see what the verification concludes.
const checks: { id: string; atMs: number; gaugeFt: number }[] = [];
for (const [date, hours] of Object.entries(FIELD_LOG as Record<string, Record<number, number>>)) {
  for (const [hour, gaugeFt] of Object.entries(hours)) {
    // The register has blank hours; those are absent readings, not zeroes.
    if (typeof gaugeFt !== "number" || !Number.isFinite(gaugeFt)) continue;
    const atMs = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+05:30`);
    if (atMs >= from && atMs <= to) checks.push({ id: `${date}-${hour}`, atMs, gaugeFt });
  }
}
checks.sort((a, b) => a.atMs - b.atMs);

const hourly = buildIntervalReport(all, from, to, 3_600_000);
const summary = verifyAgainstGauge(hourly, checks, TOLERANCE);

console.log(`\n--- 3. verification against ${checks.length} logbook readings ---`);
console.log(`  usable                : ${summary.usable.length} (excluded ${checks.length - summary.usable.length})`);
console.log(`  median deviation      : ${fmt(summary.medianDeviationFt)} ft`);
console.log(`  max abs deviation     : ${fmt(summary.maxAbsDeviationFt)} ft`);
console.log(`  suggested trim        : ${fmt(summary.suggestedOffsetFt)} ft`);
console.log(
  `  verdict               : ${summary.usable.length === 0 ? "NOT VERIFIED" : summary.withinTolerance ? "PASS" : "FAIL"}`,
);

const over = summary.usable
  .filter((r) => Math.abs(r.deviationFt!) > TOLERANCE)
  .sort((a, b) => Math.abs(b.deviationFt!) - Math.abs(a.deviationFt!));
console.log(`  readings outside ${TOLERANCE} ft : ${over.length}`);
over.slice(0, 8).forEach((r) =>
  console.log(
    `    ${new Date(r.atMs).toISOString()}  gauge ${r.gaugeFt.toFixed(2)}  ` +
      `sensor ${r.sensorFt!.toFixed(2)}  dev ${fmt(r.deviationFt)}`,
  ),
);

const worstUsable = [...summary.usable].sort(
  (a, b) => Math.abs(b.deviationFt!) - Math.abs(a.deviationFt!),
);
console.log("  worst 5 usable:");
worstUsable.slice(0, 5).forEach((r) =>
  console.log(
    `    ${new Date(r.atMs).toISOString()}  gauge ${r.gaugeFt.toFixed(2)}  ` +
      `sensor ${r.sensorFt!.toFixed(2)}  dev ${fmt(r.deviationFt)}  n=${r.sampleCount}`,
  ),
);

// ---------------------------------------------------------------- 4
// The suggested offset resolves from the raw series, so it must not move when
// the operator changes the display granularity.
console.log("\n--- 4. suggested offset is independent of display granularity ---");
const offsets = GRANULARITIES.map((g) => {
  const rep = buildIntervalReport(all, from, to, g.ms);
  const sum = verifyAgainstGauge(rep, checks, TOLERANCE);
  return { label: g.label, offset: sum.suggestedOffsetFt, usable: sum.usable.length };
});
offsets.forEach((o) =>
  console.log(`  ${o.label.padEnd(14)} offset ${fmt(o.offset).padStart(8)} ft   usable ${o.usable}`),
);
const spread =
  Math.max(...offsets.map((o) => o.offset ?? 0)) - Math.min(...offsets.map((o) => o.offset ?? 0));
console.log(`  spread across granularities: ${spread.toFixed(4)} ft ${spread < 0.02 ? "✓" : "✗"}`);

// ---------------------------------------------------------------- exports
const csv = intervalReportToCsv(hourly).split("\r\n");
const vcsv = verificationToCsv(summary).split("\r\n");
console.log(`\n--- exports ---`);
console.log(`  interval CSV     : ${csv.length - 1} rows, ${csv[0].split(",").length} cols`);
console.log(`  verification CSV : ${vcsv.length - 1} lines`);
console.log(`  ${vcsv[vcsv.length - 1]}`);

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(3)}`;
}
